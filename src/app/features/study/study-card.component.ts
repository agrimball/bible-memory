import {
  ChangeDetectorRef,
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
import { CardState, ReviewRating } from '../../core/proto/bible_memory.pb';
import { DeckItem, StorageService } from '../../core/services/storage.service';
import { SrsService } from '../../core/services/srs.service';
import {
  FirstLetterStudyService,
  StudyVerseView,
  StudyWordToken,
} from '../../core/services/first-letter-study.service';
import { VoiceRecorderService } from '../../core/services/voice-recorder.service';

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
  readonly studyService = inject(FirstLetterStudyService);
  readonly voiceService = inject(VoiceRecorderService);
  private readonly cdr = inject(ChangeDetectorRef);

  @Input() item: DeckItem | null = null;
  @Input() queuePosition = 1;
  @Input() queueTotal = 1;

  @Output() rated = new EventEmitter<{ cardId: string; rating: ReviewRating }>();
  @Output() backToDeck = new EventEmitter<void>();

  readonly isFlipped = signal<boolean>(false);

  readonly CardState = CardState;
  readonly ReviewRating = ReviewRating;

  private readonly currentItemSignal = signal<DeckItem | null>(null);

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

  readonly activeVerseView = computed<StudyVerseView | null>(() => {
    const visible = this.studyService.visibleVerses();
    if (visible.length === 0) {
      return null;
    }
    return visible.find((v) => v.status === 'active') ?? visible[visible.length - 1];
  });

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['item']) {
      this.currentItemSignal.set(this.item);
      this.initializeForCurrentCard();
    }
  }

  ngOnDestroy(): void {
    this.voiceService.resetForNewCard();
  }

  private initializeForCurrentCard(): void {
    this.isFlipped.set(false);
    this.voiceService.resetForNewCard();
    if (this.item?.passage) {
      this.studyService.loadPassage(this.item.passage);
    }
  }

  enterStudyMode(): void {
    if (this.item?.passage && this.studyService.totalVersesCount() === 0) {
      this.studyService.loadPassage(this.item.passage);
    }
    this.studyService.enterStudyMode();
    this.cdr.detectChanges();
  }

  revealOneWord(): void {
    this.studyService.revealOneWord();
    this.cdr.detectChanges();
  }

  revealOneVerse(): void {
    this.studyService.revealOneVerse();
    this.cdr.detectChanges();
  }

  resetStudyMode(): void {
    this.studyService.enterStudyMode();
    this.cdr.detectChanges();
  }

  exitStudyMode(): void {
    this.studyService.exitStudyMode();
    this.cdr.detectChanges();
  }

  async toggleVoiceRecording(): Promise<void> {
    if (this.voiceService.isRecording()) {
      await this.voiceService.stopRecording();
    } else {
      await this.voiceService.startRecording();
    }
    this.cdr.detectChanges();
  }

  async flipToBack(): Promise<void> {
    this.isFlipped.set(true);
    this.cdr.detectChanges();
    await this.voiceService.stopAndPlayOnFlip();
    this.cdr.detectChanges();
  }

  flipToFront(): void {
    this.voiceService.pausePlayback();
    this.isFlipped.set(false);
    this.cdr.detectChanges();
  }

  submitRating(rating: ReviewRating): void {
    if (!this.item) {
      return;
    }
    this.voiceService.pausePlayback();
    this.rated.emit({
      cardId: this.item.card.id,
      rating,
    });
  }

  getCardStateLabel(state: CardState | undefined): string {
    switch (state) {
      case CardState.CARD_STATE_NEW:
        return 'NEW';
      case CardState.CARD_STATE_LEARNING:
        return 'LEARNING';
      case CardState.CARD_STATE_RELEARNING:
        return 'RELEARNING';
      case CardState.CARD_STATE_REVIEW:
        return 'REVIEW';
      default:
        return 'NEW';
    }
  }

  getCardStateBadgeClass(state: CardState | undefined): string {
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

  trackByVerseNumber(_index: number, verse: StudyVerseView): string {
    return `${verse.verseIndex}-${verse.status}-${verse.revealedWordCount}`;
  }

  trackByWordIndex(_index: number, word: StudyWordToken): string {
    return `${word.index}-${word.isRevealed}`;
  }
}
