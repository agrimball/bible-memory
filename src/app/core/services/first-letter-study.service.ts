import { Injectable, computed, signal } from '@angular/core';
import { Passage, Verse } from '../proto/bible_memory.pb';

export interface StudyWordToken {
  index: number;
  fullText: string;        // e.g. "condemnation,"
  firstLetterText: string; // e.g. "c___________," keeping first letter + underscores + punctuation
  firstLetterOnly: string; // e.g. "c," (first letter + leading/trailing punctuation)
  isRevealed: boolean;
}

export interface StudyVerseView {
  verseIndex: number;
  verseNumber: number;
  chapterNumber?: number;
  verseLabel: string;
  status: 'completed' | 'active' | 'upcoming';
  words: StudyWordToken[];
  revealedWordCount: number;
  totalWordCount: number;
}

export type FirstLetterVerseState = StudyVerseView;

interface ParsedVerseTokens {
  verseIndex: number;
  verseNumber: number;
  chapterNumber?: number;
  verseLabel: string;
  rawWords: Omit<StudyWordToken, 'isRevealed'>[];
}

@Injectable({ providedIn: 'root' })
export class FirstLetterStudyService {
  private readonly currentPassageSignal = signal<Passage | null>(null);

  readonly isStudyModeActive = signal<boolean>(false);
  readonly activeVerseIndex = signal<number>(0);
  readonly revealedWordsInActiveVerse = signal<number>(0);

  private readonly parsedVerses = computed<ParsedVerseTokens[]>(() => {
    const passage = this.currentPassageSignal();
    if (!passage || !Array.isArray(passage.verses)) {
      return [];
    }
    const versesWithChapter = passage.verses as Array<Verse & { chapterNumber?: number }>;
    const multiChapter =
      new Set(versesWithChapter.map((v) => v.chapterNumber).filter(Boolean)).size > 1;

    return versesWithChapter.map((verse, vIdx: number) => ({
      verseIndex: vIdx,
      verseNumber: verse.verseNumber,
      chapterNumber: verse.chapterNumber,
      verseLabel:
        multiChapter && verse.chapterNumber
          ? `${verse.chapterNumber}:${verse.verseNumber}`
          : `v. ${verse.verseNumber}`,
      rawWords: this.tokenizeVerseText(verse.text),
    }));
  });

  readonly totalVersesCount = computed<number>(() => this.parsedVerses().length);

  readonly allVersesCompleted = computed<boolean>(() => {
    const verses = this.parsedVerses();
    if (verses.length === 0) {
      return false;
    }
    const lastIdx = verses.length - 1;
    const activeIdx = this.activeVerseIndex();
    if (activeIdx > lastIdx) {
      return true;
    }
    if (activeIdx === lastIdx) {
      const lastVerseWordCount = verses[lastIdx].rawWords.length;
      return lastVerseWordCount > 0 && this.revealedWordsInActiveVerse() >= lastVerseWordCount;
    }
    return false;
  });

  readonly visibleVerses = computed<StudyVerseView[]>(() => {
    const verses = this.parsedVerses();
    if (verses.length === 0) {
      return [];
    }

    const activeIdx = Math.min(this.activeVerseIndex(), verses.length - 1);
    const revealedInActive = this.revealedWordsInActiveVerse();
    const completedAll = this.allVersesCompleted();

    const result: StudyVerseView[] = [];

    for (let i = 0; i <= activeIdx; i++) {
      const parsed = verses[i];
      const totalWordCount = parsed.rawWords.length;

      if (i < activeIdx || completedAll) {
        result.push({
          verseIndex: parsed.verseIndex,
          verseNumber: parsed.verseNumber,
          chapterNumber: parsed.chapterNumber,
          verseLabel: parsed.verseLabel,
          status: 'completed',
          words: parsed.rawWords.map((w) => ({
            ...w,
            isRevealed: true,
          })),
          revealedWordCount: totalWordCount,
          totalWordCount,
        });
      } else {
        const clampedRevealed = Math.min(revealedInActive, totalWordCount);
        result.push({
          verseIndex: parsed.verseIndex,
          verseNumber: parsed.verseNumber,
          chapterNumber: parsed.chapterNumber,
          verseLabel: parsed.verseLabel,
          status: 'active',
          words: parsed.rawWords.map((w, wordIdx) => ({
            ...w,
            isRevealed: wordIdx < clampedRevealed,
          })),
          revealedWordCount: clampedRevealed,
          totalWordCount,
        });
      }
    }

    return result;
  });

  loadPassage(passage: Passage): void {
    this.currentPassageSignal.set(passage);
    this.isStudyModeActive.set(false);
    this.activeVerseIndex.set(0);
    this.revealedWordsInActiveVerse.set(0);
  }

  enterStudyMode(): void {
    this.isStudyModeActive.set(true);
    this.activeVerseIndex.set(0);
    this.revealedWordsInActiveVerse.set(0);
  }

  exitStudyMode(): void {
    this.isStudyModeActive.set(false);
  }

  revealOneWord(): void {
    if (!this.isStudyModeActive()) {
      this.enterStudyMode();
    }

    const verses = this.parsedVerses();
    if (verses.length === 0 || this.allVersesCompleted()) {
      return;
    }

    const activeIdx = this.activeVerseIndex();
    const currentVerse = verses[activeIdx];
    if (!currentVerse) {
      return;
    }

    const nextWordCount = this.revealedWordsInActiveVerse() + 1;
    const totalWordsInCurrentVerse = currentVerse.rawWords.length;

    if (nextWordCount >= totalWordsInCurrentVerse) {
      if (activeIdx < verses.length - 1) {
        // Advance immediately to the next verse so completed verse + next verse's first letters show
        this.activeVerseIndex.set(activeIdx + 1);
        this.revealedWordsInActiveVerse.set(0);
      } else {
        // Last verse is now fully revealed
        this.revealedWordsInActiveVerse.set(totalWordsInCurrentVerse);
      }
    } else {
      this.revealedWordsInActiveVerse.set(nextWordCount);
    }
  }

  revealOneVerse(): void {
    if (!this.isStudyModeActive()) {
      this.enterStudyMode();
    }

    const verses = this.parsedVerses();
    if (verses.length === 0 || this.allVersesCompleted()) {
      return;
    }

    const activeIdx = this.activeVerseIndex();
    if (activeIdx < verses.length - 1) {
      // Complete current verse and immediately expose first letters of the next verse
      this.activeVerseIndex.set(activeIdx + 1);
      this.revealedWordsInActiveVerse.set(0);
    } else {
      // Already on the last verse: reveal all remaining words in the last verse
      const lastVerseWords = verses[activeIdx].rawWords.length;
      this.revealedWordsInActiveVerse.set(lastVerseWords);
    }
  }

  private tokenizeVerseText(text: string): Omit<StudyWordToken, 'isRevealed'>[] {
    const trimmed = (text ?? '').trim();
    if (!trimmed) {
      return [];
    }

    const rawParts = trimmed.split(/\s+/);
    return rawParts.map((word, index) => {
      const { firstLetterText, firstLetterOnly } = this.buildFirstLetterForms(word);
      return {
        index,
        fullText: word,
        firstLetterText,
        firstLetterOnly,
      };
    });
  }

  private buildFirstLetterForms(word: string): {
    firstLetterText: string;
    firstLetterOnly: string;
  } {
    // Match optional leading punctuation, first alphanumeric char, remaining core chars, and trailing punctuation
    const match = word.match(/^([^a-zA-Z0-9]*)([a-zA-Z0-9])(.*?)([^a-zA-Z0-9]*)$/);
    if (!match) {
      return {
        firstLetterText: word,
        firstLetterOnly: word,
      };
    }

    const [, leadingPunct, firstChar, middleRest, trailingPunct] = match;
    const maskedRest = middleRest.replace(/[a-zA-Z0-9]/g, '_');

    return {
      firstLetterText: `${leadingPunct}${firstChar}${maskedRest}${trailingPunct}`,
      firstLetterOnly: `${leadingPunct}${firstChar}${trailingPunct}`,
    };
  }
}
