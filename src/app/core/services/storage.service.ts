import { computed, inject, Injectable, signal } from '@angular/core';
import {
  CardState,
  Flashcard,
  Passage,
  ProtoJsonCodec,
  ReviewLog,
  ReviewRating,
  UserDataBundle,
  Verse,
} from '../proto/bible_memory.pb';
import { PassageParserService } from './passage-parser.service';
import { SrsService } from './srs.service';

export const STORAGE_KEY = 'bible_memory_protojson_v1';
export const VIRTUAL_FILE_META_KEY = 'bible_memory_active_virtual_file_v1';
export const VIRTUAL_FILE_CONTENT_KEY = 'bible_memory_active_virtual_file_content_v1';
const FILE_HANDLE_DB_NAME = 'bible_memory_file_handle_db';
const FILE_HANDLE_STORE_NAME = 'handles';
const FILE_HANDLE_KEY = 'active_memory_file_handle';

export type ActiveFileStatus =
  | 'none'
  | 'connected'
  | 'saving'
  | 'saved'
  | 'needs-permission'
  | 'error';

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

  // Active Memory Data File signals
  readonly activeFileName = signal<string | null>(null);
  readonly activeFileStatus = signal<ActiveFileStatus>('none');
  readonly lastFileSavedAt = signal<string | null>(null);
  readonly fileSyncError = signal<string | null>(null);

  private fileHandle: BrowserFileSystemFileHandle | null = null;
  private isSimulatedFile = false;
  private isWritingFile = false;
  private pendingWriteRequested = false;
  private gestureListenerRegistered = false;

  readonly deckItems = computed<DeckItem[]>(() => {
    const passageList = this.passages();
    const cardList = this.flashcards();
    const passageById = new Map<string, Passage>();

    for (const passage of passageList) {
      passageById.set(passage.id, passage);
    }

    const now = new Date();
    const items: DeckItem[] = [];

    // Include all flashcards (both main passage flashcards and any active temporary repair flashcards)
    for (const card of cardList) {
      const passage = passageById.get(card.passageId);
      if (passage) {
        const isActive = card.state !== CardState.CARD_STATE_NEW || Boolean(card.isRepairCard);
        items.push({
          passage,
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
   * Opens a file picker to select an existing `.proto.json` / `.json` data file,
   * loads its contents into the app, and sets it as the Active Memory Data File for background auto-saving.
   */
  async selectExistingDataFile(): Promise<boolean> {
    this.fileSyncError.set(null);

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
              description: 'Bible Memory ProtoJSON File',
              accept: {
                'application/json': ['.json', '.proto.json'],
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
        } else {
          await this.writeToActiveFileHandle();
        }

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
        this.fileSyncError.set(
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
   * immediately writes the current ProtoJSON bundle to it, and auto-saves on every change thereafter.
   */
  async createNewDataFile(suggestedName = 'bible-memory.proto.json'): Promise<boolean> {
    this.fileSyncError.set(null);

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
              description: 'Bible Memory ProtoJSON File',
              accept: {
                'application/json': ['.json', '.proto.json'],
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
        this.fileSyncError.set(
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
  async connectSimulatedDataFile(fileName = 'bible-memory.proto.json'): Promise<void> {
    const cleanName = fileName.trim() || 'bible-memory.proto.json';
    this.fileHandle = null;
    this.isSimulatedFile = true;
    await this.clearHandleFromIndexedDb();

    const nowIso = new Date().toISOString();
    this.activeFileName.set(cleanName);
    this.activeFileStatus.set('saved');
    this.lastFileSavedAt.set(nowIso);
    this.fileSyncError.set(null);

    this.saveSimulatedFileMeta(cleanName, nowIso);
    await this.writeToActiveFileHandle();
  }

  /**
   * Re-requests read/write permission for a previously saved FileSystemFileHandle restored from IndexedDB,
   * and immediately flushes the current state to the file.
   */
  async reconnectSavedFileHandle(): Promise<boolean> {
    if (!this.fileHandle) {
      return false;
    }

    try {
      this.fileSyncError.set(null);
      let perm: PermissionState = 'granted';
      if (typeof this.fileHandle.queryPermission === 'function') {
        perm = await this.fileHandle.queryPermission({ mode: 'readwrite' });
      }
      if (perm !== 'granted' && typeof this.fileHandle.requestPermission === 'function') {
        perm = await this.fileHandle.requestPermission({ mode: 'readwrite' });
      }
      if (perm !== 'granted') {
        this.activeFileStatus.set(perm === 'denied' ? 'needs-permission' : 'connected');
        if (perm === 'prompt') {
          this.registerFirstGesturePermissionListener();
        }
        return false;
      }

      await this.writeToActiveFileHandle();
      return this.activeFileStatus() === 'saved';
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'SecurityError') {
        // No user gesture active yet; wait for first click/keydown
        this.activeFileStatus.set('connected');
        this.registerFirstGesturePermissionListener();
        return false;
      }
      this.fileSyncError.set(
        err instanceof Error ? err.message : 'Failed to reconnect to active data file.'
      );
      this.activeFileStatus.set('error');
      return false;
    }
  }

  /**
   * Disconnects the active memory data file (stops background file auto-saving, while keeping local state).
   */
  disconnectDataFile(): void {
    this.fileHandle = null;
    this.isSimulatedFile = false;
    this.activeFileName.set(null);
    this.activeFileStatus.set('none');
    this.lastFileSavedAt.set(null);
    this.fileSyncError.set(null);
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
    await this.writeToActiveFileHandle();
    return this.activeFileStatus() === 'saved';
  }

  /**
   * Creates (or surfaces) a temporary single-verse Repair Flashcard for a passage.
   * Once the user grades Good/Easy `targetStreak` consecutive times (default 3),
   * the repair card is considered healed and automatically retires from the deck.
   */
  createRepairCard(passageId: string, verseNumber: number, targetStreak = 3): DeckItem | undefined {
    const passage = this.passages().find((p) => p.id === passageId);
    if (!passage) {
      return undefined;
    }

    const now = new Date();
    const isoNow = now.toISOString();
    const cards = this.flashcards();

    // Check if an active repair card for (passageId, verseNumber) already exists
    const existingRepair = cards.find(
      (c) =>
        Boolean(c.isRepairCard) &&
        c.passageId === passageId &&
        c.repairVerseNumber === verseNumber
    );

    if (existingRepair) {
      const refreshed: Flashcard = {
        ...existingRepair,
        state: CardState.CARD_STATE_LEARNING,
        dueAt: isoNow,
        updatedAt: isoNow,
      };
      this.flashcards.update((prev) =>
        prev.map((c) => (c.id === existingRepair.id ? refreshed : c))
      );
      this.persistToStorage();
      return {
        passage,
        card: refreshed,
        isDue: true,
      };
    }

    const parentCard = cards.find((c) => c.passageId === passageId && !c.isRepairCard);
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
    };

    this.flashcards.update((prev) => [repairCard, ...prev]);
    this.persistToStorage();

    return {
      passage,
      card: repairCard,
      isDue: true,
    };
  }

  /**
   * Transitions a queued passage (CARD_STATE_NEW) into active memorization (CARD_STATE_LEARNING).
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

    let updatedCard = targetCard;
    if (targetCard.state === CardState.CARD_STATE_NEW) {
      updatedCard = {
        ...targetCard,
        state: CardState.CARD_STATE_LEARNING,
        dueAt: isoNow,
        updatedAt: isoNow,
      };
      this.flashcards.update((prev) =>
        prev.map((c) => (c.id === targetCard.id ? updatedCard : c))
      );
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
   * Adds a structured multi-verse passage to the Memorization Queue (CARD_STATE_NEW).
   */
  addPassage(reference: string, verses: Verse[]): DeckItem {
    const now = new Date();
    const isoNow = now.toISOString();
    const cleanRef = reference.trim() || 'Untitled Passage';
    const cleanVerses: Verse[] = verses
      .map((v, idx) => ({
        verseNumber: v.verseNumber > 0 ? v.verseNumber : idx + 1,
        text: v.text.trim(),
      }))
      .filter((v) => v.text.length > 0);

    const passage: Passage = {
      id: this.generateId('psg'),
      reference: cleanRef,
      verses: cleanVerses,
      createdAt: isoNow,
      updatedAt: isoNow,
    };

    const card = this.srs.createInitialFlashcard(passage.id, now);

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
   * Parses raw pasted text (and optional explicit reference) and adds it to the Memorization Queue.
   */
  addFromRawText(rawText: string, explicitReference?: string): DeckItem {
    const parsed = this.parser.parseRawInput(rawText, explicitReference);
    return this.addPassage(parsed.reference, parsed.verses);
  }

  /**
   * Deletes a passage along with its flashcards and review logs.
   */
  deletePassage(passageId: string): void {
    this.passages.update((prev) => prev.filter((p) => p.id !== passageId));
    this.flashcards.update((prev) => prev.filter((c) => c.passageId !== passageId));
    this.reviewLogs.update((prev) => prev.filter((r) => r.passageId !== passageId));
    this.persistToStorage();
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

    this.flashcards.update((prev) => prev.map((c) => (c.id === targetCard.id ? updatedCard : c)));
    this.reviewLogs.update((prev) => [reviewLog, ...prev]);
    this.persistToStorage();

    if (!passage) {
      return undefined;
    }

    return {
      passage,
      card: updatedCard,
      isDue: updatedCard.state !== CardState.CARD_STATE_NEW && this.srs.isDue(updatedCard, now),
    };
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

    this.passages.set(mergedPassages);
    this.flashcards.set(mergedCards);
    this.reviewLogs.set(Array.from(logMap.values()));
    this.persistToStorage();
  }

  /**
   * Resets the deck back to the 4 default starter passages.
   */
  resetToDefaults(): void {
    this.seedDefaults();
  }

  private loadFromStorage(): void {
    if (typeof localStorage === 'undefined') {
      this.seedDefaults();
      return;
    }

    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        this.seedDefaults();
        return;
      }

      const bundle = ProtoJsonCodec.deserializeBundle(raw);
      if (!bundle.passages || bundle.passages.length === 0) {
        this.seedDefaults();
        return;
      }

      const flashcards = this.ensureFlashcardsForPassages(bundle.passages, bundle.flashcards);

      // Migrate untouched v1 seed state where all 4 starter cards were NEW and no reviews existed yet
      const isUntouchedLegacySeed =
        (bundle.reviewLogs?.length ?? 0) === 0 &&
        flashcards.length === 4 &&
        flashcards.every(
          (c) => c.id.startsWith('card_seed_') && c.state === CardState.CARD_STATE_NEW
        );

      if (isUntouchedLegacySeed) {
        this.seedDefaults();
        return;
      }

      this.passages.set(bundle.passages);
      this.flashcards.set(flashcards);
      this.reviewLogs.set(bundle.reviewLogs ?? []);
    } catch {
      this.seedDefaults();
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

    // Automatically trigger background write to Active Memory Data File if connected
    if (this.fileHandle || this.isSimulatedFile) {
      void this.writeToActiveFileHandle();
    }
  }

  private async writeToActiveFileHandle(): Promise<void> {
    if (!this.fileHandle && !this.isSimulatedFile) {
      return;
    }

    if (this.isWritingFile) {
      this.pendingWriteRequested = true;
      return;
    }

    this.isWritingFile = true;
    this.fileSyncError.set(null);
    this.activeFileStatus.set('saving');

    try {
      do {
        this.pendingWriteRequested = false;
        const prettyPayload = this.exportProtoJson(true);

        if (this.isSimulatedFile) {
          const nowIso = new Date().toISOString();
          const currentName = this.activeFileName() ?? 'bible-memory.proto.json';
          this.saveSimulatedFileMeta(currentName, nowIso, prettyPayload);
          this.lastFileSavedAt.set(nowIso);
          this.activeFileStatus.set('saved');
        } else if (this.fileHandle) {
          if (typeof this.fileHandle.queryPermission === 'function') {
            let perm = await this.fileHandle.queryPermission({ mode: 'readwrite' });
            if (perm !== 'granted' && typeof this.fileHandle.requestPermission === 'function') {
              try {
                // Attempt to request permission right inside the current user gesture (e.g. grading a card, adding a passage)
                perm = await this.fileHandle.requestPermission({ mode: 'readwrite' });
              } catch {
                // No active user gesture yet; stay in 'connected' and wait for first click/keydown
                this.activeFileStatus.set('connected');
                this.registerFirstGesturePermissionListener();
                return;
              }
            }
            if (perm !== 'granted') {
              this.activeFileStatus.set(perm === 'denied' ? 'needs-permission' : 'connected');
              if (perm === 'prompt') {
                this.registerFirstGesturePermissionListener();
              }
              return;
            }
          }

          const writable = await this.fileHandle.createWritable();
          await writable.write(prettyPayload);
          await writable.close();

          const nowIso = new Date().toISOString();
          this.lastFileSavedAt.set(nowIso);
          this.activeFileStatus.set('saved');
        }
      } while (this.pendingWriteRequested);
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'SecurityError') {
        this.activeFileStatus.set('connected');
        this.registerFirstGesturePermissionListener();
        return;
      }
      this.fileSyncError.set(
        err instanceof Error ? err.message : 'Auto-save to active file failed.'
      );
      this.activeFileStatus.set('error');
    } finally {
      this.isWritingFile = false;
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
          await this.writeToActiveFileHandle();
        } else if (perm === 'prompt') {
          // Show as connected and seamlessly request write permission on the user's very first interaction
          this.activeFileStatus.set('connected');
          this.registerFirstGesturePermissionListener();
        } else {
          this.activeFileStatus.set('needs-permission');
        }
      } else {
        this.activeFileStatus.set('saved');
      }
    } catch {
      this.activeFileStatus.set('connected');
      this.registerFirstGesturePermissionListener();
    }
  }

  private registerFirstGesturePermissionListener(): void {
    if (this.gestureListenerRegistered || typeof window === 'undefined') {
      return;
    }
    this.gestureListenerRegistered = true;

    const onFirstGesture = () => {
      window.removeEventListener('pointerdown', onFirstGesture, true);
      window.removeEventListener('keydown', onFirstGesture, true);
      this.gestureListenerRegistered = false;
      void this.ensurePermissionOnFirstGesture();
    };

    window.addEventListener('pointerdown', onFirstGesture, { capture: true, passive: true });
    window.addEventListener('keydown', onFirstGesture, { capture: true, passive: true });
  }

  private async ensurePermissionOnFirstGesture(): Promise<void> {
    if (!this.fileHandle) {
      return;
    }
    try {
      if (typeof this.fileHandle.queryPermission === 'function') {
        let perm = await this.fileHandle.queryPermission({ mode: 'readwrite' });
        if (perm !== 'granted' && typeof this.fileHandle.requestPermission === 'function') {
          perm = await this.fileHandle.requestPermission({ mode: 'readwrite' });
        }
        if (perm === 'granted') {
          await this.writeToActiveFileHandle();
        } else if (perm === 'denied') {
          this.activeFileStatus.set('needs-permission');
        }
      } else {
        await this.writeToActiveFileHandle();
      }
    } catch {
      // Keep status as connected so next user action can retry
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
      input.accept = '.json,.proto.json,application/json';
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
          this.fileSyncError.set(
            err instanceof Error ? err.message : 'Invalid ProtoJSON file selected.'
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
      const found = mainCardByPassageId.get(passage.id);
      if (found) {
        mainCards.push(found);
      } else {
        mainCards.push(this.srs.createInitialFlashcard(passage.id, now));
      }
    }

    // Keep active repair cards at the front so they surface cleanly alongside main cards
    return [...repairCards, ...mainCards];
  }

  private seedDefaults(): void {
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
          learningStep: 2,
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
