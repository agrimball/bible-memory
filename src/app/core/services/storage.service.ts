import { computed, inject, Injectable, signal } from '@angular/core';
import {
  CardState,
  checkPassagesContiguity,
  Flashcard,
  isEndOfChapter,
  normalizeBookKey,
  Passage,
  ProtoJsonCodec,
  ReviewLog,
  ReviewRating,
  SINGLE_CHAPTER_BOOKS,
  UserDataBundle,
  Verse,
} from '../proto/bible_memory.pb';
import { PassageParserService } from './passage-parser.service';
import { SrsService } from './srs.service';

export const STORAGE_KEY = 'bible_memory_protojson_v1';
export const DEFAULT_MEMORY_FILE_NAME = 'verses.selahmemory';
export const UNSAVED_FILE_CHANGES_KEY = 'selah_unsaved_file_changes_v1';
export const VIRTUAL_FILE_META_KEY = 'bible_memory_active_virtual_file_v1';
export const VIRTUAL_FILE_CONTENT_KEY = 'bible_memory_active_virtual_file_content_v1';
const FILE_HANDLE_DB_NAME = 'bible_memory_file_handle_db';
const FILE_HANDLE_STORE_NAME = 'handles';
const FILE_HANDLE_KEY = 'active_memory_file_handle';
const FILE_SAVE_DEBOUNCE_MS = 600;

export type ActiveFileStatus =
  | 'none'
  | 'connected'
  | 'saving'
  | 'saved'
  | 'needs-permission'
  | 'error';

export type FileConnectionStatus =
  | 'connected'
  | 'unsaved-disconnected'
  | 'disconnected-clean'
  | 'local-only';

export interface DeckItem {
  passage: Passage;
  card: Flashcard;
  isDue: boolean;
  healed?: boolean;
}

export interface DeckStats {
  total: number;
  due: number;
  queuedCount: number;
  newCount: number;
  learningCount: number;
  reviewCount: number;
  activeCount: number;
  repairCount?: number;
}

interface FileSystemHandlePermissionDescriptor {
  mode?: 'read' | 'readwrite';
}

interface BrowserFileSystemWritableFileStream {
  write(data: string | Blob | BufferSource): Promise<void>;
  close(): Promise<void>;
}

interface BrowserFileSystemFileHandle {
  readonly name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<BrowserFileSystemWritableFileStream>;
  queryPermission?(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
  requestPermission?(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
}

@Injectable({ providedIn: 'root' })
export class StorageService {
  private readonly srs = inject(SrsService);
  private readonly parser = inject(PassageParserService);

  readonly passages = signal<Passage[]>([]);
  readonly flashcards = signal<Flashcard[]>([]);
  readonly reviewLogs = signal<ReviewLog[]>([]);
  readonly suppressedSeamKeys = signal<string[]>([]);
  readonly enabledSeamKeys = signal<string[]>([]);

  // Active Memory Data File signals
  readonly activeFileName = signal<string | null>(null);
  readonly activeFileStatus = signal<ActiveFileStatus>('none');
  readonly isSavingToFile = signal<boolean>(false);
  readonly hasUnsavedFileChanges = signal<boolean>(false);
  readonly lastFileSavedAt = signal<string | null>(null);
  readonly lastFileSaveError = signal<string | null>(null);
  readonly fileSyncError = signal<string | null>(null);

  // Undo state for the most recent multi-boundary passage split
  readonly lastSplitUndoState = signal<{
    createdPassageIds: string[];
    originalLabel: string;
  } | null>(null);

  readonly fileConnectionStatus = computed<FileConnectionStatus>(() => {
    const name = this.activeFileName();
    const status = this.activeFileStatus();
    if (!name || status === 'none') {
      return 'local-only';
    }
    if (
      status === 'needs-permission' ||
      status === 'error' ||
      Boolean(this.lastFileSaveError())
    ) {
      return this.hasUnsavedFileChanges()
        ? 'unsaved-disconnected'
        : 'disconnected-clean';
    }
    return 'connected';
  });

  private fileHandle: BrowserFileSystemFileHandle | null = null;
  private isSimulatedFile = false;
  private isWritingFile = false;
  private pendingWriteRequested = false;
  private fileSaveDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private lifecycleFlushListenersRegistered = false;

  readonly deckItems = computed<DeckItem[]>(() => {
    const passageList = this.passages();
    const cardList = this.flashcards();
    const passageById = new Map<string, Passage>();

    for (const passage of passageList) {
      passageById.set(passage.id, passage);
    }

    const now = new Date();
    const items: DeckItem[] = [];

    // Include all flashcards (both main passage flashcards and any active temporary repair/patch flashcards)
    for (const card of cardList) {
      const passage = passageById.get(card.passageId);
      if (passage) {
        const isActive = card.state !== CardState.CARD_STATE_NEW || Boolean(card.isRepairCard);
        const displayPassage = card.isRepairCard
          ? this.formatPatchPassage(passage, card)
          : passage;
        items.push({
          passage: displayPassage,
          card,
          isDue: isActive && this.srs.isDue(card, now),
        });
      }
    }

    return items;
  });

  /**
   * Passages in the user's Memorization Queue (not yet started: state === CARD_STATE_NEW and not a repair card).
   */
  readonly queuedDeckItems = computed<DeckItem[]>(() => {
    return this.deckItems().filter(
      (item) => item.card.state === CardState.CARD_STATE_NEW && !item.card.isRepairCard
    );
  });

  /**
   * Passages and temporary verse-repair cards the user is actively working on memorizing.
   */
  readonly activeDeckItems = computed<DeckItem[]>(() => {
    return this.deckItems().filter(
      (item) => item.card.state !== CardState.CARD_STATE_NEW || Boolean(item.card.isRepairCard)
    );
  });

  /**
   * Temporary single-verse repair flashcards currently active in the deck.
   */
  readonly repairDeckItems = computed<DeckItem[]>(() => {
    return this.deckItems().filter((item) => Boolean(item.card.isRepairCard));
  });

  /**
   * Active memorization passages (and repair cards) that are currently due for review.
   * Repair cards are prioritized first when due at the same time.
   */
  readonly dueDeckItems = computed<DeckItem[]>(() => {
    return this.activeDeckItems()
      .filter((item) => item.isDue)
      .sort((a, b) => {
        if (Boolean(a.card.isRepairCard) !== Boolean(b.card.isRepairCard)) {
          return a.card.isRepairCard ? -1 : 1;
        }
        const dueA = new Date(a.card.dueAt).getTime() || 0;
        const dueB = new Date(b.card.dueAt).getTime() || 0;
        return dueA - dueB;
      });
  });

  readonly stats = computed<DeckStats>(() => {
    const items = this.deckItems();
    let due = 0;
    let queuedCount = 0;
    let learningCount = 0;
    let reviewCount = 0;
    let repairCount = 0;

    for (const item of items) {
      if (item.card.isRepairCard) {
        repairCount += 1;
      }
      if (item.card.state === CardState.CARD_STATE_NEW && !item.card.isRepairCard) {
        queuedCount += 1;
      } else {
        if (item.isDue) {
          due += 1;
        }
        if (
          item.card.state === CardState.CARD_STATE_LEARNING ||
          item.card.state === CardState.CARD_STATE_RELEARNING ||
          item.card.isRepairCard
        ) {
          learningCount += 1;
        } else if (item.card.state === CardState.CARD_STATE_REVIEW) {
          reviewCount += 1;
        }
      }
    }

    const activeCount = learningCount + reviewCount;

    return {
      total: items.length,
      due,
      queuedCount,
      newCount: queuedCount,
      learningCount,
      reviewCount,
      activeCount,
      repairCount,
    };
  });

  constructor() {
    this.loadFromStorage();
    this.registerLifecycleFlushListeners();
    void this.restoreActiveFileConnection();
  }

  /**
   * Returns true if the browser natively supports the File System Access API pickers.
   */
  supportsNativeFileSystem(): boolean {
    return (
      typeof window !== 'undefined' &&
      typeof (window as unknown as Record<string, unknown>)['showOpenFilePicker'] === 'function' &&
      typeof (window as unknown as Record<string, unknown>)['showSaveFilePicker'] === 'function'
    );
  }

  /**
   * Opens a file picker to select an existing `.selahmemory` / `.json` data file,
   * loads its contents into the app, and sets it as the Active Memory Data File for background auto-saving.
   */
  async selectExistingDataFile(): Promise<boolean> {
    this.setFileError(null);

    const win = typeof window !== 'undefined' ? (window as unknown as Record<string, unknown>) : null;
    if (win && typeof win['showOpenFilePicker'] === 'function') {
      try {
        const showOpenFilePicker = win['showOpenFilePicker'] as (
          options?: unknown
        ) => Promise<BrowserFileSystemFileHandle[]>;
        const handles = await showOpenFilePicker({
          multiple: false,
          types: [
            {
              description: 'Selah Memory File',
              accept: {
                'application/json': ['.selahmemory', '.json', '.proto.json'],
              },
            },
          ],
        });

        if (!handles || handles.length === 0) {
          return false;
        }

        const handle = handles[0];
        const file = await handle.getFile();
        const text = await file.text();

        this.fileHandle = handle;
        this.isSimulatedFile = false;
        this.clearSimulatedFileMeta();
        this.activeFileName.set(handle.name);
        this.activeFileStatus.set('connected');
        await this.saveHandleToIndexedDb(handle);

        if (text.trim().length > 0) {
          this.importProtoJson(text, false);
        }
        await this.writeToActiveFileHandle();

        const nowIso = new Date().toISOString();
        this.activeFileStatus.set('saved');
        this.lastFileSavedAt.set(nowIso);
        return true;
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          if (!this.fileHandle && !this.isSimulatedFile) {
            this.activeFileName.set(null);
            this.activeFileStatus.set('none');
          }
          return false;
        }
        this.setFileError(
          err instanceof Error ? err.message : 'Could not open the selected data file.'
        );
        if (!this.fileHandle && !this.isSimulatedFile) {
          this.activeFileName.set(null);
          this.activeFileStatus.set('none');
        } else {
          this.activeFileStatus.set('error');
        }
        return false;
      }
    }

    // Fallback for browsers without window.showOpenFilePicker: use a hidden <input type="file">
    return this.selectFileViaInputElement();
  }

  /**
   * Prompts the user to create/choose a file location to save the Active Memory Data File,
   * immediately writes the current bundle to it, and auto-saves on every change thereafter.
   */
  async createNewDataFile(suggestedName = DEFAULT_MEMORY_FILE_NAME): Promise<boolean> {
    this.setFileError(null);

    const win = typeof window !== 'undefined' ? (window as unknown as Record<string, unknown>) : null;
    if (win && typeof win['showSaveFilePicker'] === 'function') {
      try {
        const showSaveFilePicker = win['showSaveFilePicker'] as (
          options?: unknown
        ) => Promise<BrowserFileSystemFileHandle>;
        const handle = await showSaveFilePicker({
          suggestedName,
          types: [
            {
              description: 'Selah Memory File',
              accept: {
                'application/json': ['.selahmemory', '.json', '.proto.json'],
              },
            },
          ],
        });

        if (!handle) {
          return false;
        }

        this.fileHandle = handle;
        this.isSimulatedFile = false;
        this.clearSimulatedFileMeta();
        this.activeFileName.set(handle.name);
        this.activeFileStatus.set('connected');
        await this.saveHandleToIndexedDb(handle);
        await this.writeToActiveFileHandle();
        return true;
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          if (!this.fileHandle && !this.isSimulatedFile) {
            this.activeFileName.set(null);
            this.activeFileStatus.set('none');
          }
          return false;
        }
        this.setFileError(
          err instanceof Error ? err.message : 'Could not create the data file.'
        );
        if (!this.fileHandle && !this.isSimulatedFile) {
          this.activeFileName.set(null);
          this.activeFileStatus.set('none');
        } else {
          this.activeFileStatus.set('error');
        }
        return false;
      }
    }

    // Fallback when showSaveFilePicker is unavailable (e.g. Firefox): trigger a real browser file download
    this.triggerBrowserFileDownload(suggestedName, this.exportProtoJson(true));
    await this.connectSimulatedDataFile(suggestedName);
    return true;
  }

  /**
   * Connects a local/simulated auto-save file target (useful when the browser does not support
   * native FileSystemFileHandle pickers or for 1-click quick-connect).
   * Every change in the app automatically writes to this active file target and updates `lastFileSavedAt`.
   */
  async connectSimulatedDataFile(fileName = DEFAULT_MEMORY_FILE_NAME): Promise<void> {
    const cleanName = fileName.trim() || DEFAULT_MEMORY_FILE_NAME;
    this.fileHandle = null;
    this.isSimulatedFile = true;
    await this.clearHandleFromIndexedDb();

    const nowIso = new Date().toISOString();
    this.activeFileName.set(cleanName);
    this.activeFileStatus.set('saved');
    this.lastFileSavedAt.set(nowIso);
    this.setFileError(null);

    this.saveSimulatedFileMeta(cleanName, nowIso);
    await this.writeToActiveFileHandle();
  }

  /**
   * Explicitly requests read/write permission on user click, immediately flushes the current state
   * to the active file handle, and clears `hasUnsavedFileChanges`.
   */
  async reconnectAndSyncNow(): Promise<boolean> {
    if (!this.fileHandle && !this.isSimulatedFile) {
      return false;
    }

    if (this.isSimulatedFile) {
      await this.writeToActiveFileHandle(false);
      return this.activeFileStatus() === 'saved';
    }

    try {
      this.setFileError(null);
      let perm: PermissionState = 'granted';
      if (this.fileHandle && typeof this.fileHandle.queryPermission === 'function') {
        perm = await this.fileHandle.queryPermission({ mode: 'readwrite' });
      }
      if (
        perm !== 'granted' &&
        this.fileHandle &&
        typeof this.fileHandle.requestPermission === 'function'
      ) {
        perm = await this.fileHandle.requestPermission({ mode: 'readwrite' });
      }
      if (perm !== 'granted') {
        this.activeFileStatus.set('needs-permission');
        return false;
      }

      await this.writeToActiveFileHandle(true);
      return this.activeFileStatus() === 'saved';
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'SecurityError') {
        this.activeFileStatus.set('needs-permission');
        return false;
      }
      this.setFileError(
        err instanceof Error ? err.message : 'Failed to reconnect to active data file.'
      );
      this.activeFileStatus.set('error');
      return false;
    }
  }

  /**
   * Re-requests read/write permission for a previously saved FileSystemFileHandle restored from IndexedDB,
   * and immediately flushes the current state to the file.
   */
  async reconnectSavedFileHandle(): Promise<boolean> {
    return this.reconnectAndSyncNow();
  }

  /**
   * Disconnects the active memory data file (stops background file auto-saving, while keeping local state).
   */
  disconnectDataFile(): void {
    this.clearFileSaveDebounceTimer();
    this.fileHandle = null;
    this.isSimulatedFile = false;
    this.isSavingToFile.set(false);
    this.setUnsavedFileChanges(false);
    this.activeFileName.set(null);
    this.activeFileStatus.set('none');
    this.lastFileSavedAt.set(null);
    this.setFileError(null);
    this.clearSimulatedFileMeta();
    void this.clearHandleFromIndexedDb();
  }

  /**
   * Forces an immediate write of the current user data bundle to the active file target.
   */
  async saveNowToActiveFile(): Promise<boolean> {
    if (!this.fileHandle && !this.isSimulatedFile) {
      return false;
    }
    this.clearFileSaveDebounceTimer();
    await this.writeToActiveFileHandle(false);
    return this.activeFileStatus() === 'saved';
  }

  /**
   * Immediately flushes any pending debounced file write to the active file handle.
   */
  async flushPendingFileWrite(): Promise<void> {
    if (this.fileSaveDebounceTimer !== null) {
      this.clearFileSaveDebounceTimer();
    }
    if (this.fileHandle || this.isSimulatedFile) {
      await this.writeToActiveFileHandle(false);
    }
  }

  /**
   * Creates (or surfaces) a temporary single-verse or multi-verse range Repair Flashcard for a passage.
   * Accepts `passageId` or `parentCardId` as the first argument, and supports optional `chapterNumber`,
   * `endVerseNumber`, and `endChapterNumber`.
   * Once the user grades Good/Easy `targetStreak` consecutive times (default 3),
   * the repair card is considered healed and automatically retires from the deck.
   */
  createRepairCard(
    passageOrCardId: string,
    verseNumber: number,
    targetStreakOrChapter = 3,
    explicitChapterNumber?: number,
    endVerseNumber?: number,
    endChapterNumber?: number
  ): DeckItem | undefined {
    const cards = this.flashcards();
    const matchedCard = cards.find((c) => c.id === passageOrCardId);
    const passageId = matchedCard ? matchedCard.passageId : passageOrCardId;
    const passage = this.passages().find((p) => p.id === passageId);
    if (!passage) {
      return undefined;
    }

    let targetStreak = 3;
    let resolvedChapter: number | undefined = explicitChapterNumber;

    if (explicitChapterNumber !== undefined) {
      targetStreak = targetStreakOrChapter > 0 ? targetStreakOrChapter : 3;
    } else {
      const matchesSpecificChapter = passage.verses.some(
        (v) => v.verseNumber === verseNumber && v.chapterNumber === targetStreakOrChapter
      );
      if (matchesSpecificChapter && targetStreakOrChapter !== 3) {
        resolvedChapter = targetStreakOrChapter;
        targetStreak = 3;
      } else {
        targetStreak = targetStreakOrChapter > 0 ? targetStreakOrChapter : 3;
        const matchedVerse = passage.verses.find((v) => v.verseNumber === verseNumber);
        if (matchedVerse?.chapterNumber && matchedVerse.chapterNumber > 0) {
          resolvedChapter = matchedVerse.chapterNumber;
        }
      }
    }

    const resolvedEndVerse =
      endVerseNumber && endVerseNumber > 0 ? endVerseNumber : undefined;
    const resolvedEndChapter =
      endChapterNumber && endChapterNumber > 0 ? endChapterNumber : resolvedChapter;

    const now = new Date();
    const isoNow = now.toISOString();

    // Check if an active repair card for (passageId, verseNumber, resolvedChapter, resolvedEndVerse) already exists
    const existingRepair = cards.find(
      (c) =>
        Boolean(c.isRepairCard) &&
        c.passageId === passageId &&
        c.repairVerseNumber === verseNumber &&
        (resolvedChapter === undefined ||
          !c.repairChapterNumber ||
          c.repairChapterNumber === resolvedChapter) &&
        (resolvedEndVerse ?? verseNumber) === (c.repairEndVerseNumber ?? c.repairVerseNumber)
    );

    if (existingRepair) {
      const refreshed: Flashcard = {
        ...existingRepair,
        state: CardState.CARD_STATE_LEARNING,
        dueAt: isoNow,
        updatedAt: isoNow,
        ...(resolvedChapter && resolvedChapter > 0
          ? { repairChapterNumber: resolvedChapter }
          : {}),
        ...(resolvedEndVerse && resolvedEndVerse > 0
          ? { repairEndVerseNumber: resolvedEndVerse }
          : {}),
        ...(resolvedEndChapter && resolvedEndChapter > 0
          ? { repairEndChapterNumber: resolvedEndChapter }
          : {}),
      };
      this.flashcards.update((prev) =>
        prev.map((c) => (c.id === existingRepair.id ? refreshed : c))
      );
      this.persistToStorage();
      return {
        passage: this.formatPatchPassage(passage, refreshed),
        card: refreshed,
        isDue: true,
      };
    }

    const parentCard =
      matchedCard && !matchedCard.isRepairCard
        ? matchedCard
        : cards.find((c) => c.passageId === passageId && !c.isRepairCard);
    const baseCard = this.srs.createInitialFlashcard(passageId, now);
    const repairCard: Flashcard = {
      ...baseCard,
      id: this.generateId('card_repair'),
      state: CardState.CARD_STATE_LEARNING,
      dueAt: isoNow,
      isRepairCard: true,
      repairVerseNumber: verseNumber,
      repairStreak: 0,
      repairTargetStreak: Math.max(1, targetStreak),
      parentCardId: parentCard?.id,
      ...(resolvedChapter && resolvedChapter > 0
        ? { repairChapterNumber: resolvedChapter }
        : {}),
      ...(resolvedEndVerse && resolvedEndVerse > 0
        ? { repairEndVerseNumber: resolvedEndVerse }
        : {}),
      ...(resolvedEndChapter && resolvedEndChapter > 0
        ? { repairEndChapterNumber: resolvedEndChapter }
        : {}),
    };

    this.flashcards.update((prev) => [repairCard, ...prev]);
    this.persistToStorage();

    return {
      passage: this.formatPatchPassage(passage, repairCard),
      card: repairCard,
      isDue: true,
    };
  }

  private formatPatchPassage(passage: Passage, card: Flashcard): Passage {
    const cleanBaseRef = (passage.reference ?? '').replace(/\s*\((?:Patch|Repair)\)\s*$/i, '').trim();
    const verses = passage.verses ?? [];
    if (verses.length === 0 || !card.repairVerseNumber) {
      return {
        ...passage,
        reference: `${cleanBaseRef || passage.reference} (Patch)`,
      };
    }

    const startNum = card.repairVerseNumber;
    const startChap = card.repairChapterNumber;
    let startIdx = verses.findIndex(
      (v) =>
        v.verseNumber === startNum &&
        (!startChap || !v.chapterNumber || v.chapterNumber === startChap)
    );
    if (startIdx < 0) {
      startIdx = verses.findIndex((v) => v.verseNumber === startNum);
    }

    if (startIdx < 0) {
      return {
        ...passage,
        reference: `${cleanBaseRef} (Patch)`,
      };
    }

    const endNum = card.repairEndVerseNumber ?? startNum;
    const endChap = card.repairEndChapterNumber ?? startChap;
    let endIdx = verses.findIndex(
      (v, idx) =>
        idx >= startIdx &&
        v.verseNumber === endNum &&
        (!endChap || !v.chapterNumber || v.chapterNumber === endChap)
    );
    if (endIdx < 0) {
      endIdx = verses.findIndex((v, idx) => idx >= startIdx && v.verseNumber === endNum);
    }
    if (endIdx < startIdx) {
      endIdx = startIdx;
    }

    const targetSlice = verses.slice(startIdx, endIdx + 1);
    const subRef = this.computeSubReference(cleanBaseRef, targetSlice);
    return {
      ...passage,
      reference: `${subRef} (Patch)`,
    };
  }

  /**
   * Truncates / rolls back memorized progress on a passage when the user forgot everything
   * after `keepVerseCount` verses:
   * - If `keepVerseCount >= 1`: sets `card.learningStep = keepVerseCount`, keeps the card in SRS (`REVIEW`/`LEARNING`),
   *   so the user maintains `1..keepVerseCount` in spaced repetition and can expand `+1v` again later.
   * - If `keepVerseCount <= 0`: resets `card.learningStep = 1` and `card.state = CardState.CARD_STATE_NEW`.
   */
  truncatePassageProgress(
    passageOrCardId: string,
    keepVerseCount: number
  ): DeckItem | undefined {
    const cards = this.flashcards();
    const targetCard =
      cards.find((c) => c.id === passageOrCardId && !c.isRepairCard) ??
      cards.find((c) => c.passageId === passageOrCardId && !c.isRepairCard);
    if (!targetCard) {
      return undefined;
    }

    const passage = this.passages().find((p) => p.id === targetCard.passageId);
    if (!passage) {
      return undefined;
    }

    const now = new Date();
    const isoNow = now.toISOString();
    const maxVerses = Math.max(1, passage.verses.length);

    let updatedCard: Flashcard;
    if (keepVerseCount <= 0) {
      updatedCard = {
        ...targetCard,
        state: CardState.CARD_STATE_NEW,
        learningStep: 1,
        repetitions: 0,
        intervalDays: 0,
        dueAt: isoNow,
        updatedAt: isoNow,
      };
    } else {
      const clampedKeep = Math.max(1, Math.min(Math.round(keepVerseCount), maxVerses));
      const nextState =
        targetCard.state === CardState.CARD_STATE_NEW
          ? CardState.CARD_STATE_LEARNING
          : targetCard.state;
      updatedCard = {
        ...targetCard,
        state: nextState,
        learningStep: clampedKeep,
        updatedAt: isoNow,
      };
    }

    this.flashcards.update((prev) =>
      prev.map((c) => (c.id === targetCard.id ? updatedCard : c))
    );
    this.syncContiguousStitchedCards();
    this.persistToStorage();

    return {
      passage,
      card: updatedCard,
      isDue:
        updatedCard.state !== CardState.CARD_STATE_NEW && this.srs.isDue(updatedCard, now),
    };
  }

  /**
   * Expands a partially memorized passage's target verse step by `delta` (default +1 verse),
   * clamped to `1 .. passage.verses.length`.
   */
  expandPassageStep(cardOrPassageId: string, delta = 1): DeckItem | undefined {
    const cards = this.flashcards();
    const targetCard =
      cards.find((c) => c.id === cardOrPassageId && !c.isRepairCard) ??
      cards.find((c) => c.passageId === cardOrPassageId && !c.isRepairCard);
    if (!targetCard) {
      return undefined;
    }
    const currentStep = Math.max(1, targetCard.learningStep || 1);
    return this.updateStitchedVerseStep(targetCard.id, currentStep + delta);
  }

  /**
   * Transitions a queued passage (CARD_STATE_NEW) into active memorization (CARD_STATE_LEARNING).
   * Ensures `learningStep` starts at `1` (the 1st verse) if it was `0`.
   * Accepts either `card.id` or `passage.id`.
   */
  startMemorizingPassage(cardOrPassageId: string): DeckItem | undefined {
    const cards = this.flashcards();
    const targetCard =
      cards.find((c) => c.id === cardOrPassageId) ??
      cards.find((c) => c.passageId === cardOrPassageId && !c.isRepairCard);
    if (!targetCard) {
      return undefined;
    }

    const now = new Date();
    const isoNow = now.toISOString();
    const initialStep = targetCard.learningStep >= 1 ? targetCard.learningStep : 1;

    let updatedCard = targetCard;
    if (targetCard.state === CardState.CARD_STATE_NEW || targetCard.learningStep < 1) {
      updatedCard = {
        ...targetCard,
        state:
          targetCard.state === CardState.CARD_STATE_NEW
            ? CardState.CARD_STATE_LEARNING
            : targetCard.state,
        learningStep: initialStep,
        dueAt: targetCard.state === CardState.CARD_STATE_NEW ? isoNow : targetCard.dueAt,
        updatedAt: isoNow,
      };
      this.flashcards.update((prev) =>
        prev.map((c) => (c.id === targetCard.id ? updatedCard : c))
      );
      this.syncContiguousStitchedCards();
      this.persistToStorage();
    }

    const passage = this.passages().find((p) => p.id === updatedCard.passageId);
    if (!passage) {
      return undefined;
    }

    return {
      passage,
      card: updatedCard,
      isDue: this.srs.isDue(updatedCard, now),
    };
  }

  /**
   * Updates the 1-indexed stitched verse progress (`card.learningStep`, clamped to `1 .. passage.verses.length`),
   * persists to localStorage and the active `.proto.json` file, and returns the updated DeckItem.
   */
  updateStitchedVerseStep(cardId: string, step: number): DeckItem | undefined {
    const cards = this.flashcards();
    const targetCard =
      cards.find((c) => c.id === cardId) ??
      cards.find((c) => c.passageId === cardId && !c.isRepairCard);
    if (!targetCard) {
      return undefined;
    }

    const passage = this.passages().find((p) => p.id === targetCard.passageId);
    if (!passage) {
      return undefined;
    }

    const maxVerses = Math.max(1, passage.verses.length);
    const clampedStep = Math.max(1, Math.min(Math.round(step), maxVerses));
    const now = new Date();
    const isoNow = now.toISOString();

    const wasNew = targetCard.state === CardState.CARD_STATE_NEW;
    const updatedCard: Flashcard = {
      ...targetCard,
      state: wasNew ? CardState.CARD_STATE_LEARNING : targetCard.state,
      dueAt: wasNew ? isoNow : targetCard.dueAt,
      learningStep: clampedStep,
      updatedAt: isoNow,
    };

    this.flashcards.update((prev) =>
      prev.map((c) => (c.id === targetCard.id ? updatedCard : c))
    );
    this.syncContiguousStitchedCards();
    this.persistToStorage();

    return {
      passage,
      card: updatedCard,
      isDue:
        (updatedCard.state !== CardState.CARD_STATE_NEW || Boolean(updatedCard.isRepairCard)) &&
        this.srs.isDue(updatedCard, now),
    };
  }

  /**
   * Adds a structured multi-verse passage to the Memorization Queue (CARD_STATE_NEW).
   * Supports both `addPassage(reference, verses, label?)` and `addPassage(reference, rawText, preParsedVerses?, label?)`.
   */
  addPassage(
    reference: string,
    rawTextOrVerses: string | Verse[],
    preParsedVersesOrLabel?: Verse[] | string,
    label?: string
  ): DeckItem {
    const now = new Date();
    const isoNow = now.toISOString();

    let rawVerses: Verse[];
    let resolvedLabel: string | undefined;
    let resolvedReference = reference.trim();

    if (Array.isArray(rawTextOrVerses)) {
      rawVerses = rawTextOrVerses;
      resolvedLabel =
        typeof preParsedVersesOrLabel === 'string' ? preParsedVersesOrLabel : label;
    } else {
      if (Array.isArray(preParsedVersesOrLabel) && preParsedVersesOrLabel.length > 0) {
        rawVerses = preParsedVersesOrLabel;
      } else {
        const parsed = this.parser.parseRawInput(rawTextOrVerses, resolvedReference || undefined);
        rawVerses = parsed.verses;
        if (!resolvedReference) {
          resolvedReference = parsed.reference;
        }
      }
      resolvedLabel = label;
    }

    const cleanRef = resolvedReference || 'Untitled Passage';
    const cleanLabel = resolvedLabel?.trim() || undefined;
    const cleanVerses: Verse[] = rawVerses
      .map((v, idx) => ({
        verseNumber: v.verseNumber > 0 ? v.verseNumber : idx + 1,
        text: v.text.trim(),
        ...(v.chapterNumber && v.chapterNumber > 0 ? { chapterNumber: v.chapterNumber } : {}),
      }))
      .filter((v) => v.text.length > 0);

    const passage: Passage = {
      id: this.generateId('psg'),
      reference: cleanRef,
      verses: cleanVerses,
      createdAt: isoNow,
      updatedAt: isoNow,
      ...(cleanLabel ? { label: cleanLabel } : {}),
    };

    const card: Flashcard = {
      ...this.srs.createInitialFlashcard(passage.id, now),
      learningStep: 1,
    };

    this.passages.update((prev) => [passage, ...prev]);
    this.flashcards.update((prev) => [card, ...prev]);
    this.persistToStorage();

    return {
      passage,
      card,
      isDue: false,
    };
  }

  /**
   * Updates an existing passage's reference, custom label, and verses, preserving its card and SRS state.
   */
  updatePassage(
    passageId: string,
    reference: string,
    rawTextOrVerses: string | Verse[],
    maybeVerses?: Verse[],
    label?: string
  ): Passage | undefined {
    const existing = this.passages().find((p) => p.id === passageId);
    if (!existing) {
      return undefined;
    }

    const isoNow = new Date().toISOString();
    const cleanRef = reference.trim() || existing.reference || 'Untitled Passage';
    const cleanLabel = label?.trim() || undefined;

    let rawVerses: Verse[];
    if (Array.isArray(rawTextOrVerses)) {
      rawVerses = rawTextOrVerses;
    } else if (Array.isArray(maybeVerses) && maybeVerses.length > 0) {
      rawVerses = maybeVerses;
    } else {
      rawVerses = this.parser.parseRawInput(rawTextOrVerses, cleanRef).verses;
    }

    const cleanVerses: Verse[] = rawVerses
      .map((v, idx) => ({
        verseNumber: v.verseNumber > 0 ? v.verseNumber : idx + 1,
        text: v.text.trim(),
        ...(v.chapterNumber && v.chapterNumber > 0 ? { chapterNumber: v.chapterNumber } : {}),
      }))
      .filter((v) => v.text.length > 0);

    const finalVerses = cleanVerses.length > 0 ? cleanVerses : existing.verses;

    const updatedPassage: Passage = {
      ...existing,
      reference: cleanRef,
      verses: finalVerses,
      updatedAt: isoNow,
    };
    if (cleanLabel) {
      updatedPassage.label = cleanLabel;
    } else {
      delete updatedPassage.label;
    }

    this.passages.update((prev) =>
      prev.map((p) => (p.id === passageId ? updatedPassage : p))
    );

    const maxVerses = Math.max(1, finalVerses.length);
    this.flashcards.update((prev) =>
      prev.map((c) => {
        if (c.passageId !== passageId || c.isRepairCard) {
          return c;
        }
        return {
          ...c,
          learningStep: Math.max(1, Math.min(c.learningStep || 1, maxVerses)),
          updatedAt: isoNow,
        };
      })
    );

    this.syncContiguousStitchedCards();
    this.persistToStorage();
    return updatedPassage;
  }

  /**
   * Updates the user-defined label on an existing passage.
   */
  updatePassageLabel(passageId: string, label: string): void {
    const cleanLabel = label.trim() || undefined;
    const isoNow = new Date().toISOString();
    this.passages.update((prev) =>
      prev.map((p) => {
        if (p.id !== passageId) {
          return p;
        }
        const updated: Passage = {
          ...p,
          updatedAt: isoNow,
        };
        if (cleanLabel) {
          updated.label = cleanLabel;
        } else {
          delete updated.label;
        }
        return updated;
      })
    );
    this.syncContiguousStitchedCards();
    this.persistToStorage();
  }

  /**
   * Adds multiple chunked passages in canonical order so chunk 1 appears first in the Queue.
   */
  addMultiplePassages(
    chunks: Array<{ reference: string; rawText?: string; verses: Verse[]; label?: string }>
  ): Passage[] {
    if (!chunks || chunks.length === 0) {
      return [];
    }

    const now = new Date();
    const isoNow = now.toISOString();
    const newPassages: Passage[] = [];
    const newCards: Flashcard[] = [];

    for (const chunk of chunks) {
      const cleanRef = chunk.reference.trim() || 'Untitled Passage';
      const cleanLabel = chunk.label?.trim() || undefined;
      const sourceVerses =
        chunk.verses && chunk.verses.length > 0
          ? chunk.verses
          : this.parser.parseRawInput(chunk.rawText ?? '', cleanRef).verses;
      const cleanVerses: Verse[] = sourceVerses
        .map((v, idx) => ({
          verseNumber: v.verseNumber > 0 ? v.verseNumber : idx + 1,
          text: v.text.trim(),
          ...(v.chapterNumber && v.chapterNumber > 0 ? { chapterNumber: v.chapterNumber } : {}),
        }))
        .filter((v) => v.text.length > 0);

      if (cleanVerses.length === 0) {
        continue;
      }

      const passage: Passage = {
        id: this.generateId('psg'),
        reference: cleanRef,
        verses: cleanVerses,
        createdAt: isoNow,
        updatedAt: isoNow,
        ...(cleanLabel ? { label: cleanLabel } : {}),
      };
      const card: Flashcard = {
        ...this.srs.createInitialFlashcard(passage.id, now),
        learningStep: 1,
      };
      newPassages.push(passage);
      newCards.push(card);
    }

    if (newPassages.length > 0) {
      this.passages.update((prev) => [...newPassages, ...prev]);
      this.flashcards.update((prev) => [...newCards, ...prev]);
      this.persistToStorage();
    }

    return newPassages;
  }

  /**
   * Splits an existing long passage into smaller named chunks in canonical order.
   */
  splitPassageIntoChunks(
    passageId: string,
    chunks: Array<{ reference: string; label?: string; verses: Verse[] }>
  ): void {
    if (!chunks || chunks.length === 0) {
      return;
    }

    const now = new Date();
    const isoNow = now.toISOString();
    const createdPassages: Passage[] = [];
    const createdCards: Flashcard[] = [];

    for (const chunk of chunks) {
      const cleanRef = chunk.reference.trim() || 'Untitled Passage';
      const cleanLabel = chunk.label?.trim() || undefined;
      const cleanVerses: Verse[] = (chunk.verses ?? [])
        .map((v, idx) => ({
          verseNumber: v.verseNumber > 0 ? v.verseNumber : idx + 1,
          text: v.text.trim(),
          ...(v.chapterNumber && v.chapterNumber > 0 ? { chapterNumber: v.chapterNumber } : {}),
        }))
        .filter((v) => v.text.length > 0);

      if (cleanVerses.length === 0) {
        continue;
      }

      const passage: Passage = {
        id: this.generateId('psg'),
        reference: cleanRef,
        verses: cleanVerses,
        createdAt: isoNow,
        updatedAt: isoNow,
        ...(cleanLabel ? { label: cleanLabel } : {}),
      };
      const card: Flashcard = {
        ...this.srs.createInitialFlashcard(passage.id, now),
        learningStep: 1,
      };
      createdPassages.push(passage);
      createdCards.push(card);
    }

    if (createdPassages.length === 0) {
      return;
    }

    this.passages.update((prev) => {
      const idx = prev.findIndex((p) => p.id === passageId);
      if (idx === -1) {
        return [...createdPassages, ...prev];
      }
      const next = [...prev];
      next.splice(idx, 1, ...createdPassages);
      return next;
    });

    this.flashcards.update((prev) => {
      const filtered = prev.filter((c) => c.passageId !== passageId);
      return [...createdCards, ...filtered];
    });

    this.syncContiguousStitchedCards();
    this.persistToStorage();
  }

  /**
   * Splits a passage at one or more 0-based verse indices (`0 <= idx < verses.length - 1`),
   * preserving learned progress on completed prefix segments, setting the first unlearned segment
   * as `activeNextItem`, and saving undo metadata (`lastSplitUndoState`) so `undoLastSplit()` can recombine them.
   */
  splitPassageAtBoundaries(
    cardOrPassageId: string,
    splitAfterVerseIndices: number[],
    customLabelsBySegment?: Record<number, string> | string
  ):
    | {
        segments: DeckItem[];
        createdItems: DeckItem[];
        chunks: DeckItem[];
        activeNextItem: DeckItem;
        activeItem: DeckItem;
        remainingPassage: DeckItem;
        undoPassageIds: string[];
      }
    | undefined {
    const cards = this.flashcards();
    const targetCard =
      cards.find((c) => c.id === cardOrPassageId && !c.isRepairCard) ??
      cards.find((c) => c.passageId === cardOrPassageId && !c.isRepairCard);
    if (!targetCard) {
      return undefined;
    }

    const passage = this.passages().find((p) => p.id === targetCard.passageId);
    if (!passage || passage.verses.length < 2) {
      return undefined;
    }

    const validIndices = Array.from(
      new Set(
        (splitAfterVerseIndices ?? [])
          .map((n) => Math.round(n))
          .filter((n) => Number.isFinite(n) && n >= 0 && n < passage.verses.length - 1)
      )
    ).sort((a, b) => a - b);

    if (validIndices.length === 0) {
      return undefined;
    }

    const normalizedLabels: Record<number, string> =
      typeof customLabelsBySegment === 'string'
        ? customLabelsBySegment.trim()
          ? { 0: customLabelsBySegment.trim() }
          : {}
        : customLabelsBySegment ?? {};

    const now = new Date();
    const isoNow = now.toISOString();
    const wasNew = targetCard.state === CardState.CARD_STATE_NEW;
    const rawLearnedCount = wasNew
      ? 0
      : targetCard.state === CardState.CARD_STATE_REVIEW
        ? passage.verses.length
        : Math.max(1, Math.min(targetCard.learningStep || 1, passage.verses.length));

    // When splitting an active passage, treat at least the first split boundary as completed prefix
    const effectiveLearnedCount = wasNew
      ? 0
      : rawLearnedCount < passage.verses.length
        ? Math.max(rawLearnedCount, validIndices[0] + 1)
        : validIndices[0] + 1;

    const cutPoints = [...validIndices, passage.verses.length - 1];
    const createdPassages: Passage[] = [];
    const createdCards: Flashcard[] = [];
    const segmentItems: DeckItem[] = [];
    let activeNextItem: DeckItem | undefined;

    for (let segIdx = 0; segIdx < cutPoints.length; segIdx++) {
      const segStartIdx = segIdx === 0 ? 0 : cutPoints[segIdx - 1] + 1;
      const segEndIdx = cutPoints[segIdx];
      const segVerses = passage.verses.slice(segStartIdx, segEndIdx + 1);
      const segRef = this.computeSubReference(passage.reference, segVerses);
      const explicitLabel = normalizedLabels[segIdx]?.trim();

      // Reuse the original passage/card ID for the final segment so existing references remain stable
      const isFinalSegment = segIdx === cutPoints.length - 1;
      const segPassageId = isFinalSegment ? passage.id : this.generateId('psg');
      const segCardId = isFinalSegment ? targetCard.id : this.generateId('card');

      const segPassage: Passage = {
        id: segPassageId,
        reference: segRef,
        verses: segVerses,
        createdAt: isFinalSegment ? passage.createdAt : isoNow,
        updatedAt: isoNow,
        ...(explicitLabel ? { label: explicitLabel } : {}),
      };

      let segCard: Flashcard;
      if (!wasNew && segEndIdx < effectiveLearnedCount) {
        // Completed prefix segment
        segCard = {
          ...targetCard,
          id: segCardId,
          passageId: segPassageId,
          state: CardState.CARD_STATE_REVIEW,
          learningStep: segVerses.length,
          repetitions: Math.max(1, targetCard.repetitions || 0),
          intervalDays: Math.max(1, targetCard.intervalDays || 1),
          dueAt: targetCard.dueAt || isoNow,
          updatedAt: isoNow,
          isRepairCard: false,
          isStitchedPassageCard: false,
        };
        delete segCard.stitchedPassageIds;
      } else if (!activeNextItem) {
        // First segment containing unlearned verses -> activeNextItem
        const remainingLearnedInSeg = Math.max(
          1,
          Math.min(segVerses.length, rawLearnedCount - segStartIdx)
        );
        segCard = {
          ...targetCard,
          id: segCardId,
          passageId: segPassageId,
          state: wasNew ? CardState.CARD_STATE_NEW : CardState.CARD_STATE_LEARNING,
          learningStep: wasNew ? 1 : remainingLearnedInSeg,
          dueAt: isoNow,
          updatedAt: isoNow,
          isRepairCard: false,
          isStitchedPassageCard: false,
        };
        delete segCard.stitchedPassageIds;
      } else {
        // Subsequent unlearned segment after activeNextItem
        segCard = {
          ...this.srs.createInitialFlashcard(segPassageId, now),
          id: segCardId,
          state: CardState.CARD_STATE_NEW,
          learningStep: 1,
          dueAt: isoNow,
          updatedAt: isoNow,
        };
      }

      const item: DeckItem = {
        passage: segPassage,
        card: segCard,
        isDue: segCard.state !== CardState.CARD_STATE_NEW && this.srs.isDue(segCard, now),
      };
      if (!activeNextItem && (wasNew || segEndIdx >= effectiveLearnedCount)) {
        activeNextItem = item;
      }

      createdPassages.push(segPassage);
      createdCards.push(segCard);
      segmentItems.push(item);
    }

    const resolvedActiveNext = activeNextItem ?? segmentItems[segmentItems.length - 1];
    const undoPassageIds = createdPassages.map((p) => p.id);

    this.lastSplitUndoState.set({
      createdPassageIds: undoPassageIds,
      originalLabel: passage.label?.trim() ?? '',
    });

    this.passages.update((prev) => {
      const idx = prev.findIndex((p) => p.id === passage.id);
      if (idx === -1) {
        return [...createdPassages, ...prev];
      }
      const next = [...prev];
      next.splice(idx, 1, ...createdPassages);
      return next;
    });

    this.flashcards.update((prev) => {
      const idx = prev.findIndex((c) => c.id === targetCard.id);
      if (idx === -1) {
        return [...createdCards, ...prev];
      }
      const next = [...prev];
      next.splice(idx, 1, ...createdCards);
      return next;
    });

    this.syncContiguousStitchedCards();
    this.persistToStorage();

    return {
      segments: segmentItems,
      createdItems: segmentItems,
      chunks: segmentItems,
      activeNextItem: resolvedActiveNext,
      activeItem: resolvedActiveNext,
      remainingPassage: resolvedActiveNext,
      undoPassageIds,
    };
  }

  /**
   * Undoes the most recent `splitPassageAtBoundaries` operation by recombining the created segments.
   */
  undoLastSplit(): DeckItem | undefined {
    const state = this.lastSplitUndoState();
    if (!state || state.createdPassageIds.length < 2) {
      return undefined;
    }
    this.lastSplitUndoState.set(null);
    return this.combinePassages(state.createdPassageIds, state.originalLabel || undefined);
  }

  /**
   * Incremental Chunking while memorizing a longer passage:
   * Carves off the first `prefixVerseCount` verses (`1 <= prefixVerseCount < passage.verses.length`)
   * as a completed, memorized passage + card (`CARD_STATE_REVIEW`, `learningStep: prefixVerseCount`),
   * and updates the remaining passage with `verses.slice(prefixVerseCount)` (`CARD_STATE_LEARNING`, `learningStep: 1`).
   */
  carveOffPrefixAsNamedChunk(
    cardOrPassageId: string,
    prefixVerseCount: number,
    chunkLabel?: string
  ): { completedChunk: DeckItem; remainingPassage: DeckItem } | undefined {
    const cards = this.flashcards();
    const targetCard =
      cards.find((c) => c.id === cardOrPassageId && !c.isRepairCard) ??
      cards.find((c) => c.passageId === cardOrPassageId && !c.isRepairCard);
    const passage = targetCard
      ? this.passages().find((p) => p.id === targetCard.passageId)
      : undefined;
    const count = Math.round(prefixVerseCount);
    if (!passage || count < 1 || count >= passage.verses.length) {
      return undefined;
    }

    const resolvedChunkLabel = chunkLabel?.trim() || passage.label?.trim() || undefined;
    const labels: Record<number, string> = {};
    if (resolvedChunkLabel) {
      labels[0] = resolvedChunkLabel;
    }
    if (chunkLabel?.trim() && passage.label?.trim()) {
      labels[1] = passage.label.trim();
    }

    const result = this.splitPassageAtBoundaries(cardOrPassageId, [count - 1], labels);
    if (!result || result.segments.length < 2) {
      return undefined;
    }

    return {
      completedChunk: result.segments[0],
      remainingPassage: result.segments[1],
    };
  }

  /**
   * Checks whether 2+ passages (identified by passage ID or card ID) are strictly contiguous
   * and eligible to be combined.
   */
  canCombinePassages(passageIds: string[]): { canCombine: boolean; reason?: string } {
    if (!passageIds || passageIds.length < 2) {
      return { canCombine: false, reason: 'Select at least 2 passages to combine.' };
    }

    const idSet = new Set(passageIds);
    const allPassages = this.passages();
    const allCards = this.flashcards();
    const matchedPassages = new Map<string, Passage>();

    for (const p of allPassages) {
      if (p.id.startsWith('psg_stitched_') || p.id.startsWith('psg_seam_')) {
        continue;
      }
      const mainCard = allCards.find((c) => c.passageId === p.id && !c.isRepairCard);
      if (idSet.has(p.id) || (mainCard && idSet.has(mainCard.id))) {
        matchedPassages.set(p.id, p);
      }
    }

    const list = Array.from(matchedPassages.values());
    if (list.length < 2) {
      return { canCombine: false, reason: 'Select at least 2 base passages to combine.' };
    }

    const result = checkPassagesContiguity(list);
    return {
      canCombine: result.contiguous,
      reason: result.reason,
    };
  }

  /**
   * Merges 2+ strictly contiguous passages (sorted in canonical verse order) into a single combined passage
   * with combined reference, combined `verses`, and `learningStep` equal to the sum of learned verses,
   * removing the old separate passages and calling `syncContiguousStitchedCards()`.
   * Returns `undefined` if the selected passages are not strictly contiguous.
   */
  combinePassages(passageIds: string[], combinedLabel?: string): DeckItem | undefined {
    if (!passageIds || passageIds.length < 2) {
      return undefined;
    }

    const idSet = new Set(passageIds);
    const allPassages = this.passages();
    const allCards = this.flashcards();

    const matchedPassages = new Map<string, { passage: Passage; card: Flashcard }>();
    for (const p of allPassages) {
      if (p.id.startsWith('psg_stitched_') || p.id.startsWith('psg_seam_')) {
        continue;
      }
      const mainCard = allCards.find((c) => c.passageId === p.id && !c.isRepairCard);
      if (!mainCard) {
        continue;
      }
      if (idSet.has(p.id) || idSet.has(mainCard.id)) {
        matchedPassages.set(p.id, { passage: p, card: mainCard });
      }
    }

    const items = Array.from(matchedPassages.values());
    if (items.length < 2) {
      return undefined;
    }

    const contiguity = checkPassagesContiguity(items.map((i) => i.passage));
    if (!contiguity.contiguous) {
      return undefined;
    }

    // Sort in canonical verse order (by chapter and first verse)
    items.sort((a, b) => {
      const aMeta = this.extractBookAndChapterMeta(a.passage);
      const bMeta = this.extractBookAndChapterMeta(b.passage);
      if (aMeta.startChapter !== bMeta.startChapter) {
        return aMeta.startChapter - bMeta.startChapter;
      }
      if (aMeta.startVerse !== bMeta.startVerse) {
        return aMeta.startVerse - bMeta.startVerse;
      }
      return aMeta.endVerse - bMeta.endVerse;
    });

    const combinedVerses: Verse[] = items.flatMap((item) => {
      const meta = this.extractBookAndChapterMeta(item.passage);
      return item.passage.verses.map((v) => ({
        ...v,
        ...(v.chapterNumber && v.chapterNumber > 0
          ? { chapterNumber: v.chapterNumber }
          : meta.startChapter > 0
            ? { chapterNumber: meta.startChapter }
            : {}),
      }));
    });

    if (combinedVerses.length === 0) {
      return undefined;
    }

    const combinedRef = this.computeSubReference(items[0].passage.reference, combinedVerses);
    const explicitLabel = combinedLabel?.trim();
    const fallbackLabels = items
      .map((item) => item.passage.label?.trim())
      .filter((lbl): lbl is string => Boolean(lbl));
    const resolvedLabel =
      explicitLabel || (fallbackLabels.length > 0 ? fallbackLabels.join(' + ') : undefined);

    const learnedVerseSum = items.reduce((sum, item) => {
      const maxForItem = Math.max(1, item.passage.verses.length);
      const itemStep = Math.max(1, Math.min(item.card.learningStep || 1, maxForItem));
      if (item.card.state === CardState.CARD_STATE_NEW && itemStep === 1) {
        return sum;
      }
      return sum + itemStep;
    }, 0);

    const finalStep = Math.max(1, Math.min(learnedVerseSum || 1, combinedVerses.length));
    const anyActive = items.some((item) => item.card.state !== CardState.CARD_STATE_NEW);
    const allReview =
      items.every((item) => item.card.state === CardState.CARD_STATE_REVIEW) &&
      finalStep >= combinedVerses.length;
    const nextState = allReview
      ? CardState.CARD_STATE_REVIEW
      : anyActive
        ? CardState.CARD_STATE_LEARNING
        : CardState.CARD_STATE_NEW;

    const maxInterval = Math.max(0, ...items.map((i) => i.card.intervalDays || 0));
    const maxReps = Math.max(0, ...items.map((i) => i.card.repetitions || 0));

    const now = new Date();
    const isoNow = now.toISOString();
    const combinedPassage: Passage = {
      id: this.generateId('psg'),
      reference: combinedRef,
      verses: combinedVerses,
      createdAt: isoNow,
      updatedAt: isoNow,
      ...(resolvedLabel ? { label: resolvedLabel } : {}),
    };

    const combinedCard: Flashcard = {
      ...this.srs.createInitialFlashcard(combinedPassage.id, now),
      state: nextState,
      learningStep: finalStep,
      intervalDays: maxInterval,
      repetitions: maxReps,
      dueAt: isoNow,
      updatedAt: isoNow,
    };

    const removedPassageIds = new Set(items.map((i) => i.passage.id));
    this.passages.update((prev) => {
      const firstIdx = prev.findIndex((p) => removedPassageIds.has(p.id));
      const filtered = prev.filter((p) => !removedPassageIds.has(p.id));
      if (firstIdx === -1) {
        return [combinedPassage, ...filtered];
      }
      const insertAt = Math.min(firstIdx, filtered.length);
      const next = [...filtered];
      next.splice(insertAt, 0, combinedPassage);
      return next;
    });

    this.flashcards.update((prev) => {
      const filtered = prev.filter((c) => !removedPassageIds.has(c.passageId));
      return [combinedCard, ...filtered];
    });

    this.syncContiguousStitchedCards();
    this.persistToStorage();

    return {
      passage: combinedPassage,
      card: combinedCard,
      isDue: nextState !== CardState.CARD_STATE_NEW && this.srs.isDue(combinedCard, now),
    };
  }

  /**
   * Appends `newVerses` onto the end of an existing passage's `verses[]` (updating `reference` to
   * `updatedReference` or auto-computing the new end verse in the reference e.g. `Romans 8:1-4` + `v. 5-8` -> `Romans 8:1-8`)
   * while preserving the card's existing `learningStep` (`1..oldLength`) and SRS history so the user can incrementally expand!
   */
  appendVersesToPassage(
    passageId: string,
    newVerses: Verse[],
    updatedReference?: string
  ): DeckItem | undefined {
    if (!newVerses || newVerses.length === 0) {
      return undefined;
    }

    const cards = this.flashcards();
    const targetCard =
      cards.find((c) => c.passageId === passageId && !c.isRepairCard) ??
      cards.find((c) => c.id === passageId && !c.isRepairCard);
    const existing = this.passages().find(
      (p) => p.id === (targetCard ? targetCard.passageId : passageId)
    );
    if (!existing || !targetCard) {
      return undefined;
    }

    const oldLength = Math.max(1, existing.verses.length);
    const lastExistingVerse = existing.verses[existing.verses.length - 1];
    const baseVerseNum = lastExistingVerse?.verseNumber ?? existing.verses.length;
    const baseChapterNum = lastExistingVerse?.chapterNumber;

    const cleanAppended: Verse[] = newVerses
      .map((v, idx) => ({
        verseNumber: v.verseNumber > 0 ? v.verseNumber : baseVerseNum + idx + 1,
        text: (v.text ?? '').trim(),
        ...(v.chapterNumber && v.chapterNumber > 0
          ? { chapterNumber: v.chapterNumber }
          : baseChapterNum && baseChapterNum > 0
            ? { chapterNumber: baseChapterNum }
            : {}),
      }))
      .filter((v) => v.text.length > 0);

    if (cleanAppended.length === 0) {
      return undefined;
    }

    const combinedVerses: Verse[] = [...existing.verses, ...cleanAppended];
    const resolvedRef =
      updatedReference?.trim() || this.computeSubReference(existing.reference, combinedVerses);
    const preservedStep = Math.max(1, Math.min(targetCard.learningStep || 1, oldLength));

    const now = new Date();
    const isoNow = now.toISOString();
    const updatedPassage: Passage = {
      ...existing,
      reference: resolvedRef,
      verses: combinedVerses,
      updatedAt: isoNow,
    };

    const updatedCard: Flashcard = {
      ...targetCard,
      learningStep: preservedStep,
      updatedAt: isoNow,
    };

    this.passages.update((prev) =>
      prev.map((p) => (p.id === existing.id ? updatedPassage : p))
    );
    this.flashcards.update((prev) =>
      prev.map((c) => (c.id === targetCard.id ? updatedCard : c))
    );

    this.syncContiguousStitchedCards();
    this.persistToStorage();

    return {
      passage: updatedPassage,
      card: updatedCard,
      isDue:
        updatedCard.state !== CardState.CARD_STATE_NEW && this.srs.isDue(updatedCard, now),
    };
  }

  private computeSubReference(baseReference: string, verses: Verse[]): string {
    if (!verses || verses.length === 0) {
      return baseReference;
    }
    const match = baseReference
      .trim()
      .match(/^((?:[1-3]\s+)?[A-Za-z]+(?:\s+of\s+[A-Za-z]+|\s+[A-Za-z]+)?)\s+(\d+)/i);
    if (!match) {
      return baseReference;
    }
    const bookDisplay = match[1].trim();
    const fallbackChap = parseInt(match[2], 10) || 1;
    const first = verses[0];
    const last = verses[verses.length - 1];
    const startChap =
      first.chapterNumber && first.chapterNumber > 0 ? first.chapterNumber : fallbackChap;
    const endChap =
      last.chapterNumber && last.chapterNumber > 0 ? last.chapterNumber : startChap;

    if (startChap === endChap) {
      if (first.verseNumber === last.verseNumber) {
        return `${bookDisplay} ${startChap}:${first.verseNumber}`;
      }
      return `${bookDisplay} ${startChap}:${first.verseNumber}-${last.verseNumber}`;
    }
    return `${bookDisplay} ${startChap}:${first.verseNumber}-${endChap}:${last.verseNumber}`;
  }

  private extractBookAndChapterMeta(passage: Passage): {
    bookKey: string;
    startChapter: number;
    startVerse: number;
    endChapter: number;
    endVerse: number;
  } {
    const match = passage.reference
      .trim()
      .match(/^((?:[1-3]\s+)?[A-Za-z]+(?:\s+of\s+[A-Za-z]+|\s+[A-Za-z]+)?)\s+(\d+)/i);
    const bookKey = match ? match[1].trim().toLowerCase() : '';
    const refChap = match ? parseInt(match[2], 10) || 1 : 1;
    const first = passage.verses[0];
    const last = passage.verses[passage.verses.length - 1];
    const startChapter =
      first?.chapterNumber && first.chapterNumber > 0 ? first.chapterNumber : refChap;
    const startVerse = first?.verseNumber ?? 1;
    const endChapter =
      last?.chapterNumber && last.chapterNumber > 0 ? last.chapterNumber : startChapter;
    const endVerse = last?.verseNumber ?? startVerse;
    return { bookKey, startChapter, startVerse, endChapter, endVerse };
  }

  /**
   * Parses raw pasted text (and optional explicit reference) and adds it to the Memorization Queue.
   */
  addFromRawText(rawText: string, explicitReference?: string, label?: string): DeckItem {
    const parsed = this.parser.parseRawInput(rawText, explicitReference);
    return this.addPassage(parsed.reference, parsed.verses, label);
  }

  /**
   * Deletes a passage along with its flashcards and review logs.
   */
  deletePassage(passageId: string): void {
    this.deletePassages([passageId]);
  }

  /**
   * Batch deletes multiple passages (accepting either passage IDs or card IDs) along with their flashcards and review logs.
   */
  deletePassages(passageIds: string[]): void {
    if (!passageIds || passageIds.length === 0) {
      return;
    }

    const inputSet = new Set(passageIds);
    const targetPassageIds = new Set<string>(passageIds);
    for (const card of this.flashcards()) {
      if (inputSet.has(card.id)) {
        targetPassageIds.add(card.passageId);
      }
    }

    this.passages.update((prev) => prev.filter((p) => !targetPassageIds.has(p.id)));
    this.flashcards.update((prev) =>
      prev.filter((c) => !targetPassageIds.has(c.passageId) && !inputSet.has(c.id))
    );
    this.reviewLogs.update((prev) => prev.filter((r) => !targetPassageIds.has(r.passageId)));
    this.syncContiguousStitchedCards();
    this.persistToStorage();
  }

  /**
   * Resets a card back to `CardState.CARD_STATE_NEW` (`repetitions = 0`, `intervalDays = 0`,
   * `learningStep = 1`, `isStitchedPassageCard = false`) so the user can move any `DUE` or `KNOWN` card back to `NEW`.
   */
  moveCardToNew(cardOrPassageId: string): void {
    this.moveCardsToNew([cardOrPassageId]);
  }

  /**
   * Batch resets one or more cards back to `CardState.CARD_STATE_NEW`.
   */
  moveCardsToNew(cardOrPassageIds: string[]): void {
    if (!cardOrPassageIds || cardOrPassageIds.length === 0) {
      return;
    }

    const idSet = new Set(cardOrPassageIds);
    const cards = this.flashcards();
    const targetPassageIds = new Set<string>();

    for (const card of cards) {
      if (idSet.has(card.id) || idSet.has(card.passageId)) {
        if (card.isStitchedPassageCard && Array.isArray(card.stitchedPassageIds)) {
          for (const pid of card.stitchedPassageIds) {
            targetPassageIds.add(pid);
          }
        }
        targetPassageIds.add(card.passageId);
      }
    }

    const isoNow = new Date().toISOString();
    this.flashcards.update((prev) =>
      prev
        .filter((c) => !(c.isRepairCard && (idSet.has(c.id) || targetPassageIds.has(c.passageId))))
        .map((c) => {
          if (c.isRepairCard || (!idSet.has(c.id) && !targetPassageIds.has(c.passageId))) {
            return c;
          }
          const updated: Flashcard = {
            ...c,
            state: CardState.CARD_STATE_NEW,
            repetitions: 0,
            intervalDays: 0,
            learningStep: 1,
            isStitchedPassageCard: false,
            dueAt: isoNow,
            updatedAt: isoNow,
          };
          delete updated.stitchedPassageIds;
          return updated;
        })
    );

    this.syncContiguousStitchedCards();
    this.persistToStorage();
  }

  /**
   * Moves `NEW` (or existing) card(s) into the `DUE` / Review deck:
   * sets `state` to `CardState.CARD_STATE_REVIEW` if `knowEntirePassage` is true (otherwise `CardState.CARD_STATE_LEARNING`),
   * sets `learningStep = knowEntirePassage ? passage.verses.length : Math.max(1, card.learningStep || 1)`,
   * and sets `dueAt = new Date().toISOString()`.
   */
  moveCardsToReviewDeck(cardOrPassageIds: string[], knowEntirePassage = false): void {
    if (!cardOrPassageIds || cardOrPassageIds.length === 0) {
      return;
    }

    const idSet = new Set(cardOrPassageIds);
    const passageById = new Map<string, Passage>();
    for (const p of this.passages()) {
      passageById.set(p.id, p);
    }

    const isoNow = new Date().toISOString();
    this.flashcards.update((prev) =>
      prev.map((c) => {
        if (c.isRepairCard || (!idSet.has(c.id) && !idSet.has(c.passageId))) {
          return c;
        }
        const passage = passageById.get(c.passageId);
        const maxVerses = Math.max(1, passage?.verses.length ?? 1);
        const nextStep = knowEntirePassage
          ? maxVerses
          : Math.max(1, Math.min(c.learningStep || 1, maxVerses));
        const nextState = knowEntirePassage
          ? CardState.CARD_STATE_REVIEW
          : c.state === CardState.CARD_STATE_NEW
            ? CardState.CARD_STATE_LEARNING
            : c.state;
        const nextReps = knowEntirePassage ? Math.max(1, c.repetitions || 0) : c.repetitions || 0;

        return {
          ...c,
          state: nextState,
          learningStep: nextStep,
          repetitions: nextReps,
          dueAt: isoNow,
          updatedAt: isoNow,
        };
      })
    );

    this.syncContiguousStitchedCards();
    this.persistToStorage();
  }

  /**
   * Marks the entire passage as known (`learningStep = passage.verses.length`,
   * `state = CardState.CARD_STATE_REVIEW`, `repetitions = Math.max(1, card.repetitions)`,
   * `dueAt = new Date().toISOString()`) so the New/Stitch UI goes away and the full passage enters Review.
   */
  markEntirePassageKnown(cardOrPassageId: string): DeckItem | undefined {
    const cards = this.flashcards();
    const targetCard =
      cards.find((c) => c.id === cardOrPassageId && !c.isRepairCard) ??
      cards.find((c) => c.passageId === cardOrPassageId && !c.isRepairCard);
    if (!targetCard) {
      return undefined;
    }

    const passage = this.passages().find((p) => p.id === targetCard.passageId);
    if (!passage) {
      return undefined;
    }

    const now = new Date();
    const isoNow = now.toISOString();
    const maxVerses = Math.max(1, passage.verses.length);

    const updatedCard: Flashcard = {
      ...targetCard,
      state: CardState.CARD_STATE_REVIEW,
      learningStep: maxVerses,
      repetitions: Math.max(1, targetCard.repetitions || 0),
      dueAt: isoNow,
      updatedAt: isoNow,
    };

    this.flashcards.update((prev) =>
      prev.map((c) => (c.id === targetCard.id ? updatedCard : c))
    );
    this.syncContiguousStitchedCards();
    this.persistToStorage();

    return {
      passage,
      card: updatedCard,
      isDue: this.srs.isDue(updatedCard, now),
    };
  }

  /**
   * Moves a passage directly into active Review/Stitching with `knownVerseCount` verses
   * already marked known (`1 <= k < total` sets `learningStep = k` & `CARD_STATE_LEARNING`;
   * `k >= total` delegates to `markEntirePassageKnown`; `k <= 0` resets to `CARD_STATE_NEW`).
   */
  setKnownVerseCount(cardOrPassageId: string, knownVerseCount: number): DeckItem | undefined {
    const cards = this.flashcards();
    const targetCard =
      cards.find((c) => c.id === cardOrPassageId && !c.isRepairCard) ??
      cards.find((c) => c.passageId === cardOrPassageId && !c.isRepairCard);
    if (!targetCard) {
      return undefined;
    }

    const passage = this.passages().find((p) => p.id === targetCard.passageId);
    if (!passage) {
      return undefined;
    }

    const total = Math.max(1, passage.verses.length);
    const k = Math.max(0, Math.min(Math.floor(knownVerseCount), total));

    if (k <= 0) {
      this.moveCardsToNew([targetCard.id]);
      const updated = this.flashcards().find((c) => c.id === targetCard.id) ?? targetCard;
      return {
        passage,
        card: updated,
        isDue: false,
      };
    }

    if (k >= total) {
      return this.markEntirePassageKnown(targetCard.id);
    }

    const now = new Date();
    const isoNow = now.toISOString();
    const nextState =
      targetCard.state === CardState.CARD_STATE_NEW
        ? CardState.CARD_STATE_LEARNING
        : targetCard.state;
    const nextDueAt =
      targetCard.state === CardState.CARD_STATE_NEW ? isoNow : targetCard.dueAt;

    const updatedCard: Flashcard = {
      ...targetCard,
      state: nextState,
      learningStep: k,
      dueAt: nextDueAt,
      updatedAt: isoNow,
    };

    this.flashcards.update((prev) =>
      prev.map((c) => (c.id === targetCard.id ? updatedCard : c))
    );
    this.syncContiguousStitchedCards();
    this.persistToStorage();

    return {
      passage,
      card: updatedCard,
      isDue: this.srs.isDue(updatedCard, now),
    };
  }

  /**
   * Deletes a specific flashcard (such as dismissing a temporary repair card).
   */
  deleteCard(cardId: string): void {
    this.flashcards.update((prev) => prev.filter((c) => c.id !== cardId));
    this.persistToStorage();
  }

  /**
   * Grades a flashcard, updates its SRS state, appends a ReviewLog entry, and persists to ProtoJSON.
   * If the card is a temporary Repair Card and reaches `repairTargetStreak` consecutive Good/Easy reviews,
   * it is marked `healed: true` and automatically removed from `this.flashcards`.
   */
  recordReview(cardId: string, rating: ReviewRating): DeckItem | undefined {
    const cards = this.flashcards();
    const targetCard =
      cards.find((c) => c.id === cardId) ??
      cards.find((c) => c.passageId === cardId && !c.isRepairCard);
    if (!targetCard) {
      return undefined;
    }

    const now = new Date();
    const isoNow = now.toISOString();
    const { updatedCard, reviewLog } = this.srs.gradeCard(targetCard, rating, now);
    const passage = this.passages().find((p) => p.id === updatedCard.passageId);

    if (targetCard.isRepairCard) {
      const targetStreak = targetCard.repairTargetStreak || 3;
      const currentStreak = targetCard.repairStreak ?? 0;

      if (
        rating === ReviewRating.REVIEW_RATING_GOOD ||
        rating === ReviewRating.REVIEW_RATING_EASY
      ) {
        const nextStreak = currentStreak + 1;
        const healedCard: Flashcard = {
          ...updatedCard,
          state: CardState.CARD_STATE_LEARNING,
          isRepairCard: true,
          repairVerseNumber: targetCard.repairVerseNumber,
          repairStreak: nextStreak,
          repairTargetStreak: targetStreak,
          parentCardId: targetCard.parentCardId,
          ...(targetCard.repairChapterNumber
            ? { repairChapterNumber: targetCard.repairChapterNumber }
            : {}),
          ...(targetCard.repairEndVerseNumber
            ? { repairEndVerseNumber: targetCard.repairEndVerseNumber }
            : {}),
          ...(targetCard.repairEndChapterNumber
            ? { repairEndChapterNumber: targetCard.repairEndChapterNumber }
            : {}),
        };

        if (nextStreak >= targetStreak) {
          // Healed! Retire the temporary repair card from flashcards
          this.flashcards.update((prev) => prev.filter((c) => c.id !== targetCard.id));
          this.reviewLogs.update((prev) => [reviewLog, ...prev]);
          this.persistToStorage();

          if (!passage) {
            return undefined;
          }
          return {
            passage,
            card: healedCard,
            isDue: false,
            healed: true,
          };
        }

        // Still healing: keep in learning state so user can continue or review on schedule
        this.flashcards.update((prev) =>
          prev.map((c) => (c.id === targetCard.id ? healedCard : c))
        );
        this.reviewLogs.update((prev) => [reviewLog, ...prev]);
        this.persistToStorage();

        if (!passage) {
          return undefined;
        }
        return {
          passage,
          card: healedCard,
          isDue: this.srs.isDue(healedCard, now),
          healed: false,
        };
      }

      // Rating is AGAIN or HARD on a repair card
      const nextStreak = rating === ReviewRating.REVIEW_RATING_AGAIN ? 0 : currentStreak;
      const ongoingRepairCard: Flashcard = {
        ...updatedCard,
        state: CardState.CARD_STATE_LEARNING,
        dueAt: rating === ReviewRating.REVIEW_RATING_AGAIN ? isoNow : updatedCard.dueAt,
        isRepairCard: true,
        repairVerseNumber: targetCard.repairVerseNumber,
        repairStreak: nextStreak,
        repairTargetStreak: targetStreak,
        parentCardId: targetCard.parentCardId,
        ...(targetCard.repairChapterNumber
          ? { repairChapterNumber: targetCard.repairChapterNumber }
          : {}),
        ...(targetCard.repairEndVerseNumber
          ? { repairEndVerseNumber: targetCard.repairEndVerseNumber }
          : {}),
        ...(targetCard.repairEndChapterNumber
          ? { repairEndChapterNumber: targetCard.repairEndChapterNumber }
          : {}),
      };

      this.flashcards.update((prev) =>
        prev.map((c) => (c.id === targetCard.id ? ongoingRepairCard : c))
      );
      this.reviewLogs.update((prev) => [reviewLog, ...prev]);
      this.persistToStorage();

      if (!passage) {
        return undefined;
      }
      return {
        passage,
        card: ongoingRepairCard,
        isDue: this.srs.isDue(ongoingRepairCard, now),
        healed: false,
      };
    }

    const maxVerses = Math.max(1, passage?.verses.length ?? 1);
    const preservedStep = Math.max(1, Math.min(targetCard.learningStep || 1, maxVerses));
    const finalUpdatedCard: Flashcard = {
      ...updatedCard,
      learningStep: preservedStep,
      ...(targetCard.isStitchedPassageCard
        ? {
            isStitchedPassageCard: true,
            stitchedPassageIds: targetCard.stitchedPassageIds ?? [],
          }
        : {}),
    };

    this.flashcards.update((prev) =>
      prev.map((c) => (c.id === targetCard.id ? finalUpdatedCard : c))
    );
    this.reviewLogs.update((prev) => [reviewLog, ...prev]);
    this.syncContiguousStitchedCards();
    this.persistToStorage();

    if (!passage) {
      return undefined;
    }

    return {
      passage,
      card: finalUpdatedCard,
      isDue:
        finalUpdatedCard.state !== CardState.CARD_STATE_NEW &&
        this.srs.isDue(finalUpdatedCard, now),
    };
  }

  /**
   * Builds a canonical persisted seam boundary key between two contiguous passages.
   * Normalizes e.g. `Psalms` -> `psalm` so boundaries match consistently across cards and Outline.
   */
  buildSeamKey(
    bookDisplayOrKey: string,
    leftEndChapter: number,
    leftEndVerse: number,
    rightStartChapter: number,
    rightStartVerse: number
  ): string {
    const bookKey = normalizeBookKey(bookDisplayOrKey);
    return `${bookKey}:${leftEndChapter}:${leftEndVerse}->${rightStartChapter}:${rightStartVerse}`;
  }

  isCrossChapterPsalmBoundary(
    bookDisplayOrKey: string,
    leftEndChapter: number,
    rightStartChapter: number
  ): boolean {
    return normalizeBookKey(bookDisplayOrKey) === 'psalm' && leftEndChapter !== rightStartChapter;
  }

  isSeamKeyLinked(seamKey: string, isCrossChapterPsalm = false): boolean {
    if (isCrossChapterPsalm) {
      return this.enabledSeamKeys().includes(seamKey);
    }
    return !this.suppressedSeamKeys().includes(seamKey);
  }

  isSeamBoundaryLinked(
    bookDisplayOrKey: string,
    leftEndChapter: number,
    leftEndVerse: number,
    rightStartChapter: number,
    rightStartVerse: number
  ): boolean {
    const key = this.buildSeamKey(
      bookDisplayOrKey,
      leftEndChapter,
      leftEndVerse,
      rightStartChapter,
      rightStartVerse
    );
    const isCrossChapPsalm = this.isCrossChapterPsalmBoundary(
      bookDisplayOrKey,
      leftEndChapter,
      rightStartChapter
    );
    return this.isSeamKeyLinked(key, isCrossChapPsalm);
  }

  /**
   * Toggles linking for a single contiguous boundary and immediately updates stitched cards + persistence.
   * Returns the new linked state (`true` = auto-stitched, `false` = unlinked).
   */
  toggleSeamBoundary(
    bookDisplayOrKey: string,
    leftEndChapter: number,
    leftEndVerse: number,
    rightStartChapter: number,
    rightStartVerse: number
  ): boolean {
    const nextLinked = !this.isSeamBoundaryLinked(
      bookDisplayOrKey,
      leftEndChapter,
      leftEndVerse,
      rightStartChapter,
      rightStartVerse
    );
    this.setSeamBoundariesLinked(
      [
        {
          bookDisplay: bookDisplayOrKey,
          leftEndChapter,
          leftEndVerse,
          rightStartChapter,
          rightStartVerse,
        },
      ],
      nextLinked
    );
    return nextLinked;
  }

  /**
   * Links or unlinks a batch of contiguous seam boundaries in one atomic storage update.
   */
  setSeamBoundariesLinked(
    boundaries: Array<{
      bookDisplay: string;
      leftEndChapter: number;
      leftEndVerse: number;
      rightStartChapter: number;
      rightStartVerse: number;
    }>,
    linked: boolean
  ): void {
    if (!boundaries || boundaries.length === 0) {
      return;
    }

    const suppressed = new Set(this.suppressedSeamKeys());
    const enabled = new Set(this.enabledSeamKeys());

    for (const b of boundaries) {
      const key = this.buildSeamKey(
        b.bookDisplay,
        b.leftEndChapter,
        b.leftEndVerse,
        b.rightStartChapter,
        b.rightStartVerse
      );
      const isCrossChapPsalm = this.isCrossChapterPsalmBoundary(
        b.bookDisplay,
        b.leftEndChapter,
        b.rightStartChapter
      );

      if (isCrossChapPsalm) {
        suppressed.delete(key);
        if (linked) {
          enabled.add(key);
        } else {
          enabled.delete(key);
        }
      } else {
        enabled.delete(key);
        if (linked) {
          suppressed.delete(key);
        } else {
          suppressed.add(key);
        }
      }
    }

    this.suppressedSeamKeys.set(Array.from(suppressed));
    this.enabledSeamKeys.set(Array.from(enabled));
    this.syncContiguousStitchedCards();
    this.persistToStorage();
  }

  /**
   * Automatically synchronizes Seam Review Cards (2-verse handoff between adjacent chunks A and B)
   * and Full Contiguous Stitched Passage Cards across any run of >=2 contiguous memorized passages
   * in the same biblical book.
   */
  syncContiguousStitchedCards(): void {
    const allPassages = this.passages();
    const allCards = this.flashcards();

    const basePassages = allPassages.filter(
      (p) => !p.id.startsWith('psg_stitched_') && !p.id.startsWith('psg_seam_')
    );
    const existingAutoPassagesById = new Map<string, Passage>();
    for (const p of allPassages) {
      if (p.id.startsWith('psg_stitched_') || p.id.startsWith('psg_seam_')) {
        existingAutoPassagesById.set(p.id, p);
      }
    }

    const mainCardByPassageId = new Map<string, Flashcard>();
    const existingAutoCardsById = new Map<string, Flashcard>();
    const nonAutoCards: Flashcard[] = [];

    for (const c of allCards) {
      if (c.isStitchedPassageCard || c.id.startsWith('card_stitched_') || c.id.startsWith('card_seam_')) {
        existingAutoCardsById.set(c.id, c);
      } else {
        nonAutoCards.push(c);
        if (!c.isRepairCard) {
          mainCardByPassageId.set(c.passageId, c);
        }
      }
    }

    interface ParsedPassageSpan {
      passage: Passage;
      card: Flashcard;
      bookKey: string;
      bookDisplay: string;
      startChapter: number;
      startVerse: number;
      endChapter: number;
      endVerse: number;
    }

    const memorizedSpansByBook = new Map<string, ParsedPassageSpan[]>();

    for (const passage of basePassages) {
      if (!passage.verses || passage.verses.length === 0) {
        continue;
      }
      const card = mainCardByPassageId.get(passage.id);
      if (!card || card.state === CardState.CARD_STATE_NEW) {
        continue;
      }
      const step = card.learningStep || 1;
      if (step < passage.verses.length) {
        continue;
      }

      const bookMatch = passage.reference
        .trim()
        .match(/^((?:[1-3]\s+)?[A-Za-z]+(?:\s+of\s+[A-Za-z]+|\s+[A-Za-z]+)?)\s+(\d+)/i);
      if (!bookMatch) {
        continue;
      }

      const bookDisplay = bookMatch[1].trim();
      const bookKey = normalizeBookKey(bookDisplay);
      const firstNumber = parseInt(bookMatch[2], 10) || 1;
      const isSingleChapterNoColon =
        SINGLE_CHAPTER_BOOKS.has(bookKey) && !passage.reference.includes(':');
      const refChapter = isSingleChapterNoColon ? 1 : firstNumber;

      const firstVerse = passage.verses[0];
      const lastVerse = passage.verses[passage.verses.length - 1];
      const startChapter =
        firstVerse.chapterNumber && firstVerse.chapterNumber > 0
          ? firstVerse.chapterNumber
          : refChapter;
      const startVerse = firstVerse.verseNumber;
      const endChapter =
        lastVerse.chapterNumber && lastVerse.chapterNumber > 0
          ? lastVerse.chapterNumber
          : startChapter;
      const endVerse = lastVerse.verseNumber;

      const list = memorizedSpansByBook.get(bookKey) ?? [];
      list.push({
        passage,
        card,
        bookKey,
        bookDisplay,
        startChapter,
        startVerse,
        endChapter,
        endVerse,
      });
      memorizedSpansByBook.set(bookKey, list);
    }

    const now = new Date();
    const isoNow = now.toISOString();
    const activeAutoPassages: Passage[] = [];
    const activeAutoCards: Flashcard[] = [];

    for (const spans of memorizedSpansByBook.values()) {
      spans.sort((a, b) => {
        if (a.startChapter !== b.startChapter) {
          return a.startChapter - b.startChapter;
        }
        if (a.startVerse !== b.startVerse) {
          return a.startVerse - b.startVerse;
        }
        if (a.endChapter !== b.endChapter) {
          return a.endChapter - b.endChapter;
        }
        return a.endVerse - b.endVerse;
      });

      // Group into maximal contiguous runs of >=2 passages
      let currentRun: ParsedPassageSpan[] = [];
      const runs: ParsedPassageSpan[][] = [];

      for (const span of spans) {
        if (currentRun.length === 0) {
          currentRun.push(span);
          continue;
        }
        const prev = currentRun[currentRun.length - 1];
        const isSameChapAdjacent =
          span.startChapter === prev.endChapter && span.startVerse === prev.endVerse + 1;
        const isNextChapStart =
          span.startChapter === prev.endChapter + 1 &&
          span.startVerse === 1 &&
          isEndOfChapter(prev.bookDisplay, prev.endChapter, prev.endVerse);

        const isContiguous = isSameChapAdjacent || isNextChapStart;
        const isLinked =
          isContiguous &&
          this.isSeamBoundaryLinked(
            prev.bookKey,
            prev.endChapter,
            prev.endVerse,
            span.startChapter,
            span.startVerse
          );

        if (isLinked) {
          currentRun.push(span);
        } else {
          if (currentRun.length >= 2) {
            runs.push(currentRun);
          }
          currentRun = [span];
        }
      }
      if (currentRun.length >= 2) {
        runs.push(currentRun);
      }

      for (const run of runs) {
        // 1. Emit Seam Review Cards between each adjacent pair (A, B) when A + B has >2 total verses
        for (let i = 0; i < run.length - 1; i++) {
          const left = run[i];
          const right = run[i + 1];
          if (left.passage.verses.length + right.passage.verses.length <= 2) {
            continue;
          }

          const lastOfLeft = left.passage.verses[left.passage.verses.length - 1];
          const firstOfRight = right.passage.verses[0];
          const seamChapLeft = lastOfLeft.chapterNumber ?? left.endChapter;
          const seamChapRight = firstOfRight.chapterNumber ?? right.startChapter;

          const seamVerses: Verse[] = [
            {
              ...lastOfLeft,
              chapterNumber: seamChapLeft,
            },
            {
              ...firstOfRight,
              chapterNumber: seamChapRight,
            },
          ];

          const seamRef =
            seamChapLeft === seamChapRight
              ? `${left.bookDisplay} ${seamChapLeft}:${lastOfLeft.verseNumber}-${firstOfRight.verseNumber}`
              : `${left.bookDisplay} ${seamChapLeft}:${lastOfLeft.verseNumber}-${seamChapRight}:${firstOfRight.verseNumber}`;

          const leftName = left.passage.label?.trim() || left.passage.reference;
          const rightName = right.passage.label?.trim() || right.passage.reference;
          const seamLabel = `Seam: ${leftName} → ${rightName}`;

          const pairKey = `${left.passage.id}__${right.passage.id}`;
          const seamPassageId = `psg_seam_${pairKey}`;
          const seamCardId = `card_seam_${pairKey}`;

          const existingSeamPassage = existingAutoPassagesById.get(seamPassageId);
          const seamPassage: Passage = {
            id: seamPassageId,
            reference: seamRef,
            verses: seamVerses,
            label: seamLabel,
            createdAt: existingSeamPassage?.createdAt ?? isoNow,
            updatedAt: isoNow,
          };

          const existingSeamCard = existingAutoCardsById.get(seamCardId);
          const seamCard: Flashcard = existingSeamCard
            ? {
                ...existingSeamCard,
                passageId: seamPassageId,
                learningStep: seamVerses.length,
                isStitchedPassageCard: true,
                stitchedPassageIds: [left.passage.id, right.passage.id],
                updatedAt: isoNow,
              }
            : {
                ...this.srs.createInitialFlashcard(seamPassageId, now),
                id: seamCardId,
                state: CardState.CARD_STATE_LEARNING,
                learningStep: seamVerses.length,
                dueAt: isoNow,
                isStitchedPassageCard: true,
                stitchedPassageIds: [left.passage.id, right.passage.id],
              };

          activeAutoPassages.push(seamPassage);
          activeAutoCards.push(seamCard);
        }

        // 2. Emit Full Contiguous Stitched Passage Card across the entire run
        const firstSpan = run[0];
        const lastSpan = run[run.length - 1];
        const runIds = run.map((r) => r.passage.id);
        const runKey = runIds.join('__');
        const stitchedPassageId = `psg_stitched_${runKey}`;
        const stitchedCardId = `card_stitched_${runKey}`;

        const stitchedVerses: Verse[] = run.flatMap((r) =>
          r.passage.verses.map((v) => ({
            ...v,
            chapterNumber: v.chapterNumber ?? r.startChapter,
          }))
        );

        const stitchedRef =
          firstSpan.startChapter === lastSpan.endChapter
            ? `${firstSpan.bookDisplay} ${firstSpan.startChapter}:${firstSpan.startVerse}-${lastSpan.endVerse}`
            : `${firstSpan.bookDisplay} ${firstSpan.startChapter}:${firstSpan.startVerse}-${lastSpan.endChapter}:${lastSpan.endVerse}`;

        const customLabels = run
          .map((r) => r.passage.label?.trim())
          .filter((lbl): lbl is string => Boolean(lbl));
        const stitchedLabel =
          customLabels.length > 0
            ? `Stitched: ${customLabels.join(' → ')}`
            : `Stitched: ${run.map((r) => r.passage.reference).join(' + ')}`;

        const existingStitchedPassage = existingAutoPassagesById.get(stitchedPassageId);
        const stitchedPassage: Passage = {
          id: stitchedPassageId,
          reference: stitchedRef,
          verses: stitchedVerses,
          label: stitchedLabel,
          createdAt: existingStitchedPassage?.createdAt ?? isoNow,
          updatedAt: isoNow,
        };

        const existingStitchedCard = existingAutoCardsById.get(stitchedCardId);
        const stitchedCard: Flashcard = existingStitchedCard
          ? {
              ...existingStitchedCard,
              passageId: stitchedPassageId,
              learningStep: stitchedVerses.length,
              isStitchedPassageCard: true,
              stitchedPassageIds: runIds,
              updatedAt: isoNow,
            }
          : {
              ...this.srs.createInitialFlashcard(stitchedPassageId, now),
              id: stitchedCardId,
              state: CardState.CARD_STATE_LEARNING,
              learningStep: stitchedVerses.length,
              dueAt: isoNow,
              isStitchedPassageCard: true,
              stitchedPassageIds: runIds,
            };

        activeAutoPassages.push(stitchedPassage);
        activeAutoCards.push(stitchedCard);
      }
    }

    this.passages.set([...basePassages, ...activeAutoPassages]);
    this.flashcards.set([...nonAutoCards, ...activeAutoCards]);
  }

  /**
   * Exports all user data as a Proto3-compliant JSON string.
   */
  exportProtoJson(pretty = true): string {
    const bundle: UserDataBundle = {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      passages: this.passages(),
      flashcards: this.flashcards(),
      reviewLogs: this.reviewLogs(),
      suppressedSeamKeys: this.suppressedSeamKeys(),
      enabledSeamKeys: this.enabledSeamKeys(),
    };
    return ProtoJsonCodec.serializeBundle(bundle, pretty);
  }

  /**
   * Imports a Proto3 JSON string into storage.
   * When `merge` is true, merges passages/cards/logs by ID; otherwise replaces existing data.
   */
  importProtoJson(jsonString: string, merge = false): void {
    const bundle = ProtoJsonCodec.deserializeBundle(jsonString);

    if (!merge) {
      const passages = bundle.passages;
      const flashcards = this.ensureFlashcardsForPassages(passages, bundle.flashcards);
      this.passages.set(passages);
      this.flashcards.set(flashcards);
      this.reviewLogs.set(bundle.reviewLogs);
      this.suppressedSeamKeys.set(bundle.suppressedSeamKeys ?? []);
      this.enabledSeamKeys.set(bundle.enabledSeamKeys ?? []);
      this.syncContiguousStitchedCards();
      this.persistToStorage();
      return;
    }

    // Merge by ID
    const passageMap = new Map<string, Passage>();
    for (const p of this.passages()) {
      passageMap.set(p.id, p);
    }
    for (const p of bundle.passages) {
      passageMap.set(p.id, p);
    }

    const cardMap = new Map<string, Flashcard>();
    for (const c of this.flashcards()) {
      cardMap.set(c.id, c);
    }
    for (const c of bundle.flashcards) {
      cardMap.set(c.id, c);
    }

    const logMap = new Map<string, ReviewLog>();
    for (const r of this.reviewLogs()) {
      logMap.set(r.id, r);
    }
    for (const r of bundle.reviewLogs) {
      logMap.set(r.id, r);
    }

    const mergedPassages = Array.from(passageMap.values());
    const mergedCards = this.ensureFlashcardsForPassages(
      mergedPassages,
      Array.from(cardMap.values())
    );
    const mergedSuppressed = Array.from(
      new Set([...this.suppressedSeamKeys(), ...(bundle.suppressedSeamKeys ?? [])])
    );
    const mergedEnabled = Array.from(
      new Set([...this.enabledSeamKeys(), ...(bundle.enabledSeamKeys ?? [])])
    );

    this.passages.set(mergedPassages);
    this.flashcards.set(mergedCards);
    this.reviewLogs.set(Array.from(logMap.values()));
    this.suppressedSeamKeys.set(mergedSuppressed);
    this.enabledSeamKeys.set(mergedEnabled);
    this.syncContiguousStitchedCards();
    this.persistToStorage();
  }

  /**
   * Clears all passages, flashcards, and review logs back to a clean empty state.
   */
  clearAllData(): void {
    this.passages.set([]);
    this.flashcards.set([]);
    this.reviewLogs.set([]);
    this.suppressedSeamKeys.set([]);
    this.enabledSeamKeys.set([]);
    this.persistToStorage();
  }

  /**
   * Resets the deck to a clean empty state (no demo passages).
   */
  resetToDefaults(): void {
    this.clearAllData();
  }

  private loadFromStorage(): void {
    if (typeof localStorage === 'undefined') {
      this.passages.set([]);
      this.flashcards.set([]);
      this.reviewLogs.set([]);
      this.suppressedSeamKeys.set([]);
      this.enabledSeamKeys.set([]);
      this.hasUnsavedFileChanges.set(false);
      return;
    }

    try {
      const unsavedFlag = localStorage.getItem(UNSAVED_FILE_CHANGES_KEY) === 'true';
      this.hasUnsavedFileChanges.set(unsavedFlag);
    } catch {
      this.hasUnsavedFileChanges.set(false);
    }

    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        this.passages.set([]);
        this.flashcards.set([]);
        this.reviewLogs.set([]);
        this.suppressedSeamKeys.set([]);
        this.enabledSeamKeys.set([]);
        return;
      }

      const bundle = ProtoJsonCodec.deserializeBundle(raw);
      if (!bundle.passages || bundle.passages.length === 0) {
        this.passages.set([]);
        this.flashcards.set([]);
        this.reviewLogs.set([]);
        this.suppressedSeamKeys.set(bundle.suppressedSeamKeys ?? []);
        this.enabledSeamKeys.set(bundle.enabledSeamKeys ?? []);
        return;
      }

      // Clean up legacy auto-seeded demo deck if the user never added their own passages or reviews
      const isLegacyAutoSeededDemoDeck =
        (bundle.reviewLogs?.length ?? 0) === 0 &&
        bundle.passages.every((p) => p.id.startsWith('psg_seed_'));

      if (isLegacyAutoSeededDemoDeck) {
        this.clearAllData();
        return;
      }

      const flashcards = this.ensureFlashcardsForPassages(bundle.passages, bundle.flashcards);
      this.suppressedSeamKeys.set(bundle.suppressedSeamKeys ?? []);
      this.enabledSeamKeys.set(bundle.enabledSeamKeys ?? []);
      this.passages.set(bundle.passages);
      this.flashcards.set(flashcards);
      this.reviewLogs.set(bundle.reviewLogs ?? []);
      this.syncContiguousStitchedCards();
    } catch {
      this.passages.set([]);
      this.flashcards.set([]);
      this.reviewLogs.set([]);
      this.suppressedSeamKeys.set([]);
      this.enabledSeamKeys.set([]);
    }
  }

  private setUnsavedFileChanges(dirty: boolean): void {
    this.hasUnsavedFileChanges.set(dirty);
    if (typeof localStorage !== 'undefined') {
      try {
        if (dirty) {
          localStorage.setItem(UNSAVED_FILE_CHANGES_KEY, 'true');
        } else {
          localStorage.removeItem(UNSAVED_FILE_CHANGES_KEY);
        }
      } catch {
        // Ignore storage errors
      }
    }
  }

  private persistToStorage(): void {
    if (typeof localStorage !== 'undefined') {
      try {
        const serialized = this.exportProtoJson(false);
        localStorage.setItem(STORAGE_KEY, serialized);
      } catch {
        // Ignore quota/storage errors in restricted environments
      }
    }

    // Rate-limit / debounce background writes to the Active Memory Data File by 600ms
    if (this.fileHandle || this.isSimulatedFile) {
      if (this.isSimulatedFile) {
        const nowIso = new Date().toISOString();
        const currentName = this.activeFileName() ?? DEFAULT_MEMORY_FILE_NAME;
        this.saveSimulatedFileMeta(currentName, nowIso, this.exportProtoJson(true));
        this.lastFileSavedAt.set(nowIso);
        this.setUnsavedFileChanges(false);
        this.activeFileStatus.set('saved');
      } else {
        // Mark as having unsaved changes until the background file write succeeds
        this.setUnsavedFileChanges(true);
      }
      this.scheduleDebouncedFileWrite();
    }
  }

  private scheduleDebouncedFileWrite(): void {
    if (!this.fileHandle && !this.isSimulatedFile) {
      return;
    }
    this.clearFileSaveDebounceTimer();
    this.fileSaveDebounceTimer = setTimeout(() => {
      this.fileSaveDebounceTimer = null;
      void this.writeToActiveFileHandle(false);
    }, FILE_SAVE_DEBOUNCE_MS);
  }

  private clearFileSaveDebounceTimer(): void {
    if (this.fileSaveDebounceTimer !== null) {
      clearTimeout(this.fileSaveDebounceTimer);
      this.fileSaveDebounceTimer = null;
    }
  }

  private registerLifecycleFlushListeners(): void {
    if (this.lifecycleFlushListenersRegistered || typeof window === 'undefined') {
      return;
    }
    this.lifecycleFlushListenersRegistered = true;

    window.addEventListener('beforeunload', () => {
      if (this.fileSaveDebounceTimer !== null) {
        this.clearFileSaveDebounceTimer();
        void this.writeToActiveFileHandle(false);
      }
    });

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden' && this.fileSaveDebounceTimer !== null) {
          this.clearFileSaveDebounceTimer();
          void this.writeToActiveFileHandle(false);
        }
      });
    }
  }

  private setFileError(err: string | null): void {
    this.lastFileSaveError.set(err);
    this.fileSyncError.set(err);
  }

  private async writeToActiveFileHandle(requestPermIfNeeded = false): Promise<void> {
    if (!this.fileHandle && !this.isSimulatedFile) {
      return;
    }

    this.clearFileSaveDebounceTimer();

    if (this.isWritingFile) {
      this.pendingWriteRequested = true;
      return;
    }

    this.isWritingFile = true;
    this.isSavingToFile.set(true);
    this.setFileError(null);
    this.activeFileStatus.set('saving');

    try {
      do {
        this.pendingWriteRequested = false;
        const prettyPayload = this.exportProtoJson(true);

        if (this.isSimulatedFile) {
          const nowIso = new Date().toISOString();
          const currentName = this.activeFileName() ?? DEFAULT_MEMORY_FILE_NAME;
          this.saveSimulatedFileMeta(currentName, nowIso, prettyPayload);
          this.lastFileSavedAt.set(nowIso);
          this.setUnsavedFileChanges(false);
          this.activeFileStatus.set('saved');
        } else if (this.fileHandle) {
          if (typeof this.fileHandle.queryPermission === 'function') {
            let perm = await this.fileHandle.queryPermission({ mode: 'readwrite' });
            if (
              perm !== 'granted' &&
              requestPermIfNeeded &&
              typeof this.fileHandle.requestPermission === 'function'
            ) {
              try {
                perm = await this.fileHandle.requestPermission({ mode: 'readwrite' });
              } catch {
                this.setUnsavedFileChanges(true);
                this.activeFileStatus.set('needs-permission');
                return;
              }
            }
            if (perm !== 'granted') {
              // Never call requestPermission in the background! Keep changes safely in localStorage and flag unsaved state.
              this.setUnsavedFileChanges(true);
              this.activeFileStatus.set('needs-permission');
              return;
            }
          }

          const writable = await this.fileHandle.createWritable();
          await writable.write(prettyPayload);
          await writable.close();

          const nowIso = new Date().toISOString();
          this.lastFileSavedAt.set(nowIso);
          this.setUnsavedFileChanges(false);
          this.activeFileStatus.set('saved');
        }
      } while (this.pendingWriteRequested);
    } catch (err: unknown) {
      this.setUnsavedFileChanges(true);
      if (err instanceof DOMException && err.name === 'SecurityError') {
        this.activeFileStatus.set('needs-permission');
        return;
      }
      this.setFileError(
        err instanceof Error ? err.message : 'Auto-save to active file failed.'
      );
      this.activeFileStatus.set('error');
    } finally {
      this.isWritingFile = false;
      this.isSavingToFile.set(false);
    }
  }

  private async restoreActiveFileConnection(): Promise<void> {
    // Always clean up any legacy simulated/virtual file keys in localStorage so a phantom file never appears on startup
    this.clearSimulatedFileMeta();

    // Check if a genuine native FileSystemFileHandle was stored in IndexedDB
    const savedHandle = await this.loadHandleFromIndexedDb();
    if (
      !savedHandle ||
      typeof savedHandle.getFile !== 'function' ||
      typeof savedHandle.createWritable !== 'function'
    ) {
      return;
    }

    this.fileHandle = savedHandle;
    this.activeFileName.set(savedHandle.name);

    try {
      if (typeof savedHandle.queryPermission === 'function') {
        const perm = await savedHandle.queryPermission({ mode: 'readwrite' });
        if (perm === 'granted') {
          this.activeFileStatus.set('saved');
          if (this.hasUnsavedFileChanges()) {
            await this.writeToActiveFileHandle(false);
          }
        } else {
          // Do NOT ambush the user with a permission popup on first click; stay in needs-permission
          this.activeFileStatus.set('needs-permission');
        }
      } else {
        this.activeFileStatus.set('saved');
      }
    } catch {
      this.activeFileStatus.set('needs-permission');
    }
  }

  private triggerBrowserFileDownload(fileName: string, content: string): void {
    if (typeof document === 'undefined' || typeof Blob === 'undefined') {
      return;
    }
    try {
      const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = fileName;
      anchor.style.display = 'none';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      // Ignore download errors in headless environments
    }
  }

  private selectFileViaInputElement(): Promise<boolean> {
    if (typeof document === 'undefined') {
      return Promise.resolve(false);
    }

    return new Promise<boolean>((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.selahmemory,.json,.proto.json,application/json';
      input.style.display = 'none';

      input.onchange = async () => {
        const file = input.files?.[0];
        input.remove();
        if (!file) {
          resolve(false);
          return;
        }

        try {
          const text = await file.text();
          if (text.trim().length > 0) {
            this.importProtoJson(text, false);
          }
          await this.connectSimulatedDataFile(file.name);
          resolve(true);
        } catch (err: unknown) {
          this.setFileError(
            err instanceof Error ? err.message : 'Invalid memory file selected.'
          );
          if (!this.fileHandle && !this.isSimulatedFile) {
            this.activeFileName.set(null);
            this.activeFileStatus.set('none');
          } else {
            this.activeFileStatus.set('error');
          }
          resolve(false);
        }
      };

      input.oncancel = () => {
        input.remove();
        resolve(false);
      };

      document.body.appendChild(input);
      input.click();
    });
  }

  private saveSimulatedFileMeta(_fileName: string, _savedAt: string, content?: string): void {
    if (typeof localStorage === 'undefined') {
      return;
    }
    try {
      // Never persist VIRTUAL_FILE_META_KEY across reloads so phantom active files cannot appear on startup
      localStorage.removeItem(VIRTUAL_FILE_META_KEY);
      localStorage.removeItem('bible_memory_virtual_file_meta_v1');
      if (content !== undefined) {
        localStorage.setItem(VIRTUAL_FILE_CONTENT_KEY, content);
      }
    } catch {
      // Ignore storage errors
    }
  }

  private clearSimulatedFileMeta(): void {
    if (typeof localStorage === 'undefined') {
      return;
    }
    try {
      localStorage.removeItem(VIRTUAL_FILE_META_KEY);
      localStorage.removeItem(VIRTUAL_FILE_CONTENT_KEY);
      localStorage.removeItem('bible_memory_virtual_file_meta_v1');
    } catch {
      // Ignore storage errors
    }
  }

  private openHandleDb(): Promise<IDBDatabase | null> {
    if (typeof indexedDB === 'undefined') {
      return Promise.resolve(null);
    }
    return new Promise((resolve) => {
      try {
        const request = indexedDB.open(FILE_HANDLE_DB_NAME, 1);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(FILE_HANDLE_STORE_NAME)) {
            db.createObjectStore(FILE_HANDLE_STORE_NAME);
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }

  private async saveHandleToIndexedDb(handle: BrowserFileSystemFileHandle): Promise<void> {
    const db = await this.openHandleDb();
    if (!db) {
      return;
    }
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(FILE_HANDLE_STORE_NAME, 'readwrite');
        tx.objectStore(FILE_HANDLE_STORE_NAME).put(handle, FILE_HANDLE_KEY);
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => {
          db.close();
          resolve();
        };
      } catch {
        db.close();
        resolve();
      }
    });
  }

  private async loadHandleFromIndexedDb(): Promise<BrowserFileSystemFileHandle | null> {
    const db = await this.openHandleDb();
    if (!db) {
      return null;
    }
    return new Promise<BrowserFileSystemFileHandle | null>((resolve) => {
      try {
        const tx = db.transaction(FILE_HANDLE_STORE_NAME, 'readonly');
        const req = tx.objectStore(FILE_HANDLE_STORE_NAME).get(FILE_HANDLE_KEY);
        req.onsuccess = () => {
          db.close();
          resolve((req.result as BrowserFileSystemFileHandle) ?? null);
        };
        req.onerror = () => {
          db.close();
          resolve(null);
        };
      } catch {
        db.close();
        resolve(null);
      }
    });
  }

  private async clearHandleFromIndexedDb(): Promise<void> {
    const db = await this.openHandleDb();
    if (!db) {
      return;
    }
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(FILE_HANDLE_STORE_NAME, 'readwrite');
        tx.objectStore(FILE_HANDLE_STORE_NAME).delete(FILE_HANDLE_KEY);
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => {
          db.close();
          resolve();
        };
      } catch {
        db.close();
        resolve();
      }
    });
  }

  private ensureFlashcardsForPassages(passages: Passage[], existingCards: Flashcard[]): Flashcard[] {
    const validPassageIds = new Set(passages.map((p) => p.id));
    const mainCardByPassageId = new Map<string, Flashcard>();
    const repairCards: Flashcard[] = [];

    for (const c of existingCards) {
      if (!c.passageId || !validPassageIds.has(c.passageId)) {
        continue;
      }
      if (c.isRepairCard) {
        repairCards.push(c);
      } else {
        mainCardByPassageId.set(c.passageId, c);
      }
    }

    const now = new Date();
    const mainCards: Flashcard[] = [];
    for (const passage of passages) {
      const maxVerses = Math.max(1, passage.verses.length);
      const found = mainCardByPassageId.get(passage.id);
      if (found) {
        const normalizedStep = Math.max(1, Math.min(found.learningStep || 1, maxVerses));
        mainCards.push({
          ...found,
          learningStep: normalizedStep,
        });
      } else {
        mainCards.push({
          ...this.srs.createInitialFlashcard(passage.id, now),
          learningStep: 1,
        });
      }
    }

    // Keep active repair cards at the front so they surface cleanly alongside main cards
    return [...repairCards, ...mainCards];
  }

  /**
   * Explicit opt-in helper for automated tests only; never called on startup.
   */
  seedInitialDemoData(): void {
    const now = new Date();
    const isoNow = now.toISOString();
    const oneHourAgoIso = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
    const twoHoursAgoIso = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
    const oneDayAgoIso = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const threeDaysAgoIso = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString();

    const starterData: Array<{
      id: string;
      cardId: string;
      reference: string;
      verses: Verse[];
      cardOverrides?: Partial<Flashcard>;
    }> = [
      {
        id: 'psg_seed_romans_8_1_4',
        cardId: 'card_seed_romans_8_1_4',
        reference: 'Romans 8:1-4',
        verses: [
          {
            verseNumber: 1,
            text: 'There is therefore now no condemnation for those who are in Christ Jesus.',
          },
          {
            verseNumber: 2,
            text: 'For the law of the Spirit of life has set you free in Christ Jesus from the law of sin and death.',
          },
          {
            verseNumber: 3,
            text: 'For God has done what the law, weakened by the flesh, could not do. By sending his own Son in the likeness of sinful flesh and for sin, he condemned sin in the flesh,',
          },
          {
            verseNumber: 4,
            text: 'in order that the righteous requirement of the law might be fulfilled in us, who walk not according to the flesh but according to the Spirit.',
          },
        ],
      },
      {
        id: 'psg_seed_psalm_23_1_6',
        cardId: 'card_seed_psalm_23_1_6',
        reference: 'Psalm 23:1-6',
        verses: [
          {
            verseNumber: 1,
            text: 'The LORD is my shepherd; I shall not want.',
          },
          {
            verseNumber: 2,
            text: 'He makes me lie down in green pastures. He leads me beside still waters.',
          },
          {
            verseNumber: 3,
            text: 'He restores my soul. He leads me in paths of righteousness for his name’s sake.',
          },
          {
            verseNumber: 4,
            text: 'Even though I walk through the valley of the shadow of death, I will fear no evil, for you are with me; your rod and your staff, they comfort me.',
          },
          {
            verseNumber: 5,
            text: 'You prepare a table before me in the presence of my enemies; you anoint my head with oil; my cup overflows.',
          },
          {
            verseNumber: 6,
            text: 'Surely goodness and mercy shall follow me all the days of my life, and I shall dwell in the house of the LORD forever.',
          },
        ],
      },
      {
        id: 'psg_seed_philippians_4_6_7',
        cardId: 'card_seed_philippians_4_6_7',
        reference: 'Philippians 4:6-7',
        verses: [
          {
            verseNumber: 6,
            text: 'Do not be anxious about anything, but in everything by prayer and supplication with thanksgiving let your requests be made known to God.',
          },
          {
            verseNumber: 7,
            text: 'And the peace of God, which surpasses all understanding, will guard your hearts and your minds in Christ Jesus.',
          },
        ],
        cardOverrides: {
          state: CardState.CARD_STATE_LEARNING,
          intervalDays: 1,
          repetitions: 1,
          learningStep: 1,
          lastReviewedAt: oneDayAgoIso,
          dueAt: oneHourAgoIso,
        },
      },
      {
        id: 'psg_seed_john_1_1_5',
        cardId: 'card_seed_john_1_1_5',
        reference: 'John 1:1-5',
        verses: [
          {
            verseNumber: 1,
            text: 'In the beginning was the Word, and the Word was with God, and the Word was God.',
          },
          {
            verseNumber: 2,
            text: 'He was in the beginning with God.',
          },
          {
            verseNumber: 3,
            text: 'All things were made through him, and without him was not any thing made that was made.',
          },
          {
            verseNumber: 4,
            text: 'In him was life, and the life was the light of men.',
          },
          {
            verseNumber: 5,
            text: 'The light shines in the darkness, and the darkness has not overcome it.',
          },
        ],
        cardOverrides: {
          state: CardState.CARD_STATE_REVIEW,
          intervalDays: 3,
          repetitions: 2,
          learningStep: 5,
          lastReviewedAt: threeDaysAgoIso,
          dueAt: twoHoursAgoIso,
        },
      },
    ];

    const passages: Passage[] = starterData.map((s) => ({
      id: s.id,
      reference: s.reference,
      verses: s.verses,
      createdAt: isoNow,
      updatedAt: isoNow,
    }));

    const flashcards: Flashcard[] = starterData.map((s) => ({
      ...this.srs.createInitialFlashcard(s.id, now),
      id: s.cardId,
      learningStep: 1,
      ...(s.cardOverrides ?? {}),
    }));

    this.passages.set(passages);
    this.flashcards.set(flashcards);
    this.reviewLogs.set([]);
    this.persistToStorage();
  }

  private generateId(prefix: string): string {
    const rand = Math.random().toString(36).substring(2, 10);
    return `${prefix}_${Date.now().toString(36)}_${rand}`;
  }
}
