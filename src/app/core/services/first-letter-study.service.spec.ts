import { Passage } from '../proto/bible_memory.pb';
import { FirstLetterStudyService } from './first-letter-study.service';

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

function runFirstLetterStudyTests(): void {
  const service = new FirstLetterStudyService();

  const crossChapPassage: Passage = {
    id: 'psg_test_cross',
    reference: 'Romans 8:39-9:1',
    createdAt: '2026-11-09T12:00:00.000Z',
    updatedAt: '2026-11-09T12:00:00.000Z',
    verses: [
      {
        chapterNumber: 8,
        verseNumber: 39,
        text: 'nor height nor depth,',
      },
      {
        chapterNumber: 9,
        verseNumber: 1,
        text: 'I am speaking truth.',
      },
    ],
  };

  service.loadPassage(crossChapPassage);
  service.enterStudyMode();

  assertEqual(service.isStudyModeActive(), true, 'Study mode active after enterStudyMode');
  assertEqual(service.totalVersesCount(), 2, 'Total verses count is 2');

  // Initial visible verses: only first verse is visible and active with 0 revealed words
  let visible = service.visibleVerses();
  assertEqual(visible.length, 1, 'Initially 1 visible verse');
  assertEqual(visible[0].verseLabel, '8:39', 'Multi-chapter verseLabel formats as 8:39');
  assertEqual(visible[0].revealedWordCount, 0, 'Initially 0 words revealed');
  assertEqual(visible[0].words[3].firstLetterText, 'd____,', 'Preserves trailing comma in firstLetterText');
  assertEqual(visible[0].words[3].firstLetterOnly, 'd,', 'Preserves trailing comma in firstLetterOnly');

  // +1w (revealOneWord) reveals 1 word in active verse
  service.revealOneWord();
  visible = service.visibleVerses();
  assertEqual(visible[0].revealedWordCount, 1, 'After +1w, 1 word is revealed');
  assertEqual(visible[0].words[0].isRevealed, true, 'First word is revealed');
  assertEqual(visible[0].words[1].isRevealed, false, 'Second word is still masked');

  // +1v (revealOneVerse) completes verse 8:39 and automatically surfaces first letters of 9:1
  service.revealOneVerse();
  visible = service.visibleVerses();
  assertEqual(visible.length, 2, 'After +1v, second verse is now visible');
  assertEqual(visible[0].status, 'completed', 'First verse status is completed');
  assertEqual(visible[1].verseLabel, '9:1', 'Second verse label is 9:1');
  assertEqual(visible[1].status, 'active', 'Second verse status is active');
  assertEqual(visible[1].revealedWordCount, 0, 'Second verse starts with 0 revealed words (first-letter cues)');

  // +1v on the final verse completes the entire passage
  service.revealOneVerse();
  assertTrue(service.allVersesCompleted(), 'All verses completed after final +1v');

  console.log('✓ first-letter-study.service.spec.ts: All first-letter study, +1w, +1v, and multi-chapter label assertions passed.');
}

runFirstLetterStudyTests();
