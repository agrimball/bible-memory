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

  // Test sentence boundary limiting (. ? !) within a multi-sentence verse
  const multiSentencePassage: Passage = {
    id: 'psg_test_sentences',
    reference: 'Romans 8:31',
    createdAt: '2026-11-09T12:00:00.000Z',
    updatedAt: '2026-11-09T12:00:00.000Z',
    verses: [
      {
        chapterNumber: 8,
        verseNumber: 31,
        text: 'What then shall we say? If God is for us, who can be against us! Nobody.',
      },
    ],
  };

  service.loadPassage(multiSentencePassage);
  service.enterStudyMode();

  // First sentence: "What then shall we say?" (5 words, ending with '?')
  visible = service.visibleVerses();
  assertEqual(visible[0].totalWordCount, 16, 'Total word count in verse is 16');
  assertEqual(
    visible[0].words.length,
    5,
    'Initially only shows first letters up to first sentence boundary (? at word 5)'
  );
  assertEqual(visible[0].words[4].firstLetterOnly, 's?', '5th word ends with question mark');

  // Reveal 4 words ("What then shall we"): still within first sentence
  for (let i = 0; i < 4; i++) {
    service.revealOneWord();
  }
  visible = service.visibleVerses();
  assertEqual(visible[0].words.length, 5, 'While on 5th word, still bounded at first sentence');
  assertEqual(visible[0].words[4].isRevealed, false, '5th word ("say?") still masked');

  // Reveal 5th word ("say?"): completes first sentence and immediately exposes second sentence up to '!' ("us!")
  service.revealOneWord();
  visible = service.visibleVerses();
  assertEqual(visible[0].revealedWordCount, 5, '5 words revealed');
  assertEqual(
    visible[0].words.length,
    15,
    'After completing first sentence, exposes second sentence up to ! boundary (word 15 "us!")'
  );
  assertEqual(visible[0].words[4].isRevealed, true, '"say?" is now revealed');
  assertEqual(visible[0].words[5].isRevealed, false, '"If" is masked in second sentence');
  assertEqual(visible[0].words[14].firstLetterOnly, 'u!', '15th word ends with exclamation mark');

  // Reveal words 6..15 to complete second sentence ("If God is for us, who can be against us!")
  for (let i = 0; i < 10; i++) {
    service.revealOneWord();
  }
  visible = service.visibleVerses();
  assertEqual(visible[0].revealedWordCount, 15, '15 words revealed');
  assertEqual(
    visible[0].words.length,
    16,
    'After completing second sentence, exposes third sentence up to . boundary (word 16 "Nobody.")'
  );
  assertEqual(visible[0].words[15].firstLetterOnly, 'N.', '16th word ends with period');

  console.log('✓ first-letter-study.service.spec.ts: All first-letter study, sentence-boundary limiting, +1w, +1v, and multi-chapter label assertions passed.');
}

runFirstLetterStudyTests();
