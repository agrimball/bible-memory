import {
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  ViewChild,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import * as PbModule from '../../core/proto/bible_memory.pb';
import {
  CardState,
  Flashcard,
  Passage,
  ReviewRating,
  Verse,
  formatVerseBadge,
  formatVerseRange,
  isMultiChapterPassage,
} from '../../core/proto/bible_memory.pb';
import { DeckItem, StorageService } from '../../core/services/storage.service';
import { SrsService } from '../../core/services/srs.service';
import { VoiceRecorderService } from '../../core/services/voice-recorder.service';

export type StitchPracticePhase = 'new-verse-only' | 'stitch-block' | 'full-passage';

export interface VerseIndexRange {
  startIdx: number;
  endIdx: number;
}

@Component({
  selector: 'app-study-card',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './study-card.component.html',
  styleUrl: './study-card.component.css',
})
export class StudyCardComponent implements OnChanges, OnDestroy {
  readonly storageService = inject(StorageService);
  readonly srsService = inject(SrsService);
  readonly voiceService = inject(VoiceRecorderService);

  @ViewChild('backScrollContainer') backScrollRef?: ElementRef<HTMLElement>;

  @Input() item: DeckItem | null = null;
  @Input() queuePosition = 1;
  @Input() queueTotal = 1;
  @Input() stitchedVerseCount = 0;

  @Output() rated = new EventEmitter<{ cardId: string; rating: ReviewRating }>();
  @Output() skipCard = new EventEmitter<void>();
  @Output() editPassage = new EventEmitter<void>();
  @Output() backToDeck = new EventEmitter<void>();
  @Output() openStudyPage = new EventEmitter<DeckItem>();
  @Output() openRepairCard = new EventEmitter<DeckItem>();
  @Output() stitchedVerseCountChange = new EventEmitter<number>();

  readonly isFlipped = signal<boolean>(false);
  readonly showHint = signal<boolean>(false);
  readonly localTargetVerseCount = signal<number>(1);
  readonly stitchPhase = signal<StitchPracticePhase>('new-verse-only');
  readonly stitchToastMessage = signal<string | null>(null);
  readonly repairSpawnedMessage = signal<string | null>(null);
  readonly spawnedRepairItem = signal<DeckItem | null>(null);

  /** Start-to-End Repair Range Highlighting & Resume Recitation state */
  readonly draftRepairRange = signal<VerseIndexRange | null>(null);
  readonly queuedRepairs = signal<VerseIndexRange[]>([]);
  readonly resumeFromVerseIndex = signal<number | null>(null);

  /** Saved scroll position of the Back card container across flips */
  private savedBackScrollTop = 0;

  readonly CardState = CardState;
  readonly ReviewRating = ReviewRating;

  private readonly currentItemSignal = signal<DeckItem | null>(null);

  readonly isMultiChapter = computed<boolean>(() => {
    const verses = this.currentItemSignal()?.passage.verses ?? [];
    return isMultiChapterPassage(verses);
  });

  readonly passageTitleWithLabel = computed<string>(() => {
    const p = this.currentItemSignal()?.passage as (Passage & { label?: string }) | undefined;
    if (!p) {
      return '';
    }
    const cleanLabel = p.label?.trim();
    return cleanLabel ? `${p.reference} (${cleanLabel})` : p.reference;
  });

  readonly recitationTime = computed<{ seconds: number; label: string }>(() => {
    const verses = this.activeVerses();
    const pbHelper = (
      PbModule as unknown as {
        estimateRecitationTime?: (v: Verse[]) => { seconds: number; label: string };
      }
    ).estimateRecitationTime;
    if (typeof pbHelper === 'function') {
      return pbHelper(verses);
    }
    const wordCount = verses.reduce(
      (sum, v) => sum + (v.text.trim() ? v.text.trim().split(/\s+/).length : 0),
      0
    );
    const seconds = Math.max(5, Math.round((wordCount / 130) * 60));
    const label =
      seconds < 60
        ? `~${Math.max(5, Math.round(seconds / 5) * 5)}s`
        : `~${(seconds / 60).toFixed(1).replace(/\.0$/, '')} min`;
    return { seconds, label };
  });

  readonly canSkipLongCard = computed<boolean>(() => {
    const card = this.currentItemSignal()?.card as
      | (Flashcard & { isStitchedPassageCard?: boolean })
      | undefined;
    if (!card) {
      return false;
    }
    return (
      Boolean(card.isStitchedPassageCard) ||
      this.activeVerses().length > 6 ||
      this.recitationTime().seconds >= 45
    );
  });

  readonly isRepairCard = computed<boolean>(() => {
    return Boolean(this.currentItemSignal()?.card.isRepairCard);
  });

  readonly repairTargetVerses = computed<Verse[]>(() => {
    const current = this.currentItemSignal();
    if (!current || !current.card.isRepairCard) {
      return [];
    }
    const verses = current.passage.verses;
    if (verses.length === 0) {
      return [];
    }

    const startNum = current.card.repairVerseNumber;
    const startChap = current.card.repairChapterNumber;
    let startIdx = verses.findIndex(
      (v) =>
        v.verseNumber === startNum &&
        (!startChap || !v.chapterNumber || v.chapterNumber === startChap)
    );
    if (startIdx < 0) {
      startIdx = verses.findIndex((v) => v.verseNumber === startNum);
    }
    if (startIdx < 0) {
      startIdx = 0;
    }

    const endNum = current.card.repairEndVerseNumber ?? startNum;
    const endChap = current.card.repairEndChapterNumber ?? startChap;
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

    return verses.slice(startIdx, endIdx + 1);
  });

  readonly repairTargetVerse = computed<Verse | null>(() => {
    const targets = this.repairTargetVerses();
    return targets[0] ?? null;
  });

  readonly repairPrecedingVerse = computed<Verse | null>(() => {
    const current = this.currentItemSignal();
    if (!current || !current.card.isRepairCard) {
      return null;
    }
    const targetNum = current.card.repairVerseNumber;
    const targetChap = current.card.repairChapterNumber;
    let idx = current.passage.verses.findIndex(
      (v) =>
        v.verseNumber === targetNum &&
        (!targetChap || !v.chapterNumber || v.chapterNumber === targetChap)
    );
    if (idx < 0) {
      idx = current.passage.verses.findIndex((v) => v.verseNumber === targetNum);
    }
    if (idx > 0) {
      return current.passage.verses[idx - 1];
    }
    return null;
  });

  readonly repairTargetLabel = computed<string>(() => {
    const targets = this.repairTargetVerses();
    if (targets.length > 1) {
      return formatVerseRange(targets[0], targets[targets.length - 1], this.isMultiChapter());
    }
    if (targets.length === 1) {
      return this.getVerseBadge(targets[0]);
    }
    const card = this.currentItemSignal()?.card;
    if (this.isMultiChapter() && card?.repairChapterNumber && card?.repairVerseNumber) {
      return `${card.repairChapterNumber}:${card.repairVerseNumber}`;
    }
    return `v. ${card?.repairVerseNumber ?? 1}`;
  });

  readonly repairTargetVerboseLabel = computed<string>(() => {
    const targets = this.repairTargetVerses();
    if (targets.length > 1) {
      const first = targets[0];
      const last = targets[targets.length - 1];
      if (this.isMultiChapter()) {
        return formatVerseRange(first, last, true);
      }
      return `Verses ${first.verseNumber}–${last.verseNumber}`;
    }
    if (targets.length === 1) {
      return this.getVerseVerboseLabel(targets[0]);
    }
    const card = this.currentItemSignal()?.card;
    if (this.isMultiChapter() && card?.repairChapterNumber && card?.repairVerseNumber) {
      return `${card.repairChapterNumber}:${card.repairVerseNumber}`;
    }
    return `Verse ${card?.repairVerseNumber ?? 1}`;
  });

  readonly repairHealDots = computed<boolean[]>(() => {
    const current = this.currentItemSignal();
    const streak = current?.card.repairStreak ?? 0;
    const target = current?.card.repairTargetStreak ?? 3;
    return Array.from({ length: target }, (_, i) => i < streak);
  });

  readonly totalVerses = computed<number>(() => {
    return this.currentItemSignal()?.passage.verses.length ?? 0;
  });

  readonly firstVerseNumber = computed<number>(() => {
    return this.currentItemSignal()?.passage.verses[0]?.verseNumber ?? 1;
  });

  readonly activeStitchedCount = computed<number>(() => {
    const total = this.totalVerses();
    if (total === 0) {
      return 0;
    }
    if (this.stitchPhase() === 'full-passage') {
      return total;
    }
    const local = this.localTargetVerseCount();
    if (local >= 1 && local <= total) {
      return local;
    }
    return 1;
  });

  readonly activeVerses = computed<Verse[]>(() => {
    return this.currentItemSignal()?.passage.verses ?? [];
  });

  /**
   * The single "New Verse for the Day" (the last verse in the current target block).
   */
  readonly currentNewVerse = computed<Verse | null>(() => {
    const current = this.currentItemSignal();
    if (!current || current.passage.verses.length === 0) {
      return null;
    }
    const targetIdx = Math.max(
      0,
      Math.min(this.activeStitchedCount() - 1, current.passage.verses.length - 1)
    );
    return current.passage.verses[targetIdx] ?? null;
  });

  readonly targetVerseLabel = computed<string>(() => {
    const curr = this.currentNewVerse();
    if (!curr) {
      return 'v. 1';
    }
    return formatVerseBadge(curr, this.isMultiChapter());
  });

  readonly targetVerseVerboseLabel = computed<string>(() => {
    const curr = this.currentNewVerse();
    if (!curr) {
      return 'Verse 1';
    }
    return this.getVerseVerboseLabel(curr);
  });

  readonly stitchedVerseRangeLabel = computed<string>(() => {
    const verses = this.currentItemSignal()?.passage.verses ?? [];
    if (verses.length === 0) {
      return 'v. 1';
    }
    const first = verses[0];
    const curr = this.currentNewVerse() ?? first;
    return formatVerseRange(first, curr, this.isMultiChapter());
  });

  readonly stitchedVerseRangeVerboseLabel = computed<string>(() => {
    const verses = this.currentItemSignal()?.passage.verses ?? [];
    if (verses.length === 0) {
      return 'Verse 1';
    }
    const first = verses[0];
    const curr = this.currentNewVerse() ?? first;
    if (this.isMultiChapter()) {
      return formatVerseRange(first, curr, true);
    }
    if (this.activeStitchedCount() <= 1 || first.verseNumber === curr.verseNumber) {
      return `Verse ${first.verseNumber}`;
    }
    return `Verses ${first.verseNumber}–${curr.verseNumber}`;
  });

  /**
   * Compact scope badge shown in the 52px top bar (e.g. `v. 1–3 of 7` or `v. 4 (New)`).
   */
  readonly topbarScopeLabel = computed<string>(() => {
    if (this.isRepairCard()) {
      return `🔧 ${this.repairTargetLabel()}`;
    }
    const total = this.totalVerses();
    if (total <= 1) {
      return '';
    }
    if (this.stitchPhase() === 'new-verse-only') {
      return `${this.targetVerseLabel()} (${this.activeStitchedCount()}/${total})`;
    }
    if (this.stitchPhase() === 'stitch-block') {
      return `${this.stitchedVerseRangeLabel()} of ${total}v`;
    }
    return `${total}v`;
  });

  /**
   * Next verse label for the `+1v` expand button in the topbar.
   */
  readonly nextExpandVerseLabel = computed<string>(() => {
    const verses = this.activeVerses();
    const nextIdx = this.activeStitchedCount();
    if (nextIdx >= 0 && nextIdx < verses.length) {
      return this.getVerseBadge(verses[nextIdx]);
    }
    return '+1v';
  });

  /**
   * Returns a preceding lead-in verse ONLY when recitation starts after the 1st verse:
   * - When resuming mid-passage (`resumeFromVerseIndex() > 0`)
   * - When practicing a repair card (`isRepairCard()`)
   * - When in Step 1 (`new-verse-only`) for verse 2+ (`activeStitchedCount() > 1`)
   * Returns `null` in `All` mode or `Stitch Block` mode (which both start at the 1st verse).
   */
  readonly leadInContextVerse = computed<Verse | null>(() => {
    const verses = this.activeVerses();
    if (verses.length === 0) {
      return null;
    }
    const resumeIdx = this.resumeFromVerseIndex();
    if (resumeIdx !== null && resumeIdx > 0) {
      return verses[resumeIdx - 1] ?? null;
    }
    if (this.isRepairCard()) {
      return this.repairPrecedingVerse();
    }
    if (this.stitchPhase() === 'new-verse-only' && this.activeStitchedCount() > 1) {
      return verses[this.activeStitchedCount() - 2] ?? null;
    }
    return null;
  });

  readonly previousContextVerse = this.leadInContextVerse;

  /**
   * Resume Recitation Computed Helpers (when `resumeFromVerseIndex() !== null`)
   */
  readonly resumeTargetVerse = computed<Verse | null>(() => {
    const idx = this.resumeFromVerseIndex();
    const verses = this.activeVerses();
    if (idx === null || idx < 0 || idx >= verses.length) {
      return null;
    }
    return verses[idx] ?? null;
  });

  readonly resumeLeadInVerse = computed<Verse | null>(() => {
    const idx = this.resumeFromVerseIndex();
    const verses = this.activeVerses();
    if (idx === null || idx <= 0 || idx > verses.length) {
      return null;
    }
    return verses[idx - 1] ?? null;
  });

  readonly resumeLeadInSnippet = computed<string>(() => {
    const prev = this.resumeLeadInVerse();
    if (!prev) {
      return '';
    }
    const words = prev.text.trim().split(/\s+/);
    if (words.length <= 7) {
      return prev.text.trim();
    }
    return '…' + words.slice(-7).join(' ');
  });

  /**
   * Draft & Queued Repair Range Helpers
   */
  readonly draftRangeLabel = computed<string>(() => {
    const draft = this.draftRepairRange();
    if (!draft) {
      return '';
    }
    return this.formatIndexRange(draft);
  });

  readonly draftStartVerseLabel = computed<string>(() => {
    const draft = this.draftRepairRange();
    const verses = this.activeVerses();
    if (!draft || !verses[draft.startIdx]) {
      return '';
    }
    return this.getVerseBadge(verses[draft.startIdx]);
  });

  readonly hasMoreVersesAfterDraft = computed<boolean>(() => {
    const draft = this.draftRepairRange();
    const verses = this.activeVerses();
    if (!draft || verses.length === 0) {
      return false;
    }
    const maxLimit = Math.min(verses.length - 1, Math.max(0, this.activeStitchedCount() - 1));
    return draft.endIdx < Math.max(maxLimit, verses.length - 1);
  });

  readonly nextVerseAfterDraftLabel = computed<string>(() => {
    const draft = this.draftRepairRange();
    const verses = this.activeVerses();
    if (!draft) {
      return '';
    }
    const nextVerse = verses[draft.endIdx + 1];
    return nextVerse ? this.getVerseBadge(nextVerse) : '';
  });

  readonly allPendingRepairRanges = computed<VerseIndexRange[]>(() => {
    const list = [...this.queuedRepairs()];
    const draft = this.draftRepairRange();
    if (draft) {
      list.push(draft);
    }
    return list;
  });

  readonly pendingRepairsSummary = computed<string>(() => {
    const ranges = this.allPendingRepairRanges();
    if (ranges.length === 0) {
      return '';
    }
    return ranges.map((r) => this.formatIndexRange(r)).join(', ');
  });

  readonly intervalPreviews = computed<Record<ReviewRating, string>>(() => {
    const current = this.currentItemSignal();
    if (!current) {
      return {
        [ReviewRating.REVIEW_RATING_UNSPECIFIED]: '',
        [ReviewRating.REVIEW_RATING_AGAIN]: '<10m',
        [ReviewRating.REVIEW_RATING_HARD]: '1d',
        [ReviewRating.REVIEW_RATING_GOOD]: '1d',
        [ReviewRating.REVIEW_RATING_EASY]: '4d',
      };
    }
    return this.srsService.getIntervalPreviews(current.card);
  });

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['item']) {
      const prevCardId = changes['item'].previousValue?.card?.id;
      const nextCardId = this.item?.card?.id;
      this.currentItemSignal.set(this.item);
      if (prevCardId !== nextCardId) {
        this.initializeForCurrentCard();
      }
    }
    if (changes['stitchedVerseCount'] && this.stitchedVerseCount > 0) {
      this.localTargetVerseCount.set(this.stitchedVerseCount);
    }
  }

  ngOnDestroy(): void {
    this.voiceService.resetForNewCard();
  }

  private initializeForCurrentCard(): void {
    this.isFlipped.set(false);
    this.showHint.set(false);
    this.stitchToastMessage.set(null);
    this.repairSpawnedMessage.set(null);
    this.spawnedRepairItem.set(null);
    this.draftRepairRange.set(null);
    this.queuedRepairs.set([]);
    this.resumeFromVerseIndex.set(null);
    this.savedBackScrollTop = 0;
    this.resetBackScrollTop();
    this.voiceService.resetForNewCard();

    const total = this.item?.passage.verses.length ?? 0;
    if (total <= 1 || this.item?.card.isRepairCard) {
      this.localTargetVerseCount.set(Math.max(1, total));
      this.stitchPhase.set('full-passage');
      return;
    }

    if (this.item?.card.state === CardState.CARD_STATE_REVIEW) {
      this.stitchPhase.set('full-passage');
      this.localTargetVerseCount.set(total);
      return;
    }

    const savedStep = this.item?.card.learningStep;
    const initialCount =
      this.stitchedVerseCount >= 1 && this.stitchedVerseCount <= total
        ? this.stitchedVerseCount
        : savedStep && savedStep >= 1
          ? Math.min(savedStep, total)
          : 1;
    this.localTargetVerseCount.set(initialCount);
    if (initialCount >= total) {
      this.stitchPhase.set('full-passage');
    } else {
      this.stitchPhase.set('new-verse-only');
    }
  }

  onBackScroll(event: Event): void {
    const el = event.target as HTMLElement | null;
    if (el && this.isFlipped()) {
      this.savedBackScrollTop = el.scrollTop;
    }
  }

  private restoreBackScrollTop(): void {
    const targetTop = this.savedBackScrollTop;
    const el = this.backScrollRef?.nativeElement;
    if (el) {
      el.scrollTop = targetTop;
    }
    if (typeof requestAnimationFrame !== 'undefined') {
      requestAnimationFrame(() => {
        if (this.backScrollRef?.nativeElement) {
          this.backScrollRef.nativeElement.scrollTop = targetTop;
        }
      });
    }
  }

  private resetBackScrollTop(): void {
    const el = this.backScrollRef?.nativeElement;
    if (el) {
      el.scrollTop = 0;
    }
  }

  toggleHint(event?: Event): void {
    event?.stopPropagation();
    this.showHint.update((v) => !v);
  }

  getVerseBadge(verse: Verse | null | undefined): string {
    if (!verse) {
      return '';
    }
    return formatVerseBadge(verse, this.isMultiChapter());
  }

  getVerseInlineNumber(verse: Verse | null | undefined): string {
    if (!verse) {
      return '';
    }
    if (this.isMultiChapter() && verse.chapterNumber && verse.chapterNumber > 0) {
      return `${verse.chapterNumber}:${verse.verseNumber}`;
    }
    return `${verse.verseNumber}`;
  }

  getVerseVerboseLabel(verse: Verse | null | undefined): string {
    if (!verse) {
      return '';
    }
    if (this.isMultiChapter() && verse.chapterNumber && verse.chapterNumber > 0) {
      return `${verse.chapterNumber}:${verse.verseNumber}`;
    }
    return `Verse ${verse.verseNumber}`;
  }

  getVerseBracketLabel(verse: Verse | null | undefined): string {
    if (!verse) {
      return '';
    }
    if (this.isMultiChapter() && verse.chapterNumber && verse.chapterNumber > 0) {
      return `[${verse.chapterNumber}:${verse.verseNumber}]`;
    }
    return `[${verse.verseNumber}]`;
  }

  isTargetNewVerse(verse: Verse): boolean {
    const curr = this.currentNewVerse();
    if (!curr) {
      return false;
    }
    return (
      curr.verseNumber === verse.verseNumber &&
      (curr.chapterNumber ?? 0) === (verse.chapterNumber ?? 0)
    );
  }

  formatIndexRange(range: VerseIndexRange): string {
    const verses = this.activeVerses();
    const startV = verses[range.startIdx];
    const endV = verses[range.endIdx];
    if (!startV || !endV) {
      return '';
    }
    return formatVerseRange(startV, endV, this.isMultiChapter());
  }

  isVerseInDraftRepair(idx: number): boolean {
    const draft = this.draftRepairRange();
    if (!draft) {
      return false;
    }
    return idx >= draft.startIdx && idx <= draft.endIdx;
  }

  isVerseInQueuedRepair(idx: number): boolean {
    return this.queuedRepairs().some((r) => idx >= r.startIdx && idx <= r.endIdx);
  }

  /**
   * Tap a verse on the Back of the card to start/extend/cancel a repair highlight range:
   * - Tapping inside the current draft range cancels it.
   * - Tapping inside a queued repair range removes that queued range.
   * - Tapping an unhighlighted verse when no draft is active starts `[idx..idx]`.
   * - Tapping another verse while a draft `[s..e]` is active extends it to `[min(s,idx)..max(e,idx)]`.
   */
  onVerseTap(idx: number, event?: Event): void {
    event?.stopPropagation();
    if (!this.item || this.isRepairCard() || this.totalVerses() <= 1) {
      return;
    }

    const currentDraft = this.draftRepairRange();
    if (currentDraft && idx >= currentDraft.startIdx && idx <= currentDraft.endIdx) {
      this.draftRepairRange.set(null);
      this.repairSpawnedMessage.set(null);
      return;
    }

    const existingQueuedIdx = this.queuedRepairs().findIndex(
      (r) => idx >= r.startIdx && idx <= r.endIdx
    );
    if (existingQueuedIdx >= 0) {
      this.queuedRepairs.update((list) => list.filter((_, i) => i !== existingQueuedIdx));
      return;
    }

    if (!currentDraft) {
      this.draftRepairRange.set({ startIdx: idx, endIdx: idx });
    } else {
      this.draftRepairRange.set({
        startIdx: Math.min(currentDraft.startIdx, idx),
        endIdx: Math.max(currentDraft.endIdx, idx),
      });
    }
  }

  cancelDraftRepair(event?: Event): void {
    event?.stopPropagation();
    this.draftRepairRange.set(null);
  }

  /**
   * Queues the currently highlighted `[startIdx..endIdx]` repair range:
   * - If there are more verses after `endIdx`, sets `resumeFromVerseIndex` to `endIdx + 1`
   *   and flips back to the Front (keeping Back scroll position!) so the user can continue reciting.
   * - If `endIdx` is already at the end of the passage, moves `draftRepairRange` into `queuedRepairs`
   *   on the Back so the user can immediately grade with the 4 Anki buttons below (or click Practice Now).
   */
  queueRepairAndResume(event?: Event): void {
    event?.stopPropagation();
    const draft = this.draftRepairRange();
    if (!draft) {
      return;
    }
    this.queuedRepairs.update((prev) => [...prev, draft]);
    const verses = this.activeVerses();
    const nextIdx = draft.endIdx + 1;
    this.draftRepairRange.set(null);
    if (nextIdx < verses.length) {
      this.resumeFromVerseIndex.set(nextIdx);
      this.flipToFront();
    }
  }

  /**
   * Truncates passage progress (`learningStep`) back to the verses before `draft.startIdx`
   * ("Forgot From v. X Onward") and finishes/grades the card.
   */
  forgotFromHereOnward(event?: Event): void {
    event?.stopPropagation();
    if (!this.item) {
      return;
    }
    const draft = this.draftRepairRange();
    const startIdx = draft ? draft.startIdx : 0;
    const newStep = Math.max(1, startIdx);

    const svc = this.storageService as StorageService & {
      truncatePassageProgress?: (passageId: string, step: number) => void;
    };
    if (typeof svc.truncatePassageProgress === 'function') {
      svc.truncatePassageProgress(this.item.passage.id, newStep);
    }
    this.setTargetVerseCount(newStep);
    this.draftRepairRange.set(null);
    this.queuedRepairs.set([]);

    this.rated.emit({
      cardId: this.item.card.id,
      rating: ReviewRating.REVIEW_RATING_HARD,
    });
  }

  /**
   * Backwards-compatible method to spawn a repair card for a specific verse directly.
   */
  spawnRepairCardForVerse(verseOrNumber: Verse | number, chapterNumber?: number): void {
    if (!this.item) {
      return;
    }
    const verseNumber =
      typeof verseOrNumber === 'number' ? verseOrNumber : verseOrNumber.verseNumber;
    const resolvedChapter =
      typeof verseOrNumber === 'number' ? chapterNumber : verseOrNumber.chapterNumber;
    const repairItem = this.storageService.createRepairCard(
      this.item.passage.id,
      verseNumber,
      3,
      resolvedChapter
    );
    if (repairItem) {
      const badge =
        typeof verseOrNumber === 'number'
          ? this.isMultiChapter() && resolvedChapter
            ? `${resolvedChapter}:${verseNumber}`
            : `v. ${verseNumber}`
          : this.getVerseBadge(verseOrNumber);
      this.spawnedRepairItem.set(repairItem);
      this.repairSpawnedMessage.set(
        `🔧 Created Temporary Repair Card for ${badge} (heals after 3 Good/Easy reviews)!`
      );
    }
  }

  spawnAndPracticeDraftRepairNow(event?: Event): void {
    event?.stopPropagation();
    const committed = this.commitPendingRepairs();
    const targetRepair = committed[0] ?? this.spawnedRepairItem();
    if (targetRepair) {
      this.voiceService.pausePlayback();
      this.openRepairCard.emit(targetRepair);
    }
  }

  practiceSpawnedRepairNow(): void {
    const repair = this.spawnedRepairItem();
    if (repair) {
      this.voiceService.pausePlayback();
      this.openRepairCard.emit(repair);
      return;
    }
    this.spawnAndPracticeDraftRepairNow();
  }

  private commitPendingRepairs(): DeckItem[] {
    if (!this.item) {
      return [];
    }
    const ranges = this.allPendingRepairRanges();
    if (ranges.length === 0) {
      return [];
    }
    const verses = this.activeVerses();
    const created: DeckItem[] = [];

    for (const range of ranges) {
      const startV = verses[range.startIdx];
      const endV = verses[range.endIdx] ?? startV;
      if (!startV || !endV) {
        continue;
      }
      const item = this.storageService.createRepairCard(
        this.item.passage.id,
        startV.verseNumber,
        3,
        startV.chapterNumber,
        endV.verseNumber,
        endV.chapterNumber
      );
      if (item) {
        created.push(item);
      }
    }

    if (created.length > 0) {
      this.spawnedRepairItem.set(created[0]);
    }
    this.draftRepairRange.set(null);
    this.queuedRepairs.set([]);
    return created;
  }

  expandOneVerse(event?: Event): void {
    event?.stopPropagation();
    this.stitchNextVerse();
  }

  setStitchPhase(phase: StitchPracticePhase): void {
    this.stitchToastMessage.set(null);
    if (phase === 'full-passage') {
      const total = this.totalVerses();
      this.localTargetVerseCount.set(total);
      this.stitchedVerseCountChange.emit(total);
    }
    this.stitchPhase.set(phase);
  }

  setTargetVerseCount(count: number): void {
    const total = this.totalVerses();
    if (total <= 0) {
      return;
    }
    const clamped = Math.max(1, Math.min(count, total));
    this.localTargetVerseCount.set(clamped);
    this.stitchToastMessage.set(null);
    if (this.stitchPhase() === 'full-passage' && clamped < total) {
      this.stitchPhase.set('new-verse-only');
    }
    if (this.item && !this.item.card.isRepairCard) {
      const updated = this.storageService.updateStitchedVerseStep(this.item.card.id, clamped);
      if (updated) {
        this.currentItemSignal.set(updated);
      }
    }
    this.stitchedVerseCountChange.emit(clamped);
  }

  stitchNextVerse(): void {
    const next = Math.min(this.totalVerses(), this.activeStitchedCount() + 1);
    this.setTargetVerseCount(next);
    this.stitchPhase.set('new-verse-only');
  }

  unstitchOneVerse(): void {
    const prev = Math.max(1, this.activeStitchedCount() - 1);
    this.setTargetVerseCount(prev);
  }

  markAsMemorizing(): void {
    if (!this.item) {
      return;
    }
    const updated = this.storageService.startMemorizingPassage(this.item.card.id);
    if (updated) {
      this.currentItemSignal.set(updated);
    }
  }

  navigateToStudyPage(event?: Event): void {
    event?.stopPropagation();
    if (!this.item) {
      return;
    }
    this.voiceService.pausePlayback();
    this.openStudyPage.emit(this.item);
  }

  onSkipCard(event?: Event): void {
    event?.stopPropagation();
    this.voiceService.pausePlayback();
    this.skipCard.emit();
  }

  onEditPassage(event?: Event): void {
    event?.stopPropagation();
    this.voiceService.pausePlayback();
    this.editPassage.emit();
  }

  async onMicButtonClick(event: Event): Promise<void> {
    event.stopPropagation();
    await this.toggleVoiceRecording();
  }

  async toggleVoiceRecording(): Promise<void> {
    if (this.voiceService.isRecording()) {
      await this.voiceService.stopRecording();
    } else {
      await this.voiceService.startRecording();
    }
  }

  async flipToBack(): Promise<void> {
    this.isFlipped.set(true);
    this.restoreBackScrollTop();
    await this.voiceService.stopAndPlayOnFlip();
  }

  flipToFront(event?: Event): void {
    event?.stopPropagation();
    if (this.backScrollRef?.nativeElement) {
      this.savedBackScrollTop = this.backScrollRef.nativeElement.scrollTop;
    }
    this.voiceService.pausePlayback();
    this.isFlipped.set(false);
  }

  submitRating(rating: ReviewRating): void {
    if (!this.item) {
      return;
    }
    this.voiceService.pausePlayback();

    // First commit any queued or highlighted repair ranges
    if (!this.item.card.isRepairCard && this.allPendingRepairRanges().length > 0) {
      this.commitPendingRepairs();
    }

    // If this is a temporary Repair Card, emit directly so StorageService updates heal streak / retires when healed
    if (this.item.card.isRepairCard) {
      this.rated.emit({
        cardId: this.item.card.id,
        rating,
      });
      return;
    }

    const isMultiVerse = this.item.passage.verses.length > 1;
    const isGoodOrEasy =
      rating === ReviewRating.REVIEW_RATING_GOOD ||
      rating === ReviewRating.REVIEW_RATING_EASY;
    const currentTarget = this.activeStitchedCount();
    const total = this.totalVerses();

    // Two-step daily stitching workflow:
    // Step 1: Practicing ONLY the new verse for the day ('new-verse-only').
    if (isMultiVerse && this.stitchPhase() === 'new-verse-only' && isGoodOrEasy) {
      if (currentTarget <= 1) {
        const nextCount = Math.min(total, 2);
        this.setTargetVerseCount(nextCount);
        this.rated.emit({
          cardId: this.item.card.id,
          rating,
        });
        return;
      }

      const updated = this.storageService.recordReview(this.item.card.id, rating);
      if (updated) {
        this.currentItemSignal.set(updated);
      }
      const newVerseLabel = this.targetVerseVerboseLabel();
      const rangeLabel = this.stitchedVerseRangeLabel();

      this.stitchPhase.set('stitch-block');
      this.isFlipped.set(false);
      this.voiceService.resetForNewCard();
      this.stitchToastMessage.set(
        `✓ ${newVerseLabel} is solid! Step 2: Now recite the stitched block (${rangeLabel}) to complete the stitching.`
      );
      return;
    }

    // Step 2: Practicing the stitched block ('stitch-block').
    if (isMultiVerse && this.stitchPhase() === 'stitch-block' && isGoodOrEasy) {
      if (currentTarget < total) {
        const nextCount = Math.min(total, currentTarget + 1);
        this.setTargetVerseCount(nextCount);
      }
    }

    this.rated.emit({
      cardId: this.item.card.id,
      rating,
    });
  }

  getCardStateLabel(state: CardState | undefined): string {
    if (this.item?.card.isRepairCard) {
      return 'REPAIR';
    }
    switch (state) {
      case CardState.CARD_STATE_NEW:
        return 'SAVED';
      case CardState.CARD_STATE_LEARNING:
      case CardState.CARD_STATE_RELEARNING:
        return 'MEMORIZING';
      case CardState.CARD_STATE_REVIEW:
        return 'MEMORIZED';
      default:
        return 'SAVED';
    }
  }

  getCardStateBadgeClass(state: CardState | undefined): string {
    if (this.item?.card.isRepairCard) {
      return 'state-pill state-repair';
    }
    switch (state) {
      case CardState.CARD_STATE_NEW:
        return 'state-pill state-new';
      case CardState.CARD_STATE_LEARNING:
      case CardState.CARD_STATE_RELEARNING:
        return 'state-pill state-learning';
      case CardState.CARD_STATE_REVIEW:
        return 'state-pill state-review';
      default:
        return 'state-pill state-new';
    }
  }

  formatDuration(seconds: number): string {
    const totalSeconds = Math.max(0, Math.floor(seconds));
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  }
}
