import { isMultiChapterPassage } from '../proto/bible_memory.pb';
import { PassageParserService } from './passage-parser.service';

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

function runPassageParserTests(): void {
  const parser = new PassageParserService();

  // 1. Single-chapter passage with superscript digits and footnotes
  const rawEsv = `Romans 8:1-2 (ESV)
¹There is therefore now no condemnation[a] for those who are in Christ Jesus. ²For the law of the Spirit of life (A) has set you free in Christ Jesus from the law of sin and death.`;

  const parsedRom = parser.parseRawInput(rawEsv);
  assertEqual(parsedRom.reference, 'Romans 8:1-2', 'Strips (ESV) suffix from reference');
  assertEqual(parsedRom.verses.length, 2, 'Extracts 2 verses from superscript markers');
  assertEqual(parsedRom.verses[0].verseNumber, 1, 'First verse number is 1');
  assertEqual(parsedRom.verses[0].chapterNumber, 8, 'First verse chapterNumber is 8');
  assertTrue(!parsedRom.verses[0].text.includes('[a]'), 'Strips [a] footnote marker');
  assertTrue(!parsedRom.verses[1].text.includes('(A)'), 'Strips (A) cross-reference marker');

  // 2. Non-verse-1 start (e.g. Philippians 4:6-7)
  const rawPhil = `[6] do not be anxious about anything, but in everything by prayer and supplication with thanksgiving let your requests be made known to God.
[7] And the peace of God, which surpasses all understanding, will guard your hearts and your minds in Christ Jesus.`;

  const parsedPhil = parser.parseRawInput(rawPhil, 'Philippians 4:6-7');
  assertEqual(parsedPhil.reference, 'Philippians 4:6-7', 'Preserves explicit reference');
  assertEqual(parsedPhil.verses.length, 2, 'Extracts 2 verses for Philippians 4:6-7');
  assertEqual(parsedPhil.verses[0].verseNumber, 6, 'Starts at verse 6');
  assertEqual(parsedPhil.verses[1].verseNumber, 7, 'Second verse is 7');

  // 3. Cross-chapter passage (Romans 8:38-9:2) with [8:38] and chapter rollover
  const rawCross = `[8:38] For I am sure that neither death nor life, nor angels nor rulers,
[8:39] nor height nor depth, nor anything else in all creation,
[9:1] I am speaking the truth in Christ—I am not lying;
[9:2] that I have great sorrow and unceasing anguish in my heart.`;

  const parsedCross = parser.parseRawInput(rawCross, 'Romans 8:38-9:2');
  assertEqual(parsedCross.verses.length, 4, 'Extracts all 4 cross-chapter verses');
  assertTrue(isMultiChapterPassage(parsedCross.verses), 'Detects multi-chapter passage');
  assertEqual(parsedCross.verses[0].chapterNumber, 8, 'Verse 38 is in chapter 8');
  assertEqual(parsedCross.verses[0].verseNumber, 38, 'Verse 38 number');
  assertEqual(parsedCross.verses[2].chapterNumber, 9, 'Verse 1 is in chapter 9');
  assertEqual(parsedCross.verses[2].verseNumber, 1, 'Verse 1 number in chapter 9');

  // 4. First-letter word masking
  const masked = parser.formatFirstLetters('Therefore, there is now', 1);
  assertEqual(masked.words.length, 4, 'Tokenizes 4 words');
  assertEqual(masked.words[0].revealed, true, 'Word 0 is revealed');
  assertEqual(masked.words[0].masked, 'T________,', 'Preserves trailing comma in masked form');
  assertEqual(masked.words[1].revealed, false, 'Word 1 is not revealed');

  console.log('✓ passage-parser.service.spec.ts: All single-chapter, non-verse-1, and cross-chapter parser assertions passed.');
}

runPassageParserTests();
