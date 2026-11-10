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
  @Output() appendPassage = new EventEmitter<void>();
  @Output() chunkCarved = new EventEmitter<DeckItem>();
  @Output() backToDeck = new EventEmitter<void>();
  @Output() openStudyPage = new EventEmitter<DeckItem>();
  @Output() studyScopeChange = new EventEmitter<'new-verse' | 'stitched' | 'full'>();
  @Output() openRepairCard = new EventEmitter<DeckItem>();
  @Output() stitchedVerseCountChange = new EventEmitter<number>();

  readonly isFlipped = signal<boolean>(false);
  readonly showHint = signal<boolean>(false);
  readonly localTargetVerseCount = signal<number>(1);
  readonly stitchPhase = signal<StitchPracticePhase>('new-verse-only');
  readonly isStitchWalkthroughActive = signal<boolean>(false);
  readonly stitchToastMessage = signal<string | null>(null);
  readonly repairSpawnedMessage = signal<string | null>(null);
  readonly spawnedRepairItem = signal<DeckItem | null>(null);
  readonly showCarveChunkSheet = signal<boolean>(false);
  readonly showScopeSheet = signal<boolean>(false);
  readonly showRemainingVerses = signal<boolean>(false);
  readonly showMoreScopeOptions = signal<boolean>(false);
  readonly chunkLabel = signal<string>('');
  readonly selectedSplitAfterIndices = signal<number[]>([]);
  readonly splitHistoryStack = signal<number[][]>([]);
  readonly splitUndoBannerMessage = signal<string | null>(null);
  private lastSplitPassageIds: string[] = [];
  private lastSplitOriginalLabel?: string;

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

  readonly recitedVerses = computed<Verse[]>(() => {
    if (this.isRepairCard()) {
      return this.repairTargetVerses();
    }
    const verses = this.activeVerses();
    if (verses.length === 0) {
      return [];
    }
    const phase = this.stitchPhase();
    if (phase === 'new-verse-only') {
      const nv = this.currentNewVerse();
      return nv ? [nv] : verses.slice(0, 1);
    }
    if (phase === 'stitch-block') {
      return verses.slice(0, Math.max(1, this.activeStitchedCount()));
    }
    return verses;
  });

  readonly openingHintText = computed<string>(() => {
    const firstRecited =
      this.resumeTargetVerse() ??
      this.recitedVerses()[0] ??
      this.currentItemSignal()?.passage.verses[0] ??
      null;
    if (!firstRecited || !firstRecited.text) {
      return '';
    }
    return firstRecited.text.trim().split(/\s+/).slice(0, 5).join(' ');
  });

  readonly recitedVersesScopeLabel = computed<string>(() => {
    if (this.isRepairCard()) {
      return this.repairTargetLabel();
    }
    const recited = this.recitedVerses();
    if (recited.length === 0) {
      return 'v. 1';
    }
    if (recited.length === 1) {
      return formatVerseBadge(recited[0], this.isMultiChapter());
    }
    return formatVerseRange(
      recited[0],
      recited[recited.length - 1],
      this.isMultiChapter()
    );
  });

  readonly recitationTime = computed<{ seconds: number; label: string }>(() => {
    const verses = this.recitedVerses();
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

  readonly currentCardState = computed<CardState>(() => {
    return this.currentItemSignal()?.card.state ?? this.item?.card.state ?? CardState.CARD_STATE_NEW;
  });

  readonly showStitchStrip = computed<boolean>(() => {
    if (this.isRepairCard()) {
      return false;
    }
    const current = this.currentItemSignal() ?? this.item;
    if (!current || current.card.state === CardState.CARD_STATE_NEW) {
      return false;
    }
    const total = this.totalVerses();
    if (total <= 1 || this.activeStitchedCount() <= 1) {
      return false;
    }
    if (
      current.card.state === CardState.CARD_STATE_REVIEW &&
      (current.card.learningStep || 1) >= total &&
      this.activeStitchedCount() >= total
    ) {
      return false;
    }
    return this.isStitchWalkthroughActive();
  });

  readonly frontPromptBadge = computed<string>(() => {
    if (this.isRepairCard()) {
      return `Memory Repair · ${this.repairTargetLabel()}`;
    }
    if (
      this.currentCardState() === CardState.CARD_STATE_NEW ||
      this.totalVerses() <= 1 ||
      this.stitchPhase() === 'full-passage'
    ) {
      return 'ESV';
    }
    if (this.isStitchWalkthroughActive()) {
      if (this.stitchPhase() === 'new-verse-only') {
        return `Step 1 · Learn New Verse (${this.targetVerseLabel()})`;
      }
      return `Step 2 · Stitch Together (${this.stitchedVerseRangeLabel()})`;
    }
    return `Recite ${this.recitedVersesScopeLabel()}`;
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
      return `🩹 ${this.repairTargetLabel()}`;
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

  readonly lastVerseLabel = computed<string>(() => {
    const verses = this.activeVerses();
    if (verses.length === 0) {
      return 'v. 1';
    }
    return this.getVerseBadge(verses[verses.length - 1]);
  });

  readonly canCarvePrefixChunk = computed<boolean>(() => {
    const count = this.activeStitchedCount();
    const total = this.totalVerses();
    return !this.isRepairCard() && total > 1 && count >= 1 && count < total;
  });

  readonly showLongChunkWarning = computed<boolean>(() => {
    return (
      this.canCarvePrefixChunk() &&
      (this.activeStitchedCount() >= 10 || this.recitationTime().seconds >= 60)
    );
  });

  /**
   * Cross-Chunk Continuity: If the current passage starts at verse > 1 and there is a
   * preceding contiguous chunk in the same book & chapter in StorageService, return it
   * so we can show a 1-line breadcrumb and use its last verse as a lead-in cue!
   */
  readonly precedingChunkInfo = computed<{ passage: Passage; lastVerse: Verse } | null>(() => {
    const current = this.currentItemSignal();
    if (!current || this.isRepairCard() || current.passage.verses.length === 0) {
      return null;
    }
    const firstVerse = current.passage.verses[0];
    if (firstVerse.verseNumber <= 1) {
      return null;
    }
    const refMatch = current.passage.reference.trim().match(/^(.+?)\s+(\d+)\s*:/);
    if (!refMatch) {
      return null;
    }
    const bookKey = refMatch[1].trim().toLowerCase();
    const refChap = Number(refMatch[2]);
    const targetChap = firstVerse.chapterNumber || refChap;
    const targetPrevVerseNum = firstVerse.verseNumber - 1;

    const allPassages = this.storageService.passages();
    for (const p of allPassages) {
      if (
        p.id === current.passage.id ||
        p.id.startsWith('psg_stitched_') ||
        p.id.startsWith('psg_seam_') ||
        p.verses.length === 0
      ) {
        continue;
      }
      const pMatch = p.reference.trim().match(/^(.+?)\s+(\d+)\s*:/);
      if (!pMatch || pMatch[1].trim().toLowerCase() !== bookKey) {
        continue;
      }
      const pStartChap = Number(pMatch[2]);
      const lastV = p.verses[p.verses.length - 1];
      const lastVChap = lastV.chapterNumber || pStartChap;
      if (lastVChap === targetChap && lastV.verseNumber === targetPrevVerseNum) {
        return { passage: p, lastVerse: lastV };
      }
    }
    return null;
  });

  /**
   * Returns a preceding lead-in verse ONLY when recitation starts after the 1st verse:
   * - When resuming mid-passage (`resumeFromVerseIndex() > 0`)
   * - When practicing a repair card (`isRepairCard()`)
   * - When in Step 1 (`new-verse-only`) for verse 2+ (`activeStitchedCount() > 1`)
   * - Or when starting a carved contiguous chunk (`precedingChunkInfo()`) at its 1st verse
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
    if (this.activeStitchedCount() === 1) {
      const prevChunk = this.precedingChunkInfo();
      if (prevChunk) {
        return prevChunk.lastVerse;
      }
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

  readonly draftVerseCount = computed<number>(() => {
    const draft = this.draftRepairRange();
    if (!draft) {
      return 0;
    }
    return Math.max(1, draft.endIdx - draft.startIdx + 1);
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

  readonly queuedRepairsSummary = computed<string>(() => {
    const ranges = this.queuedRepairs();
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
    let cardChanged = false;
    if (changes['item']) {
      const prevItem = changes['item'].previousValue as DeckItem | null | undefined;
      const prevCardId = prevItem?.card?.id;
      const nextCardId = this.item?.card?.id;
      const prevLen = prevItem?.passage?.verses?.length ?? 0;
      const nextLen = this.item?.passage?.verses?.length ?? 0;
      const prevFirstVerse = prevItem?.passage?.verses?.[0]?.verseNumber;
      const nextFirstVerse = this.item?.passage?.verses?.[0]?.verseNumber;
      this.currentItemSignal.set(this.item);
      if (prevCardId !== nextCardId || prevFirstVerse !== nextFirstVerse) {
        cardChanged = true;
        this.initializeForCurrentCard();
      } else if (nextLen !== prevLen && nextLen > 0) {
        const savedStep = Math.max(1, Math.min(this.item?.card.learningStep || 1, nextLen));
        this.localTargetVerseCount.set(
          this.item?.card.state === CardState.CARD_STATE_NEW ? nextLen : savedStep
        );
        if (this.item?.card.state === CardState.CARD_STATE_NEW || savedStep >= nextLen) {
          this.stitchPhase.set('full-passage');
        } else {
          this.stitchPhase.set('stitch-block');
        }
      }
    }
    if (
      !cardChanged &&
      changes['stitchedVerseCount'] &&
      !changes['stitchedVerseCount'].firstChange &&
      this.stitchedVerseCount > 0
    ) {
      this.localTargetVerseCount.set(this.stitchedVerseCount);
    }
  }

  ngOnDestroy(): void {
    this.voiceService.resetForNewCard();
  }

  private initializeForCurrentCard(): void {
    this.isFlipped.set(false);
    this.showHint.set(false);
    this.isStitchWalkthroughActive.set(false);
    this.stitchToastMessage.set(null);
    this.repairSpawnedMessage.set(null);
    this.spawnedRepairItem.set(null);
    this.showCarveChunkSheet.set(false);
    this.showScopeSheet.set(false);
    this.showMoreScopeOptions.set(false);
    this.chunkLabel.set('');
    this.selectedSplitAfterIndices.set([]);
    this.splitHistoryStack.set([]);
    this.draftRepairRange.set(null);
    this.queuedRepairs.set([]);
    this.resumeFromVerseIndex.set(null);
    this.savedBackScrollTop = 0;
    this.resetBackScrollTop();
    this.voiceService.resetForNewCard();

    const total = this.item?.passage.verses.length ?? 0;
    this.showRemainingVerses.set(false);
    if (total <= 1 || this.item?.card.isRepairCard) {
      this.localTargetVerseCount.set(Math.max(1, total));
      this.stitchPhase.set('full-passage');
      return;
    }

    // 1. When opening a NEW card: default to showing all verses ('full-passage', localTargetVerseCount = total)
    if (this.item?.card.state === CardState.CARD_STATE_NEW) {
      this.localTargetVerseCount.set(total);
      this.stitchPhase.set('full-passage');
      return;
    }

    const savedStep = this.item?.card.learningStep || 1;

    // 2. When a passage is fully known ((card.learningStep || 1) >= totalVerses && card.state === CardState.CARD_STATE_REVIEW)
    if (savedStep >= total && this.item?.card.state === CardState.CARD_STATE_REVIEW) {
      this.localTargetVerseCount.set(total);
      this.stitchPhase.set('full-passage');
      return;
    }

    // 3. When opening a DUE / KNOWN card that is partially memorized (1 <= learningStep < totalVerses):
    // Default to simple review of the already-memorized verses (stitchPhase = 'stitch-block', reciting v. 1..learningStep)
    const initialCount =
      this.stitchedVerseCount >= 1 && this.stitchedVerseCount <= total
        ? this.stitchedVerseCount
        : Math.max(1, Math.min(savedStep, total));
    this.localTargetVerseCount.set(initialCount);
    if (initialCount >= total) {
      this.stitchPhase.set('full-passage');
    } else {
      this.stitchPhase.set('stitch-block');
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
   * Tap a verse on the Back of the card:
   * - On NEW cards (`CARD_STATE_NEW`), tapping a verse immediately flips back to the Front
   *   for rapid Front <-> Back initial memorization without triggering verse-repair highlighting!
   * - On DUE/REVIEW cards, tapping starts/extends/cancels a repair highlight range:
   *   - Tapping inside the current draft range cancels it.
   *   - Tapping inside a queued repair range removes that queued range.
   *   - Tapping an unhighlighted verse when no draft is active starts `[idx..idx]`.
   *   - Tapping another verse while a draft `[s..e]` is active extends it to `[min(s,idx)..max(e,idx)]`.
   */
  onVerseTap(idx: number, event?: Event): void {
    event?.stopPropagation();
    if (this.currentCardState() === CardState.CARD_STATE_NEW) {
      this.flipToFront();
      return;
    }
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

  /**
   * Tapping the Back card surface outside interactive controls flips back to the Front
   * (and on NEW cards, tapping anywhere on the Back text or surface flips to the Front).
   */
  onBackSurfaceClick(event: Event): void {
    const target = event.target as HTMLElement | null;
    if (
      target?.closest(
        'button, input, .back-inline-scope-boundary, .incremental-chunk-sheet, .back-voice-strip'
      )
    ) {
      return;
    }
    if (this.currentCardState() === CardState.CARD_STATE_NEW) {
      this.flipToFront();
      return;
    }
    if (!target?.closest('.verse-line')) {
      this.flipToFront();
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
        `🩹 Created Temporary Patch Card for ${badge} (heals after 3 Good/Easy reviews)!`
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
    if (this.isFlipped()) {
      this.flipToFront();
    }
  }

  setStitchPhase(phase: StitchPracticePhase): void {
    this.stitchToastMessage.set(null);
    if (phase === 'full-passage') {
      const total = this.totalVerses();
      this.localTargetVerseCount.set(total);
      this.stitchedVerseCountChange.emit(total);
    } else if (this.activeStitchedCount() >= 2) {
      this.isStitchWalkthroughActive.set(true);
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
    if (clamped <= 1) {
      this.isStitchWalkthroughActive.set(false);
    }
    if (this.stitchPhase() === 'full-passage' && clamped < total) {
      this.stitchPhase.set('stitch-block');
    }
    const current = this.currentItemSignal() ?? this.item;
    if (current && !current.card.isRepairCard && current.card.state !== CardState.CARD_STATE_NEW) {
      const updated = this.storageService.updateStitchedVerseStep(current.card.id, clamped);
      if (updated) {
        this.item = updated;
        this.currentItemSignal.set(updated);
      }
    }
    this.stitchedVerseCountChange.emit(clamped);
  }

  stitchNextVerse(): void {
    const next = Math.min(this.totalVerses(), this.activeStitchedCount() + 1);
    this.setTargetVerseCount(next);
    this.stitchPhase.set('new-verse-only');
    if (next >= 2) {
      this.isStitchWalkthroughActive.set(true);
    }
    this.showScopeSheet.set(false);
  }

  unstitchOneVerse(): void {
    const prev = Math.max(1, this.activeStitchedCount() - 1);
    this.setTargetVerseCount(prev);
  }

  markAsMemorizing(): void {
    this.moveToReviewDeck();
  }

  moveToReviewDeck(event?: Event): void {
    event?.stopPropagation();
    const current = this.currentItemSignal() ?? this.item;
    if (!current) {
      return;
    }
    const total = this.totalVerses();
    const desiredCount = this.activeStitchedCount();
    let updated = this.storageService.startMemorizingPassage(current.card.id);
    if (desiredCount >= 1 && desiredCount < total) {
      updated = this.storageService.updateStitchedVerseStep(current.card.id, desiredCount) ?? updated;
    }
    if (updated) {
      this.item = updated;
      this.currentItemSignal.set(updated);
      const nextStep = updated.card.learningStep || 1;
      this.localTargetVerseCount.set(nextStep);
      this.isStitchWalkthroughActive.set(false);
      this.stitchPhase.set(nextStep >= total ? 'full-passage' : 'stitch-block');
      this.stitchedVerseCountChange.emit(nextStep);
    }
  }

  markEntirePassageKnown(event?: Event): void {
    event?.stopPropagation();
    this.showScopeSheet.set(false);
    const current = this.currentItemSignal() ?? this.item;
    if (!current) {
      return;
    }
    const total = Math.max(1, this.totalVerses());
    const svc = this.storageService as unknown as {
      markEntirePassageKnown?: (cardOrPassageId: string) => DeckItem | undefined | void;
    };
    let updated: DeckItem | undefined;
    if (typeof svc.markEntirePassageKnown === 'function') {
      const res = svc.markEntirePassageKnown(current.card.id);
      updated =
        (res as DeckItem | undefined) ??
        this.storageService.deckItems().find((d) => d.card.id === current.card.id);
    } else {
      updated = this.storageService.updateStitchedVerseStep(current.card.id, total);
      if (updated) {
        updated =
          this.storageService.recordReview(current.card.id, ReviewRating.REVIEW_RATING_EASY) ??
          updated;
      }
    }
    if (updated) {
      this.item = updated;
      this.currentItemSignal.set(updated);
    }
    this.localTargetVerseCount.set(total);
    this.isStitchWalkthroughActive.set(false);
    this.stitchPhase.set('full-passage');
    this.stitchedVerseCountChange.emit(total);
  }

  moveCardToNew(event?: Event): void {
    event?.stopPropagation();
    this.showScopeSheet.set(false);
    const current = this.currentItemSignal() ?? this.item;
    if (!current) {
      return;
    }
    this.voiceService.pausePlayback();
    const svc = this.storageService as unknown as {
      moveCardToNew?: (cardOrPassageId: string) => DeckItem | undefined | void;
    };
    let updated: DeckItem | undefined;
    if (typeof svc.moveCardToNew === 'function') {
      const res = svc.moveCardToNew(current.card.id);
      updated =
        (res as DeckItem | undefined) ??
        this.storageService.deckItems().find((d) => d.card.id === current.card.id);
    } else {
      updated = this.storageService.truncatePassageProgress(current.card.id, 0);
    }
    if (updated) {
      this.item = updated;
      this.currentItemSignal.set(updated);
    }
    this.backToDeck.emit();
  }

  navigateToStudyPage(event?: Event): void {
    event?.stopPropagation();
    if (!this.item) {
      return;
    }
    this.voiceService.pausePlayback();
    const count = this.activeStitchedCount();
    this.stitchedVerseCountChange.emit(count);

    let targetScope: 'new-verse' | 'stitched' | 'full' = 'full';
    if (
      this.currentCardState() === CardState.CARD_STATE_NEW ||
      this.stitchPhase() === 'full-passage'
    ) {
      targetScope = 'full';
    } else if (this.stitchPhase() === 'new-verse-only' || count <= 1) {
      targetScope = 'new-verse';
    } else {
      targetScope = 'stitched';
    }
    this.studyScopeChange.emit(targetScope);
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

  onAppendPassage(event?: Event): void {
    event?.stopPropagation();
    this.showScopeSheet.set(false);
    this.voiceService.pausePlayback();
    this.appendPassage.emit();
  }

  toggleScopeSheet(event?: Event): void {
    event?.stopPropagation();
    this.showScopeSheet.update((v) => !v);
  }

  closeScopeSheet(event?: Event): void {
    event?.stopPropagation();
    this.showScopeSheet.set(false);
  }

  toggleRemainingVerses(event?: Event): void {
    event?.stopPropagation();
    this.showRemainingVerses.update((v) => !v);
  }

  isRemainingVersesExpanded(): boolean {
    return this.showRemainingVerses();
  }

  toggleMoreScopeOptions(event?: Event): void {
    event?.stopPropagation();
    this.showMoreScopeOptions.update((v) => !v);
  }

  toggleCarveChunkSheet(event?: Event): void {
    event?.stopPropagation();
    this.showScopeSheet.set(false);
    const next = !this.showCarveChunkSheet();
    this.showCarveChunkSheet.set(next);
    if (next) {
      const total = this.totalVerses();
      const activeCount = this.activeStitchedCount();
      if (total > 1 && activeCount >= 1 && activeCount < total) {
        this.selectedSplitAfterIndices.set([activeCount - 1]);
        this.splitHistoryStack.set([[]]);
      } else if (total > 1) {
        this.selectedSplitAfterIndices.set([0]);
        this.splitHistoryStack.set([[]]);
      } else {
        this.selectedSplitAfterIndices.set([]);
        this.splitHistoryStack.set([]);
      }
      this.chunkLabel.set('');
    }
  }

  isSplitBoundarySelected(idx: number): boolean {
    return this.selectedSplitAfterIndices().includes(idx);
  }

  toggleSplitBoundary(idx: number, event?: Event): void {
    event?.stopPropagation();
    const total = this.totalVerses();
    if (idx < 0 || idx >= total - 1) {
      return;
    }
    const curr = this.selectedSplitAfterIndices();
    this.splitHistoryStack.update((stack) => [...stack, [...curr]]);
    const next = curr.includes(idx)
      ? curr.filter((i) => i !== idx)
      : [...curr, idx].sort((a, b) => a - b);
    this.selectedSplitAfterIndices.set(next);
  }

  undoSplitBoundaryChange(event?: Event): void {
    event?.stopPropagation();
    const stack = this.splitHistoryStack();
    if (stack.length === 0) {
      return;
    }
    const prev = stack[stack.length - 1];
    this.splitHistoryStack.set(stack.slice(0, -1));
    this.selectedSplitAfterIndices.set(prev);
  }

  cancelCarveChunk(event?: Event): void {
    this.closeCarveChunkSheet(event);
  }

  closeCarveChunkSheet(event?: Event): void {
    event?.stopPropagation();
    this.showCarveChunkSheet.set(false);
  }

  onChunkLabelInput(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    this.chunkLabel.set(input?.value ?? '');
  }

  confirmCarveChunk(event?: Event): void {
    event?.stopPropagation();
    const current = this.currentItemSignal() ?? this.item;
    if (!current) {
      return;
    }
    const total = this.totalVerses();
    if (total <= 1) {
      return;
    }

    const rawIndices = this.selectedSplitAfterIndices()
      .filter((i) => i >= 0 && i < total - 1)
      .sort((a, b) => a - b);
    const fallbackIdx = Math.max(0, Math.min(this.activeStitchedCount() - 1, total - 2));
    const splitIndices = rawIndices.length > 0 ? rawIndices : [fallbackIdx];
    const labelText = this.chunkLabel().trim();
    this.lastSplitOriginalLabel = current.passage.label;

    const svc = this.storageService as unknown as {
      splitPassageAtBoundaries?: (
        cardOrPassageId: string,
        splitAfterVerseIndices: number[],
        customLabelsByChunkIndex?: Record<number, string>
      ) =>
        | DeckItem[]
        | {
            createdItems?: DeckItem[];
            chunks?: DeckItem[];
            activeItem?: DeckItem;
            remainingPassage?: DeckItem;
          }
        | undefined;
    };

    let nextActiveItem: DeckItem | undefined;
    if (typeof svc.splitPassageAtBoundaries === 'function') {
      const res = svc.splitPassageAtBoundaries(
        current.card.id,
        splitIndices,
        labelText ? { 0: labelText } : undefined
      );
      if (Array.isArray(res)) {
        if (res.length > 0) {
          this.lastSplitPassageIds = res.map((d) => d.passage.id);
          nextActiveItem =
            res.find((d) => d.card.state !== CardState.CARD_STATE_REVIEW) ??
            res[res.length - 1] ??
            res[0];
        }
      } else if (res && typeof res === 'object') {
        const list = res.createdItems ?? res.chunks ?? [];
        this.lastSplitPassageIds = list.map((d: DeckItem) => d.passage.id);
        nextActiveItem =
          res.activeItem ??
          res.remainingPassage ??
          list.find((d: DeckItem) => d.card.state !== CardState.CARD_STATE_REVIEW) ??
          list[list.length - 1];
      }
    } else {
      const prefixCount = splitIndices[0] + 1;
      const res = this.storageService.carveOffPrefixAsNamedChunk(
        current.card.id,
        prefixCount,
        labelText || undefined
      );
      if (res) {
        this.lastSplitPassageIds = [
          res.completedChunk.passage.id,
          res.remainingPassage.passage.id,
        ];
        nextActiveItem = res.remainingPassage;
      }
    }

    this.showCarveChunkSheet.set(false);
    this.chunkLabel.set('');
    this.selectedSplitAfterIndices.set([]);
    this.splitHistoryStack.set([]);
    this.splitUndoBannerMessage.set(`✓ Split into ${splitIndices.length + 1} passages`);

    const resolvedItem =
      nextActiveItem ??
      this.storageService.deckItems().find((d) => d.card.id === current.card.id) ??
      this.storageService.deckItems()[0];
    if (resolvedItem) {
      this.item = resolvedItem;
      this.currentItemSignal.set(resolvedItem);
      const remTotal = resolvedItem.passage.verses.length;
      const remStep = Math.max(1, Math.min(resolvedItem.card.learningStep || 1, remTotal));
      this.localTargetVerseCount.set(remStep);
      this.isStitchWalkthroughActive.set(false);
      this.stitchPhase.set(remStep >= remTotal ? 'full-passage' : 'stitch-block');
      this.stitchedVerseCountChange.emit(remStep);
      this.chunkCarved.emit(resolvedItem);
    }
  }

  undoLastPassageSplit(event?: Event): void {
    event?.stopPropagation();
    const svc = this.storageService as unknown as {
      undoLastSplit?: () => DeckItem | undefined;
    };
    let restored: DeckItem | undefined;
    if (typeof svc.undoLastSplit === 'function') {
      restored = svc.undoLastSplit();
    } else if (this.lastSplitPassageIds.length >= 2) {
      restored = this.storageService.combinePassages(
        this.lastSplitPassageIds,
        this.lastSplitOriginalLabel
      );
    }
    this.splitUndoBannerMessage.set(null);
    this.lastSplitPassageIds = [];
    if (restored) {
      this.item = restored;
      this.currentItemSignal.set(restored);
      const total = restored.passage.verses.length;
      const step = Math.max(1, Math.min(restored.card.learningStep || 1, total));
      this.localTargetVerseCount.set(step);
      this.isStitchWalkthroughActive.set(false);
      this.stitchPhase.set(step >= total ? 'full-passage' : 'stitch-block');
      this.stitchedVerseCountChange.emit(step);
      this.chunkCarved.emit(restored);
    }
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
        this.setTargetVerseCount(1);
        this.rated.emit({
          cardId: this.item.card.id,
          rating,
        });
        return;
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
      this.setTargetVerseCount(currentTarget);
    }

    this.rated.emit({
      cardId: this.item.card.id,
      rating,
    });
  }

  getCardStateLabel(state: CardState | undefined): string {
    if (this.item?.card.isRepairCard) {
      return 'PATCH';
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
