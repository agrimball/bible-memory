import { CardState, ReviewRating } from '../proto/bible_memory.pb';
import { SrsService } from './srs.service';

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertTrue(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`${message}: expected true, got false`);
  }
}

function runSrsServiceTests(): void {
  const srs = new SrsService();
  const baseNow = new Date('2026-11-09T12:00:00.000Z');

  // 1. Initial flashcard creation
  const card0 = srs.createInitialFlashcard('psg_1', baseNow);
  assertEqual(card0.state, CardState.CARD_STATE_NEW, 'Initial card state is NEW');
  assertEqual(card0.easeFactor, 2.5, 'Initial ease factor is 2.5');
  assertEqual(card0.intervalDays, 0, 'Initial intervalDays is 0');
  assertTrue(srs.isDue(card0, baseNow), 'Initial NEW card is due');

  // 2. Interval previews on a NEW card
  const previews = srs.getIntervalPreviews(card0, baseNow);
  assertEqual(previews[ReviewRating.REVIEW_RATING_AGAIN], '<10m', 'Preview AGAIN is <10m');
  assertEqual(previews[ReviewRating.REVIEW_RATING_GOOD], '1d', 'Preview GOOD on NEW is 1d');
  assertTrue(previews[ReviewRating.REVIEW_RATING_EASY].endsWith('d'), 'Preview EASY is in days');

  // 3. First GOOD transitions NEW -> LEARNING (1d)
  const step1 = srs.gradeCard(card0, ReviewRating.REVIEW_RATING_GOOD, baseNow);
  assertEqual(step1.updatedCard.state, CardState.CARD_STATE_LEARNING, 'First GOOD enters LEARNING');
  assertEqual(step1.updatedCard.intervalDays, 1, 'First GOOD sets 1d interval');
  assertEqual(step1.reviewLog.previousState, CardState.CARD_STATE_NEW, 'ReviewLog records previousState');

  // 4. Second GOOD graduates LEARNING -> REVIEW
  const nextDay = new Date(baseNow.getTime() + 24 * 60 * 60 * 1000);
  assertTrue(srs.isDue(step1.updatedCard, nextDay), 'Card is due after 1 day');
  const step2 = srs.gradeCard(step1.updatedCard, ReviewRating.REVIEW_RATING_GOOD, nextDay);
  assertEqual(step2.updatedCard.state, CardState.CARD_STATE_REVIEW, 'Second GOOD graduates to REVIEW');
  assertTrue(step2.updatedCard.intervalDays >= 3, 'Graduated REVIEW interval is >= 3 days');

  // 5. EASY increases easeFactor and interval
  const step3 = srs.gradeCard(step2.updatedCard, ReviewRating.REVIEW_RATING_EASY, nextDay);
  assertTrue(step3.updatedCard.easeFactor > step2.updatedCard.easeFactor, 'EASY increases easeFactor');
  assertTrue(step3.updatedCard.intervalDays > step2.updatedCard.intervalDays, 'EASY increases intervalDays');

  // 6. AGAIN on a REVIEW card lapses to RELEARNING (<10m) and increments lapses
  const lapsed = srs.gradeCard(step3.updatedCard, ReviewRating.REVIEW_RATING_AGAIN, nextDay);
  assertEqual(lapsed.updatedCard.state, CardState.CARD_STATE_RELEARNING, 'AGAIN on REVIEW transitions to RELEARNING');
  assertEqual(lapsed.updatedCard.lapses, 1, 'AGAIN increments lapses');
  assertTrue(lapsed.updatedCard.intervalDays < 0.01, 'AGAIN resets interval to <10m');

  console.log('✓ srs.service.spec.ts: All SM-2 scheduling and interval assertions passed.');
}

runSrsServiceTests();
