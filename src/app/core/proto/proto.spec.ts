import {
  CardState,
  estimateRecitationTime,
  formatVerseBadge,
  formatVerseRange,
  isMultiChapterPassage,
  ProtoJsonCodec,
  ReviewRating,
  UserDataBundle,
  Verse,
  parsePassageBounds,
} from './bible_memory.pb';

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

function runProtoTests(): void {
  // 1. Test protoc-generated UserDataBundle binary encode/decode & JSON round-trip
  const sampleBundle: UserDataBundle = {
    schemaVersion: 1,
    exportedAt: '2026-11-09T20:00:00.000Z',
    passages: [
      {
        id: 'psg_rom_8_38_9_2',
        reference: 'Romans 8:38-9:2',
        label: 'Nothing Can Separate Us',
        createdAt: '2026-11-09T20:00:00.000Z',
        updatedAt: '2026-11-09T20:00:00.000Z',
        verses: [
          { chapterNumber: 8, verseNumber: 38, text: 'For I am sure that neither death nor life,' },
          { chapterNumber: 8, verseNumber: 39, text: 'nor height nor depth,' },
          { chapterNumber: 9, verseNumber: 1, text: 'I am speaking the truth in Christ—' },
          { chapterNumber: 9, verseNumber: 2, text: 'that I have great sorrow and unceasing anguish in my heart.' },
        ],
      },
    ],
    flashcards: [
      {
        id: 'card_repair_1',
        passageId: 'psg_rom_8_38_9_2',
        state: CardState.CARD_STATE_LEARNING,
        easeFactor: 2.5,
        intervalDays: 1,
        repetitions: 1,
        learningStep: 1,
        dueAt: '2026-11-09T20:00:00.000Z',
        lastReviewedAt: '2026-11-09T19:00:00.000Z',
        lapses: 0,
        createdAt: '2026-11-09T19:00:00.000Z',
        updatedAt: '2026-11-09T19:00:00.000Z',
        isRepairCard: true,
        repairVerseNumber: 1,
        repairChapterNumber: 9,
        repairEndVerseNumber: 2,
        repairEndChapterNumber: 9,
        repairStreak: 2,
        repairTargetStreak: 3,
        parentCardId: 'card_main_1',
        isStitchedPassageCard: true,
        stitchedPassageIds: ['psg_chunk_1', 'psg_chunk_2'],
      },
    ],
    reviewLogs: [
      {
        id: 'rev_1',
        cardId: 'card_repair_1',
        passageId: 'psg_rom_8_38_9_2',
        rating: ReviewRating.REVIEW_RATING_GOOD,
        previousState: CardState.CARD_STATE_LEARNING,
        newState: CardState.CARD_STATE_LEARNING,
        previousIntervalDays: 0,
        newIntervalDays: 1,
        easeFactor: 2.5,
        reviewedAt: '2026-11-09T19:00:00.000Z',
      },
    ],
    suppressedSeamKeys: ['proverbs:3:5->3:6', 'psalm:23:6->24:1'],
    enabledSeamKeys: ['psalm:23:6->24:1'],
  };

  // Binary protobuf wire encode & decode from protoc-generated UserDataBundle
  const wireBytes = UserDataBundle.encode(sampleBundle).finish();
  assertTrue(wireBytes.byteLength > 0, 'protoc binary wire encoding produces non-empty bytes');
  const decodedFromWire = UserDataBundle.decode(wireBytes);
  assertEqual(decodedFromWire.passages[0].reference, 'Romans 8:38-9:2', 'Wire decoded reference');
  assertEqual(decodedFromWire.passages[0].verses[2].chapterNumber, 9, 'Wire decoded chapterNumber');
  assertEqual(decodedFromWire.passages[0].verses[2].verseNumber, 1, 'Wire decoded verseNumber');
  assertEqual(decodedFromWire.flashcards[0].repairChapterNumber, 9, 'Wire decoded repairChapterNumber');
  assertEqual(decodedFromWire.flashcards[0].repairEndVerseNumber, 2, 'Wire decoded repairEndVerseNumber');
  assertEqual(decodedFromWire.flashcards[0].repairEndChapterNumber, 9, 'Wire decoded repairEndChapterNumber');
  assertEqual(decodedFromWire.suppressedSeamKeys?.length, 2, 'Wire decoded suppressedSeamKeys length');
  assertEqual(decodedFromWire.enabledSeamKeys?.[0], 'psalm:23:6->24:1', 'Wire decoded enabledSeamKeys');

  // ProtoJsonCodec serializeBundle & deserializeBundle round-trip
  const jsonStr = ProtoJsonCodec.serializeBundle(sampleBundle, true);
  const restored = ProtoJsonCodec.deserializeBundle(jsonStr);
  assertEqual(restored.passages.length, 1, 'ProtoJsonCodec passage count');
  assertEqual(restored.passages[0].verses.length, 4, 'ProtoJsonCodec verse count');
  assertEqual(restored.flashcards[0].state, CardState.CARD_STATE_LEARNING, 'ProtoJsonCodec card state');
  assertEqual(restored.flashcards[0].isRepairCard, true, 'ProtoJsonCodec isRepairCard');
  assertEqual(restored.flashcards[0].repairChapterNumber, 9, 'ProtoJsonCodec repairChapterNumber');
  assertEqual(restored.flashcards[0].repairEndVerseNumber, 2, 'ProtoJsonCodec repairEndVerseNumber');
  assertEqual(restored.flashcards[0].repairEndChapterNumber, 9, 'ProtoJsonCodec repairEndChapterNumber');
  assertEqual(restored.reviewLogs[0].rating, ReviewRating.REVIEW_RATING_GOOD, 'ProtoJsonCodec rating');
  assertEqual(restored.suppressedSeamKeys?.length, 2, 'ProtoJsonCodec suppressedSeamKeys length');
  assertEqual(restored.enabledSeamKeys?.[0], 'psalm:23:6->24:1', 'ProtoJsonCodec enabledSeamKeys');

  const snakeCaseRestored = ProtoJsonCodec.deserializeBundle(
    JSON.stringify({
      schema_version: 1,
      exported_at: '2026-11-09T20:00:00.000Z',
      passages: [],
      flashcards: [],
      review_logs: [],
      suppressed_seam_keys: ['romans:8:36->8:37', 'romans:8:36->8:37'],
      enabled_seam_keys: ['psalm:1:6->2:1'],
    })
  );
  assertEqual(snakeCaseRestored.suppressedSeamKeys?.length, 1, 'Snake case suppressed_seam_keys deduped');
  assertEqual(snakeCaseRestored.enabledSeamKeys?.[0], 'psalm:1:6->2:1', 'Snake case enabled_seam_keys');

  const judeBounds = parsePassageBounds({
    id: 'psg_jude',
    reference: 'Jude 24-25',
    verses: [
      { verseNumber: 24, text: 'Now to him who is able to keep you from stumbling' },
      { verseNumber: 25, text: 'to the only God, our Savior, through Jesus Christ our Lord' },
    ],
    createdAt: '',
    updatedAt: '',
  });
  assertEqual(judeBounds?.startChapter, 1, 'Single-chapter book without colon defaults chapter to 1');
  assertEqual(judeBounds?.startVerse, 24, 'Single-chapter book startVerse preserved');

  // 2. Test cross-chapter helpers
  const singleChapVerses: Verse[] = [
    { chapterNumber: 8, verseNumber: 28, text: 'And we know...' },
    { chapterNumber: 8, verseNumber: 29, text: 'For those whom he foreknew...' },
  ];
  const multiChapVerses = sampleBundle.passages[0].verses;

  assertEqual(isMultiChapterPassage(singleChapVerses), false, 'Single chapter detection');
  assertEqual(isMultiChapterPassage(multiChapVerses), true, 'Multi chapter detection');

  assertEqual(formatVerseBadge(singleChapVerses[0], false), 'v. 28', 'Single chapter verse badge');
  assertEqual(formatVerseBadge(multiChapVerses[0], true), '8:38', 'Multi chapter verse badge 8:38');
  assertEqual(formatVerseBadge(multiChapVerses[2], true), '9:1', 'Multi chapter verse badge 9:1');

  assertEqual(
    formatVerseRange(singleChapVerses[0], singleChapVerses[1], false),
    'v. 28–29',
    'Single chapter verse range'
  );
  assertEqual(
    formatVerseRange(multiChapVerses[0], multiChapVerses[3], true),
    '8:38–9:2',
    'Cross-chapter verse range'
  );

  // 3. Test Passage.label, stitched fields, and estimateRecitationTime
  assertEqual(restored.passages[0].label, 'Nothing Can Separate Us', 'ProtoJsonCodec passage label');
  assertEqual(restored.flashcards[0].isStitchedPassageCard, true, 'ProtoJsonCodec isStitchedPassageCard');
  assertEqual(restored.flashcards[0].stitchedPassageIds?.length, 2, 'ProtoJsonCodec stitchedPassageIds length');

  const shortEst = estimateRecitationTime(multiChapVerses);
  assertTrue(shortEst.wordCount > 20, 'estimateRecitationTime counts words');
  assertEqual(shortEst.isLong, false, '4 short verses is not flagged as isLong');
  assertTrue(shortEst.label.endsWith('s'), 'Short passage recitation time formatted in seconds');

  const longVerses: Verse[] = Array.from({ length: 12 }, (_, idx) => ({
    verseNumber: idx + 1,
    text: 'The Lord is my shepherd I shall not want he makes me lie down in green pastures.',
  }));
  const longEst = estimateRecitationTime(longVerses);
  assertEqual(longEst.isLong, true, '12-verse passage is flagged as isLong');

  console.log('✓ proto.spec.ts: All protoc wire, ProtoJSON, and cross-chapter helper assertions passed.');
}

runProtoTests();
