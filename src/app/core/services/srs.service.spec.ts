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

  // 7. Contiguous Stitched Passage Card & Seam Review Card generation + Custom Passage.label via StorageService
  require('@angular/compiler');
  const { createEnvironmentInjector, runInInjectionContext } = require('@angular/core') as typeof import('@angular/core');
  const { PassageParserService } = require('./passage-parser.service') as typeof import('./passage-parser.service');
  const { StorageService } = require('./storage.service') as typeof import('./storage.service');
  const envInjector = createEnvironmentInjector([SrsService, PassageParserService, StorageService], null as never);
  const storage = runInInjectionContext(envInjector, () => new StorageService());
  storage.clearAllData();

  const chunkA = storage.addPassage(
    'Romans 8:1-2',
    [
      { chapterNumber: 8, verseNumber: 1, text: 'There is therefore now no condemnation for those who are in Christ Jesus.' },
      { chapterNumber: 8, verseNumber: 2, text: 'For the law of the Spirit of life has set you free in Christ Jesus.' },
    ],
    'No Condemnation'
  );
  const chunkB = storage.addPassage(
    'Romans 8:3-4',
    [
      { chapterNumber: 8, verseNumber: 3, text: 'For God has done what the law, weakened by the flesh, could not do.' },
      { chapterNumber: 8, verseNumber: 4, text: 'in order that the righteous requirement of the law might be fulfilled in us.' },
    ],
    'Fulfilled in Us'
  );
  assertEqual(chunkA.passage.label, 'No Condemnation', 'addPassage sets custom Passage.label on chunk A');
  assertEqual(chunkB.passage.label, 'Fulfilled in Us', 'addPassage sets custom Passage.label on chunk B');

  // Advance both chunks to full verse step (2 of 2) so they are fully memorized contiguous passages
  storage.updateStitchedVerseStep(chunkA.card.id, 2);
  storage.updateStitchedVerseStep(chunkB.card.id, 2);

  const allPassages = storage.passages();
  const seamPassage = allPassages.find((p) => p.id.startsWith('psg_seam_'));
  const stitchedPassage = allPassages.find((p) => p.id.startsWith('psg_stitched_'));
  assertTrue(Boolean(seamPassage), 'syncContiguousStitchedCards generates a 2-verse Seam Review Passage');
  assertEqual(seamPassage?.reference, 'Romans 8:2-3', 'Seam passage reference is Romans 8:2-3');
  assertEqual(seamPassage?.label, 'Seam: No Condemnation → Fulfilled in Us', 'Seam passage label uses custom chunk labels');
  assertEqual(seamPassage?.verses.length, 2, 'Seam passage has 2 boundary verses');

  assertTrue(Boolean(stitchedPassage), 'syncContiguousStitchedCards generates a Full Contiguous Stitched Passage');
  assertEqual(stitchedPassage?.reference, 'Romans 8:1-4', 'Stitched passage reference is Romans 8:1-4');
  assertEqual(stitchedPassage?.label, 'Stitched: No Condemnation → Fulfilled in Us', 'Stitched passage label uses custom chunk labels');
  assertEqual(stitchedPassage?.verses.length, 4, 'Stitched passage combines all 4 verses');

  const stitchedCard = storage.flashcards().find((c) => c.passageId === stitchedPassage?.id);
  assertEqual(stitchedCard?.isStitchedPassageCard, true, 'Stitched card has isStitchedPassageCard = true');
  assertEqual(stitchedCard?.stitchedPassageIds?.length, 2, 'Stitched card tracks both source passage IDs');

  // 8. Test new deck management methods & .selahmemory connection status helpers
  const { DEFAULT_MEMORY_FILE_NAME } = require('./storage.service') as typeof import('./storage.service');
  assertEqual(DEFAULT_MEMORY_FILE_NAME, 'verses.selahmemory', 'Default memory file name is verses.selahmemory');
  assertEqual(storage.fileConnectionStatus(), 'local-only', 'Initial fileConnectionStatus is local-only');
  assertEqual(storage.isSavingToFile(), false, 'Initial isSavingToFile is false');
  assertEqual(storage.hasUnsavedFileChanges(), false, 'Initial hasUnsavedFileChanges is false');
  assertEqual(storage.lastFileSaveError(), null, 'Initial lastFileSaveError is null');

  // Verify disconnected-clean vs unsaved-disconnected state machine
  storage.activeFileName.set('verses.selahmemory');
  storage.activeFileStatus.set('needs-permission');
  storage.hasUnsavedFileChanges.set(false);
  assertEqual(
    storage.fileConnectionStatus(),
    'disconnected-clean',
    'Disconnected with no unsaved edits reports disconnected-clean'
  );
  storage.hasUnsavedFileChanges.set(true);
  assertEqual(
    storage.fileConnectionStatus(),
    'unsaved-disconnected',
    'Disconnected with unsaved edits reports unsaved-disconnected'
  );
  storage.activeFileStatus.set('saved');
  storage.hasUnsavedFileChanges.set(false);
  assertEqual(storage.fileConnectionStatus(), 'connected', 'Saved file reports connected');
  storage.disconnectDataFile();
  assertEqual(storage.fileConnectionStatus(), 'local-only', 'Disconnected file resets to local-only');

  // Test moveCardToNew / moveCardsToNew
  storage.moveCardToNew(chunkA.card.id);
  const resetCardA = storage.flashcards().find((c) => c.id === chunkA.card.id);
  assertEqual(resetCardA?.state, CardState.CARD_STATE_NEW, 'moveCardToNew resets state to CARD_STATE_NEW');
  assertEqual(resetCardA?.repetitions, 0, 'moveCardToNew resets repetitions to 0');
  assertEqual(resetCardA?.intervalDays, 0, 'moveCardToNew resets intervalDays to 0');
  assertEqual(resetCardA?.learningStep, 1, 'moveCardToNew resets learningStep to 1');

  // Test moveCardsToReviewDeck (knowEntirePassage = false and true)
  storage.moveCardsToReviewDeck([chunkA.card.id], false);
  const learningCardA = storage.flashcards().find((c) => c.id === chunkA.card.id);
  assertEqual(learningCardA?.state, CardState.CARD_STATE_LEARNING, 'moveCardsToReviewDeck(false) sets LEARNING');
  assertEqual(learningCardA?.learningStep, 1, 'moveCardsToReviewDeck(false) keeps learningStep = 1');

  storage.moveCardsToNew([chunkA.card.id, chunkB.card.id]);
  assertEqual(storage.queuedDeckItems().length, 2, 'moveCardsToNew moves both cards to NEW');

  storage.moveCardsToReviewDeck([chunkA.card.id], true);
  const reviewCardA = storage.flashcards().find((c) => c.id === chunkA.card.id);
  assertEqual(reviewCardA?.state, CardState.CARD_STATE_REVIEW, 'moveCardsToReviewDeck(true) sets REVIEW');
  assertEqual(reviewCardA?.learningStep, 2, 'moveCardsToReviewDeck(true) sets full verse count');

  // Test markEntirePassageKnown
  const knownItemB = storage.markEntirePassageKnown(chunkB.card.id);
  assertEqual(knownItemB?.card.state, CardState.CARD_STATE_REVIEW, 'markEntirePassageKnown sets REVIEW');
  assertEqual(knownItemB?.card.learningStep, 2, 'markEntirePassageKnown sets full verse count');
  assertTrue((knownItemB?.card.repetitions ?? 0) >= 1, 'markEntirePassageKnown sets repetitions >= 1');

  // Test deletePassages
  storage.deletePassages([chunkA.passage.id, chunkB.passage.id]);
  assertEqual(storage.passages().length, 0, 'deletePassages removes all specified passages');
  assertEqual(storage.flashcards().length, 0, 'deletePassages removes associated flashcards');

  // Test resetToDefaults / clearAllData resets to ZERO passages
  storage.addPassage('Psalm 117:1', [{ verseNumber: 1, text: 'Praise the LORD, all nations!' }]);
  storage.resetToDefaults();
  assertEqual(storage.passages().length, 0, 'resetToDefaults resets to 0 passages');
  assertEqual(storage.flashcards().length, 0, 'resetToDefaults resets to 0 flashcards');

  // 9. Test incremental chunking (carveOffPrefixAsNamedChunk), combinePassages, and appendVersesToPassage
  const sermon = storage.addPassage(
    'Matthew 5:1-5',
    [
      { chapterNumber: 5, verseNumber: 1, text: 'Seeing the crowds, he went up on the mountain,' },
      { chapterNumber: 5, verseNumber: 2, text: 'And he opened his mouth and taught them, saying:' },
      { chapterNumber: 5, verseNumber: 3, text: 'Blessed are the poor in spirit, for theirs is the kingdom of heaven.' },
      { chapterNumber: 5, verseNumber: 4, text: 'Blessed are those who mourn, for they shall be comforted.' },
      { chapterNumber: 5, verseNumber: 5, text: 'Blessed are the meek, for they shall inherit the earth.' },
    ],
    'Sermon on the Mount'
  );
  storage.updateStitchedVerseStep(sermon.card.id, 3);
  const carved = storage.carveOffPrefixAsNamedChunk(sermon.card.id, 3, 'Beatitudes Intro');
  assertTrue(Boolean(carved), 'carveOffPrefixAsNamedChunk succeeds for prefixVerseCount = 3');
  assertEqual(carved?.completedChunk.passage.reference, 'Matthew 5:1-3', 'Carved completed chunk reference');
  assertEqual(carved?.completedChunk.passage.label, 'Beatitudes Intro', 'Carved completed chunk label');
  assertEqual(carved?.completedChunk.card.state, CardState.CARD_STATE_REVIEW, 'Carved completed chunk state is REVIEW');
  assertEqual(carved?.completedChunk.card.learningStep, 3, 'Carved completed chunk learningStep is 3');
  assertEqual(carved?.remainingPassage.passage.reference, 'Matthew 5:4-5', 'Carved remaining passage reference');
  assertEqual(carved?.remainingPassage.card.state, CardState.CARD_STATE_LEARNING, 'Carved remaining passage state is LEARNING');
  assertEqual(carved?.remainingPassage.card.learningStep, 1, 'Carved remaining passage starts at learningStep 1');

  // Combine the two carved chunks back into one passage
  const combined = storage.combinePassages(
    [carved!.remainingPassage.passage.id, carved!.completedChunk.passage.id],
    'Combined Beatitudes'
  );
  assertTrue(Boolean(combined), 'combinePassages merges 2 passages in canonical order');
  assertEqual(combined?.passage.reference, 'Matthew 5:1-5', 'combinePassages computes combined reference');
  assertEqual(combined?.passage.label, 'Combined Beatitudes', 'combinePassages sets combined label');
  assertEqual(combined?.passage.verses.length, 5, 'combinePassages merges all 5 verses in order');
  assertEqual(combined?.card.learningStep, 4, 'combinePassages sets learningStep to sum of learned verses (3 + 1 = 4)');

  // Append verses to the existing passage while preserving learningStep
  const appended = storage.appendVersesToPassage(combined!.passage.id, [
    { chapterNumber: 5, verseNumber: 6, text: 'Blessed are those who hunger and thirst for righteousness,' },
    { chapterNumber: 5, verseNumber: 7, text: 'Blessed are the merciful, for they shall receive mercy.' },
  ]);
  assertTrue(Boolean(appended), 'appendVersesToPassage appends new verses');
  assertEqual(appended?.passage.reference, 'Matthew 5:1-7', 'appendVersesToPassage updates end verse in reference');
  assertEqual(appended?.passage.verses.length, 7, 'appendVersesToPassage has 7 total verses');
  assertEqual(appended?.card.learningStep, 4, 'appendVersesToPassage preserves existing learningStep (4)');

  // 10. Strict Contiguous-Only Combining & Canonical 1,189-Chapter Verse-Count Verification
  const { getChapterVerseCount, isEndOfChapter, checkPassagesContiguity } = require('../proto/bible_memory.pb') as typeof import('../proto/bible_memory.pb');
  assertEqual(getChapterVerseCount('Genesis', 1), 31, 'Genesis 1 has 31 verses');
  assertEqual(getChapterVerseCount('Psalm', 119), 176, 'Psalm 119 has 176 verses');
  assertEqual(getChapterVerseCount('Psalms', 23), 6, 'Psalms 23 alias has 6 verses');
  assertEqual(getChapterVerseCount('Romans', 7), 25, 'Romans 7 has 25 verses');
  assertEqual(getChapterVerseCount('Romans', 8), 39, 'Romans 8 has 39 verses');
  assertEqual(getChapterVerseCount('Revelation', 22), 21, 'Revelation 22 has 21 verses');
  assertEqual(isEndOfChapter('Romans', 7, 24), false, 'Romans 7:24 is not end of chapter');
  assertEqual(isEndOfChapter('Romans', 7, 25), true, 'Romans 7:25 is end of chapter');

  storage.clearAllData();

  // Case A: Non-contiguous same-chapter chunks (Romans 8:1-4 + Romans 8:35-36) -> rejected
  const rom8a = storage.addPassage('Romans 8:1-4', [
    { chapterNumber: 8, verseNumber: 1, text: 'There is therefore now no condemnation...' },
    { chapterNumber: 8, verseNumber: 2, text: 'For the law of the Spirit...' },
    { chapterNumber: 8, verseNumber: 3, text: 'For God has done...' },
    { chapterNumber: 8, verseNumber: 4, text: 'in order that the righteous requirement...' },
  ]);
  const rom8b = storage.addPassage('Romans 8:35-36', [
    { chapterNumber: 8, verseNumber: 35, text: 'Who shall separate us from the love of Christ?' },
    { chapterNumber: 8, verseNumber: 36, text: 'As it is written, For your sake we are being killed...' },
  ]);
  assertEqual(
    storage.canCombinePassages([rom8a.passage.id, rom8b.passage.id]).canCombine,
    false,
    'canCombinePassages rejects non-contiguous same-chapter chunks (Romans 8:1-4 + Romans 8:35-36)'
  );
  assertEqual(
    storage.combinePassages([rom8a.passage.id, rom8b.passage.id]),
    undefined,
    'combinePassages returns undefined for non-contiguous same-chapter chunks'
  );

  // Case B: Chunks from different books (John 1:1-5 + Romans 8:1-4) -> rejected
  const john1 = storage.addPassage('John 1:1-5', [
    { chapterNumber: 1, verseNumber: 1, text: 'In the beginning was the Word...' },
    { chapterNumber: 1, verseNumber: 2, text: 'He was in the beginning with God.' },
    { chapterNumber: 1, verseNumber: 3, text: 'All things were made through him...' },
    { chapterNumber: 1, verseNumber: 4, text: 'In him was life...' },
    { chapterNumber: 1, verseNumber: 5, text: 'The light shines in the darkness...' },
  ]);
  assertEqual(
    storage.canCombinePassages([john1.passage.id, rom8a.passage.id]).canCombine,
    false,
    'canCombinePassages rejects passages from different books'
  );
  assertEqual(
    storage.combinePassages([john1.passage.id, rom8a.passage.id]),
    undefined,
    'combinePassages returns undefined for passages from different books'
  );

  // Case C: Cross-chapter where first passage does NOT end the chapter (Romans 7:1-10 + Romans 8:1-4, Romans 7 has 25v) -> rejected
  const rom7Partial = storage.addPassage('Romans 7:1-10', [
    { chapterNumber: 7, verseNumber: 1, text: 'Or do you not know, brothers...' },
    { chapterNumber: 7, verseNumber: 10, text: 'The very commandment that promised life proved to be death to me.' },
  ]);
  const crossChapInvalid = checkPassagesContiguity([rom7Partial.passage, rom8a.passage]);
  assertEqual(crossChapInvalid.contiguous, false, 'Romans 7:1-10 + Romans 8:1-4 is not contiguous');
  assertTrue(
    Boolean(crossChapInvalid.reason?.includes('ends at verse 25')),
    'Reason explains Romans 7 ends at verse 25'
  );
  assertEqual(
    storage.combinePassages([rom7Partial.passage.id, rom8a.passage.id]),
    undefined,
    'combinePassages rejects incomplete chapter boundary (Romans 7:1-10 + Romans 8:1-4)'
  );

  // Case D: Cross-chapter where first passage DOES end the chapter (Romans 7:24-25 + Romans 8:1-4) -> succeeds!
  const rom7End = storage.addPassage('Romans 7:24-25', [
    { chapterNumber: 7, verseNumber: 24, text: 'Wretched man that I am! Who will deliver me from this body of death?' },
    { chapterNumber: 7, verseNumber: 25, text: 'Thanks be to God through Jesus Christ our Lord!' },
  ]);
  assertEqual(
    storage.canCombinePassages([rom7End.passage.id, rom8a.passage.id]).canCombine,
    true,
    'canCombinePassages accepts Romans 7:24-25 + Romans 8:1-4 across chapter boundary'
  );
  const combinedCrossChap = storage.combinePassages(
    [rom7End.passage.id, rom8a.passage.id],
    'Delivered into No Condemnation'
  );
  assertTrue(Boolean(combinedCrossChap), 'combinePassages succeeds for Romans 7:24-25 + Romans 8:1-4');
  assertEqual(
    combinedCrossChap?.passage.reference,
    'Romans 7:24-8:4',
    'Cross-chapter combined reference is Romans 7:24-8:4'
  );
  assertEqual(
    combinedCrossChap?.passage.verses.length,
    6,
    'Cross-chapter combined passage has 6 verses'
  );

  // 11. Test multi-boundary splitPassageAtBoundaries, undoLastSplit, and (Patch) reference formatting
  storage.clearAllData();
  const rom83539 = storage.addPassage(
    'Romans 8:35-39',
    [
      { chapterNumber: 8, verseNumber: 35, text: 'Who shall separate us from the love of Christ?' },
      { chapterNumber: 8, verseNumber: 36, text: 'As it is written, For your sake we are being killed all the day long;' },
      { chapterNumber: 8, verseNumber: 37, text: 'No, in all these things we are more than conquerors through him who loved us.' },
      { chapterNumber: 8, verseNumber: 38, text: 'For I am sure that neither death nor life, nor angels nor rulers,' },
      { chapterNumber: 8, verseNumber: 39, text: 'nor height nor depth, nor anything else in all creation, will be able to separate us.' },
    ],
    'More Than Conquerors'
  );
  storage.updateStitchedVerseStep(rom83539.card.id, 2);

  // Verify Patch card reference ends with (Patch)
  const patchItem = storage.createRepairCard(rom83539.passage.id, 35, 3, 8, 37, 8);
  assertTrue(Boolean(patchItem), 'createRepairCard creates a Patch card');
  assertEqual(
    patchItem?.passage.reference,
    'Romans 8:35-37 (Patch)',
    'Patch card reference is formatted with (Patch) suffix'
  );
  storage.deleteCard(patchItem!.card.id);

  // Split 5-verse passage at [1, 3] -> 3 segments: v.35-36 (0..1), v.37-38 (2..3), v.39 (4..4)
  const splitRes = storage.splitPassageAtBoundaries(rom83539.card.id, [1, 3]);
  assertTrue(Boolean(splitRes), 'splitPassageAtBoundaries([1, 3]) succeeds');
  assertEqual(splitRes?.segments.length, 3, 'Creates 3 segments');
  assertEqual(splitRes?.segments[0].passage.reference, 'Romans 8:35-36', 'Segment 0 reference');
  assertEqual(splitRes?.segments[0].card.state, CardState.CARD_STATE_REVIEW, 'Segment 0 is REVIEW');
  assertEqual(splitRes?.segments[0].card.learningStep, 2, 'Segment 0 learningStep is 2');
  assertEqual(splitRes?.segments[1].passage.reference, 'Romans 8:37-38', 'Segment 1 reference');
  assertEqual(splitRes?.segments[1].card.state, CardState.CARD_STATE_LEARNING, 'Segment 1 is LEARNING');
  assertEqual(splitRes?.activeNextItem.passage.reference, 'Romans 8:37-38', 'activeNextItem is Segment 1');
  assertEqual(splitRes?.segments[2].passage.reference, 'Romans 8:39', 'Segment 2 reference');
  assertEqual(splitRes?.segments[2].card.state, CardState.CARD_STATE_NEW, 'Segment 2 is NEW');
  assertEqual(Boolean(storage.lastSplitUndoState()), true, 'lastSplitUndoState is populated');

  // Undo the multi-boundary split -> recombines all 3 segments back into Romans 8:35-39
  const undone = storage.undoLastSplit();
  assertTrue(Boolean(undone), 'undoLastSplit recombines the split segments');
  assertEqual(undone?.passage.reference, 'Romans 8:35-39', 'undoLastSplit restores Romans 8:35-39');
  assertEqual(undone?.passage.label, 'More Than Conquerors', 'undoLastSplit restores original label');
  assertEqual(undone?.passage.verses.length, 5, 'undoLastSplit restores all 5 verses');
  assertEqual(storage.lastSplitUndoState(), null, 'undoLastSplit clears lastSplitUndoState');

  console.log('✓ srs.service.spec.ts: All SM-2 scheduling, interval, deck management, incremental chunking, contiguity, multi-split undo, and contiguous stitched/seam card assertions passed.');
}

runSrsServiceTests();
