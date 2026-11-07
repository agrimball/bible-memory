import { Injectable } from '@angular/core';
import { CardState, Flashcard, ReviewLog, ReviewRating } from '../proto/bible_memory.pb';

const MIN_EASE_FACTOR = 1.3;
const INITIAL_EASE_FACTOR = 2.5;
const TEN_MINUTES_DAYS = 0.007; // ~10.08 minutes in days
const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable({ providedIn: 'root' })
export class SrsService {
  /**
   * Creates a brand-new flashcard for a passage in CARD_STATE_NEW.
   */
  createInitialFlashcard(passageId: string, now: Date = new Date()): Flashcard {
    const isoNow = now.toISOString();
    return {
      id: this.generateId('card'),
      passageId,
      state: CardState.CARD_STATE_NEW,
      easeFactor: INITIAL_EASE_FACTOR,
      intervalDays: 0,
      repetitions: 0,
      learningStep: 0,
      dueAt: isoNow,
      lastReviewedAt: '',
      lapses: 0,
      createdAt: isoNow,
      updatedAt: isoNow,
    };
  }

  /**
   * Returns human-readable next interval labels for Again, Hard, Good, and Easy.
   */
  getIntervalPreviews(card: Flashcard, now: Date = new Date()): Record<ReviewRating, string> {
    const againCard = this.gradeCard(card, ReviewRating.REVIEW_RATING_AGAIN, now).updatedCard;
    const hardCard = this.gradeCard(card, ReviewRating.REVIEW_RATING_HARD, now).updatedCard;
    const goodCard = this.gradeCard(card, ReviewRating.REVIEW_RATING_GOOD, now).updatedCard;
    const easyCard = this.gradeCard(card, ReviewRating.REVIEW_RATING_EASY, now).updatedCard;

    return {
      [ReviewRating.REVIEW_RATING_UNSPECIFIED]: '',
      [ReviewRating.REVIEW_RATING_AGAIN]: this.formatIntervalDays(againCard.intervalDays),
      [ReviewRating.REVIEW_RATING_HARD]: this.formatIntervalDays(hardCard.intervalDays),
      [ReviewRating.REVIEW_RATING_GOOD]: this.formatIntervalDays(goodCard.intervalDays),
      [ReviewRating.REVIEW_RATING_EASY]: this.formatIntervalDays(easyCard.intervalDays),
    };
  }

  /**
   * Grades a flashcard using Anki SM-2 / FSRS-inspired transitions and returns
   * both the updated Flashcard and a corresponding ReviewLog entry.
   */
  gradeCard(
    card: Flashcard,
    rating: ReviewRating,
    now: Date = new Date()
  ): { updatedCard: Flashcard; reviewLog: ReviewLog } {
    const isoNow = now.toISOString();
    const previousState = card.state;
    const previousIntervalDays = card.intervalDays;

    let newState = card.state;
    let easeFactor = card.easeFactor || INITIAL_EASE_FACTOR;
    let intervalDays = card.intervalDays;
    let repetitions = card.repetitions;
    let learningStep = card.learningStep;
    let lapses = card.lapses;

    const isNewOrLearning =
      card.state === CardState.CARD_STATE_NEW ||
      card.state === CardState.CARD_STATE_LEARNING ||
      card.state === CardState.CARD_STATE_RELEARNING ||
      card.state === CardState.CARD_STATE_UNSPECIFIED;

    if (rating === ReviewRating.REVIEW_RATING_AGAIN) {
      // Reset / lapse to <10m learning step
      intervalDays = TEN_MINUTES_DAYS;
      learningStep = 0;
      repetitions = 0;
      if (card.state === CardState.CARD_STATE_REVIEW) {
        newState = CardState.CARD_STATE_RELEARNING;
        lapses += 1;
        easeFactor = Math.max(MIN_EASE_FACTOR, Number((easeFactor - 0.2).toFixed(2)));
      } else {
        newState = CardState.CARD_STATE_LEARNING;
      }
    } else if (rating === ReviewRating.REVIEW_RATING_HARD) {
      easeFactor = Math.max(MIN_EASE_FACTOR, Number((easeFactor - 0.15).toFixed(2)));
      if (isNewOrLearning) {
        newState = CardState.CARD_STATE_LEARNING;
        intervalDays = learningStep === 0 ? 1 : Math.max(1, Number(( Math.max(1, previousIntervalDays) * 1.2 ).toFixed(2)));
      } else {
        newState = CardState.CARD_STATE_REVIEW;
        const baseInterval = Math.max(1, previousIntervalDays);
        intervalDays = Math.max(baseInterval + 1, Math.round(baseInterval * 1.2));
        repetitions += 1;
      }
    } else if (rating === ReviewRating.REVIEW_RATING_GOOD) {
      if (isNewOrLearning) {
        if (learningStep === 0 && card.state === CardState.CARD_STATE_NEW) {
          // First Good on a New card -> 1 day learning/review graduation
          learningStep = 1;
          newState = CardState.CARD_STATE_LEARNING;
          intervalDays = 1;
          repetitions = 1;
        } else {
          // Graduate to Review state
          learningStep += 1;
          newState = CardState.CARD_STATE_REVIEW;
          intervalDays = Math.max(3, Math.round(Math.max(1, previousIntervalDays) * easeFactor));
          repetitions += 1;
        }
      } else {
        newState = CardState.CARD_STATE_REVIEW;
        const baseInterval = Math.max(1, previousIntervalDays);
        intervalDays = Math.max(baseInterval + 1, Math.round(baseInterval * easeFactor));
        repetitions += 1;
      }
    } else if (rating === ReviewRating.REVIEW_RATING_EASY) {
      easeFactor = Number((easeFactor + 0.15).toFixed(2));
      newState = CardState.CARD_STATE_REVIEW;
      learningStep += 1;
      repetitions += 1;

      if (isNewOrLearning) {
        const baseDays = previousIntervalDays >= 1 ? previousIntervalDays : 2.15;
        intervalDays = Math.max(4, Math.round(baseDays * easeFactor * 1.3));
      } else {
        const baseInterval = Math.max(1, previousIntervalDays);
        intervalDays = Math.max(baseInterval + 2, Math.round(baseInterval * easeFactor * 1.3));
      }
    }

    const dueTimeMs = now.getTime() + Math.round(intervalDays * DAY_MS);
    const dueAt = new Date(dueTimeMs).toISOString();

    const updatedCard: Flashcard = {
      ...card,
      state: newState,
      easeFactor,
      intervalDays,
      repetitions,
      learningStep,
      dueAt,
      lastReviewedAt: isoNow,
      lapses,
      updatedAt: isoNow,
    };

    const reviewLog: ReviewLog = {
      id: this.generateId('rev'),
      cardId: card.id,
      passageId: card.passageId,
      rating,
      previousState,
      newState,
      previousIntervalDays,
      newIntervalDays: intervalDays,
      easeFactor,
      reviewedAt: isoNow,
    };

    return { updatedCard, reviewLog };
  }

  /**
   * Returns true if the card is NEW or its dueAt timestamp is at or before `now`.
   */
  isDue(card: Flashcard, now: Date = new Date()): boolean {
    if (card.state === CardState.CARD_STATE_NEW) {
      return true;
    }
    if (!card.dueAt) {
      return true;
    }
    const dueMs = new Date(card.dueAt).getTime();
    if (isNaN(dueMs)) {
      return true;
    }
    return dueMs <= now.getTime();
  }

  formatIntervalDays(intervalDays: number): string {
    if (intervalDays <= 0.01) {
      return '<10m';
    }
    if (intervalDays < 1) {
      const minutes = Math.round(intervalDays * 24 * 60);
      if (minutes < 60) {
        return `${Math.max(1, minutes)}m`;
      }
      const hours = Math.round(minutes / 60);
      return `${hours}h`;
    }
    const roundedDays = Math.round(intervalDays);
    if (roundedDays < 30) {
      return `${roundedDays}d`;
    }
    if (roundedDays < 365) {
      const months = Number((roundedDays / 30).toFixed(1));
      return `${months}mo`;
    }
    const years = Number((roundedDays / 365).toFixed(1));
    return `${years}y`;
  }

  private generateId(prefix: string): string {
    const rand = Math.random().toString(36).substring(2, 10);
    return `${prefix}_${Date.now().toString(36)}_${rand}`;
  }
}
