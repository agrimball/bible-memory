import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { CardState, ReviewRating, Verse } from '../../core/proto/bible_memory.pb';
import { DeckItem, StorageService } from '../../core/services/storage.service';
import { SrsService } from '../../core/services/srs.service';
import { VoiceRecorderService } from '../../core/services/voice-recorder.service';

export type StitchPracticePhase = 'new-verse-only' | 'stitch-block' | 'full-passage';

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

  @Input() item: DeckItem | null = null;
  @Input() queuePosition = 1;
  @Input() queueTotal = 1;
  @Input() stitchedVerseCount = 0;

  @Output() rated = new EventEmitter<{ cardId: string; rating: ReviewRating }>();
  @Output() backToDeck = new EventEmitter<void>();
  @Output() openStudyPage = new EventEmitter<DeckItem>();
  @Output() openRepairCard = new EventEmitter<DeckItem>();
  @Output() stitchedVerseCountChange = new EventEmitter<number>();

  readonly isFlipped = signal<boolean>(false);
  readonly localTargetVerseCount = signal<number>(2);
  readonly stitchPhase = signal<StitchPracticePhase>('new-verse-only');
  readonly stitchToastMessage = signal<string | null>(null);
  readonly repairSpawnedMessage = signal<string | null>(null);
  readonly spawnedRepairItem = signal<DeckItem | null>(null);

  readonly CardState = CardState;
  readonly ReviewRating = ReviewRating;

  private readonly currentItemSignal = signal<DeckItem | null>(null);

  readonly isRepairCard = computed<boolean>(() => {
    return Boolean(this.currentItemSignal()?.card.isRepairCard);
  });

  readonly repairTargetVerse = computed<Verse | null>(() => {
    const current = this.currentItemSignal();
    if (!current || !current.card.isRepairCard) {
      return null;
    }
    const targetNum = current.card.repairVerseNumber;
    return (
      current.passage.verses.find((v) => v.verseNumber === targetNum) ??
      current.passage.verses[0] ??
      null
    );
  });

  readonly repairPrecedingVerse = computed<Verse | null>(() => {
    const current = this.currentItemSignal();
    if (!current || !current.card.isRepairCard) {
      return null;
    }
    const targetNum = current.card.repairVerseNumber;
    const idx = current.passage.verses.findIndex((v) => v.verseNumber === targetNum);
    if (idx > 0) {
      return current.passage.verses[idx - 1];
    }
    return null;
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
    return Math.min(2, total);
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

  /**
   * The verse immediately preceding today's new verse.
   */
  readonly previousContextVerse = computed<Verse | null>(() => {
    const current = this.currentItemSignal();
    if (!current || current.passage.verses.length <= 1) {
      return null;
    }
    const targetIdx = Math.max(
      0,
      Math.min(this.activeStitchedCount() - 1, current.passage.verses.length - 1)
    );
    if (targetIdx === 0) {
      return null;
    }
    return current.passage.verses[targetIdx - 1] ?? null;
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
    this.stitchToastMessage.set(null);
    this.repairSpawnedMessage.set(null);
    this.spawnedRepairItem.set(null);
    this.voiceService.resetForNewCard();

    const total = this.item?.passage.verses.length ?? 0;
    if (total <= 1 || this.item?.card.isRepairCard) {
      this.localTargetVerseCount.set(Math.max(1, total));
      this.stitchPhase.set('full-passage');
      return;
    }

    const initialCount =
      this.stitchedVerseCount > 0 && this.stitchedVerseCount <= total
        ? this.stitchedVerseCount
        : Math.min(2, total);
    this.localTargetVerseCount.set(initialCount);

    if (this.item?.card.state === CardState.CARD_STATE_REVIEW) {
      this.stitchPhase.set('full-passage');
      this.localTargetVerseCount.set(total);
    } else {
      this.stitchPhase.set('new-verse-only');
    }
  }

  spawnRepairCardForVerse(verseNumber: number): void {
    if (!this.item) {
      return;
    }
    const repairItem = this.storageService.createRepairCard(
      this.item.passage.id,
      verseNumber,
      3
    );
    if (repairItem) {
      this.spawnedRepairItem.set(repairItem);
      this.repairSpawnedMessage.set(
        `🔧 Created Temporary Repair Card for v. ${verseNumber} (heals after 3 Good/Easy reviews)!`
      );
    }
  }

  practiceSpawnedRepairNow(): void {
    const repair = this.spawnedRepairItem();
    if (!repair) {
      return;
    }
    this.voiceService.pausePlayback();
    this.openRepairCard.emit(repair);
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

  navigateToStudyPage(): void {
    if (!this.item) {
      return;
    }
    this.voiceService.pausePlayback();
    this.openStudyPage.emit(this.item);
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
    await this.voiceService.stopAndPlayOnFlip();
  }

  flipToFront(): void {
    this.voiceService.pausePlayback();
    this.isFlipped.set(false);
  }

  submitRating(rating: ReviewRating): void {
    if (!this.item) {
      return;
    }
    this.voiceService.pausePlayback();

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

    // Two-step daily stitching workflow:
    // Step 1: Practicing ONLY the new verse for the day ('new-verse-only').
    // When graded Good or Easy -> automatically switch to Step 2 ('stitch-block') to practice the whole block!
    if (isMultiVerse && this.stitchPhase() === 'new-verse-only' && isGoodOrEasy) {
      const updated = this.storageService.recordReview(this.item.card.id, rating);
      if (updated) {
        this.currentItemSignal.set(updated);
      }
      const newVerseNum = this.currentNewVerse()?.verseNumber ?? this.activeStitchedCount();
      const firstVerseNum = this.item.passage.verses[0]?.verseNumber ?? 1;

      this.stitchPhase.set('stitch-block');
      this.isFlipped.set(false);
      this.voiceService.resetForNewCard();
      this.stitchToastMessage.set(
        `✓ Verse ${newVerseNum} is solid! Step 2: Now recite the stitched block (v. ${firstVerseNum}–${newVerseNum}) to complete the stitching.`
      );
      return;
    }

    // Step 2: Practicing the stitched block ('stitch-block').
    // When graded Good or Easy -> completes the stitching for this block!
    if (isMultiVerse && this.stitchPhase() === 'stitch-block' && isGoodOrEasy) {
      const total = this.totalVerses();
      if (this.activeStitchedCount() < total) {
        const nextCount = this.activeStitchedCount() + 1;
        this.localTargetVerseCount.set(nextCount);
        this.stitchedVerseCountChange.emit(nextCount);
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
