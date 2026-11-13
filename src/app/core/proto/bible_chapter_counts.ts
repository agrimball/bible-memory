import type { Passage } from './generated/bible_memory';

/**
 * Canonical chapter verse-count lookup for all 66 books (1,189 chapters) of the Protestant Bible.
 * Used to verify whether a passage ends a chapter before combining or stitching across chapter boundaries.
 */
const PSALMS_VERSE_COUNTS = [
  6, 12, 8, 8, 12, 10, 17, 9, 20, 18, 7, 8, 6, 7, 5, 11, 15, 50, 14, 9, 13, 31, 6, 10, 22,
  12, 14, 9, 11, 12, 24, 11, 22, 22, 28, 12, 40, 22, 13, 17, 13, 11, 5, 26, 17, 11, 9, 14,
  20, 23, 19, 9, 6, 7, 23, 13, 11, 11, 17, 12, 8, 12, 11, 10, 13, 20, 7, 35, 36, 5, 24, 20,
  28, 23, 10, 12, 20, 72, 13, 19, 16, 8, 18, 12, 13, 17, 7, 18, 52, 17, 16, 15, 5, 23, 11,
  13, 12, 9, 9, 5, 8, 28, 22, 35, 45, 48, 43, 13, 31, 7, 10, 10, 9, 8, 18, 19, 2, 29, 176,
  7, 8, 9, 4, 8, 5, 6, 5, 6, 8, 8, 3, 18, 3, 3, 21, 26, 9, 8, 24, 13, 10, 7, 12, 15, 21, 10,
  20, 14, 9, 6,
];

const SONG_OF_SOLOMON_VERSE_COUNTS = [17, 17, 11, 16, 16, 13, 13, 14];

const REVELATION_VERSE_COUNTS = [
  20, 29, 22, 11, 14, 17, 17, 13, 21, 11, 19, 17, 18, 20, 8, 21, 18, 24, 21, 15, 27, 21,
];

export const BIBLE_CHAPTER_VERSE_COUNTS: Readonly<Record<string, readonly number[]>> = {
  // Old Testament (39 books)
  genesis: [
    31, 25, 24, 26, 32, 22, 24, 22, 29, 32, 32, 20, 18, 24, 21, 16, 27, 33, 38, 18, 34, 24, 20,
    67, 34, 35, 46, 22, 35, 43, 55, 32, 20, 31, 29, 43, 36, 30, 23, 23, 57, 38, 34, 34, 28, 34,
    31, 22, 33, 26,
  ],
  exodus: [
    22, 25, 22, 31, 23, 30, 25, 32, 35, 29, 10, 51, 22, 31, 27, 36, 16, 27, 25, 26, 36, 31, 33,
    18, 40, 37, 21, 43, 46, 38, 18, 35, 23, 35, 35, 38, 29, 31, 43, 38,
  ],
  leviticus: [
    17, 16, 17, 35, 19, 30, 38, 36, 24, 20, 47, 8, 59, 57, 33, 34, 16, 30, 37, 27, 24, 33, 44,
    23, 55, 46, 34,
  ],
  numbers: [
    54, 34, 51, 49, 31, 27, 89, 26, 23, 36, 35, 16, 33, 45, 41, 50, 13, 32, 22, 29, 35, 41, 30,
    25, 18, 65, 23, 31, 40, 16, 54, 42, 56, 29, 34, 13,
  ],
  deuteronomy: [
    46, 37, 29, 49, 33, 25, 26, 20, 29, 22, 32, 32, 18, 29, 23, 22, 20, 22, 21, 20, 23, 30, 25,
    22, 19, 19, 26, 68, 29, 20, 30, 52, 29, 12,
  ],
  joshua: [
    18, 24, 17, 24, 15, 27, 26, 35, 27, 43, 23, 24, 33, 15, 63, 10, 18, 28, 51, 9, 45, 34, 16,
    33,
  ],
  judges: [36, 23, 31, 24, 31, 40, 25, 35, 57, 18, 40, 15, 25, 20, 20, 31, 13, 31, 30, 48, 25],
  ruth: [22, 23, 18, 22],
  '1 samuel': [
    28, 36, 21, 22, 12, 21, 17, 22, 27, 27, 15, 25, 23, 52, 35, 23, 58, 30, 24, 42, 15, 23, 29,
    22, 44, 25, 12, 25, 11, 31, 13,
  ],
  '2 samuel': [
    27, 32, 39, 12, 25, 23, 29, 18, 13, 19, 27, 31, 39, 33, 37, 23, 29, 33, 43, 26, 22, 51, 39,
    25,
  ],
  '1 kings': [
    53, 46, 28, 34, 18, 38, 51, 66, 28, 29, 43, 33, 34, 31, 34, 34, 24, 46, 21, 43, 29, 53,
  ],
  '2 kings': [
    18, 25, 27, 44, 27, 33, 20, 29, 37, 36, 21, 21, 25, 29, 38, 20, 41, 37, 37, 21, 26, 20, 37,
    20, 30,
  ],
  '1 chronicles': [
    54, 55, 24, 43, 26, 81, 40, 40, 44, 14, 47, 40, 14, 17, 29, 43, 27, 17, 19, 8, 30, 19, 32,
    31, 31, 32, 34, 21, 30,
  ],
  '2 chronicles': [
    17, 18, 17, 22, 14, 42, 22, 18, 31, 19, 23, 16, 22, 15, 19, 14, 19, 34, 11, 37, 20, 12, 21,
    27, 28, 23, 9, 27, 36, 27, 21, 33, 25, 33, 27, 23,
  ],
  ezra: [11, 70, 13, 24, 17, 22, 28, 36, 15, 44],
  nehemiah: [11, 20, 32, 23, 19, 19, 73, 18, 38, 39, 36, 47, 31],
  esther: [22, 23, 15, 17, 14, 14, 10, 17, 32, 3],
  job: [
    22, 13, 26, 21, 27, 30, 21, 22, 35, 22, 20, 25, 28, 22, 35, 22, 16, 21, 29, 29, 34, 30, 17,
    25, 6, 14, 23, 28, 25, 31, 40, 22, 33, 37, 16, 33, 24, 41, 30, 24, 34, 17,
  ],
  psalm: PSALMS_VERSE_COUNTS,
  psalms: PSALMS_VERSE_COUNTS,
  proverbs: [
    33, 22, 35, 27, 23, 35, 27, 36, 18, 32, 31, 28, 25, 35, 33, 33, 28, 24, 29, 30, 31, 29, 35,
    34, 28, 28, 27, 28, 27, 33, 31,
  ],
  ecclesiastes: [18, 26, 22, 16, 20, 12, 29, 17, 18, 20, 10, 14],
  'song of solomon': SONG_OF_SOLOMON_VERSE_COUNTS,
  'song of songs': SONG_OF_SOLOMON_VERSE_COUNTS,
  isaiah: [
    31, 22, 26, 6, 30, 13, 25, 22, 21, 34, 16, 6, 22, 32, 9, 14, 14, 7, 25, 6, 17, 25, 18, 23,
    12, 21, 13, 29, 24, 33, 9, 20, 24, 17, 10, 22, 38, 22, 8, 31, 29, 25, 28, 28, 25, 13, 15,
    22, 26, 11, 23, 15, 12, 17, 13, 12, 21, 14, 21, 22, 11, 12, 19, 12, 25, 24,
  ],
  jeremiah: [
    19, 37, 25, 31, 31, 30, 34, 22, 26, 25, 23, 17, 27, 22, 21, 21, 27, 23, 15, 18, 14, 30, 40,
    10, 38, 24, 22, 17, 32, 24, 40, 44, 26, 22, 19, 32, 21, 28, 18, 16, 18, 22, 13, 30, 5, 28,
    7, 47, 39, 46, 64, 34,
  ],
  lamentations: [22, 22, 66, 22, 22],
  ezekiel: [
    28, 10, 27, 17, 17, 14, 27, 18, 11, 22, 25, 28, 23, 23, 8, 63, 24, 32, 14, 49, 32, 31, 49,
    27, 17, 21, 36, 26, 21, 26, 18, 32, 33, 31, 15, 38, 28, 23, 29, 49, 26, 20, 27, 31, 25, 24,
    23, 35,
  ],
  daniel: [21, 49, 30, 37, 31, 28, 28, 27, 27, 21, 45, 13],
  hosea: [11, 23, 5, 19, 15, 11, 16, 14, 17, 15, 12, 14, 16, 9],
  joel: [20, 32, 21],
  amos: [15, 16, 15, 13, 27, 14, 17, 14, 15],
  obadiah: [21],
  jonah: [17, 10, 10, 11],
  micah: [16, 13, 12, 13, 15, 16, 20],
  nahum: [15, 13, 19],
  habakkuk: [17, 20, 19],
  zephaniah: [18, 15, 20],
  haggai: [15, 23],
  zechariah: [21, 13, 10, 14, 11, 15, 14, 23, 17, 12, 17, 14, 9, 21],
  malachi: [14, 17, 18, 6],

  // New Testament (27 books)
  matthew: [
    25, 23, 17, 25, 48, 34, 29, 34, 38, 42, 30, 50, 58, 36, 39, 28, 27, 35, 30, 34, 46, 46, 39,
    51, 46, 75, 66, 20,
  ],
  mark: [45, 28, 35, 41, 43, 56, 37, 38, 50, 52, 33, 44, 37, 72, 47, 20],
  luke: [
    80, 52, 38, 44, 39, 49, 50, 56, 62, 42, 54, 59, 35, 35, 32, 31, 37, 43, 48, 47, 38, 71, 56,
    53,
  ],
  john: [51, 25, 36, 54, 47, 71, 53, 59, 41, 42, 57, 50, 38, 31, 27, 33, 26, 40, 42, 31, 25],
  acts: [
    26, 47, 26, 37, 42, 15, 60, 40, 43, 48, 30, 25, 52, 28, 41, 40, 34, 28, 41, 38, 40, 30, 35,
    27, 27, 32, 44, 31,
  ],
  romans: [32, 29, 31, 25, 21, 23, 25, 39, 33, 21, 36, 21, 14, 23, 33, 27],
  '1 corinthians': [31, 16, 23, 21, 13, 20, 40, 13, 27, 33, 34, 31, 13, 40, 58, 24],
  '2 corinthians': [24, 17, 18, 18, 21, 18, 16, 24, 15, 18, 33, 21, 14],
  galatians: [24, 21, 29, 31, 26, 18],
  ephesians: [23, 22, 21, 32, 33, 24],
  philippians: [30, 30, 21, 23],
  colossians: [29, 23, 25, 18],
  '1 thessalonians': [10, 20, 13, 18, 28],
  '2 thessalonians': [12, 17, 18],
  '1 timothy': [20, 15, 16, 16, 25, 21],
  '2 timothy': [18, 26, 17, 22],
  titus: [16, 15, 15],
  philemon: [25],
  hebrews: [14, 18, 19, 16, 14, 20, 28, 13, 28, 39, 40, 29, 25],
  james: [27, 26, 18, 17, 20],
  '1 peter': [25, 25, 22, 19, 14],
  '2 peter': [21, 22, 18],
  '1 john': [10, 29, 24, 21, 21],
  '2 john': [13],
  '3 john': [15],
  jude: [25],
  revelation: REVELATION_VERSE_COUNTS,
  revelations: REVELATION_VERSE_COUNTS,
};

export function normalizeBookKey(bookName: string): string {
  const raw = (bookName ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (raw === 'psalms') {
    return 'psalm';
  }
  if (raw === 'song of songs') {
    return 'song of solomon';
  }
  if (raw === 'revelations') {
    return 'revelation';
  }
  return raw;
}

/**
 * Returns the canonical number of verses in the given book and 1-indexed chapter,
 * or `undefined` if the book or chapter is not found in the 66-book table.
 */
export function getChapterVerseCount(bookName: string, chapter: number): number | undefined {
  if (!bookName || !chapter || chapter < 1) {
    return undefined;
  }
  const key = normalizeBookKey(bookName);
  const counts = BIBLE_CHAPTER_VERSE_COUNTS[key];
  if (!counts || chapter > counts.length) {
    return undefined;
  }
  return counts[chapter - 1];
}

/**
 * Returns `true` if `verse` reaches or exceeds the canonical final verse of `(bookName, chapter)`.
 */
export function isEndOfChapter(bookName: string, chapter: number, verse: number): boolean {
  const maxVerse = getChapterVerseCount(bookName, chapter);
  if (maxVerse === undefined) {
    return false;
  }
  return verse >= maxVerse;
}

export interface ParsedPassageBounds {
  passage: Passage;
  bookKey: string;
  bookDisplay: string;
  startChapter: number;
  startVerse: number;
  endChapter: number;
  endVerse: number;
}

export const SINGLE_CHAPTER_BOOKS = new Set([
  'obadiah',
  'philemon',
  '2 john',
  '3 john',
  'jude',
]);

export function parsePassageBounds(passage: Passage): ParsedPassageBounds | undefined {
  if (!passage || !passage.verses || passage.verses.length === 0) {
    return undefined;
  }
  const ref = (passage.reference ?? '').trim();
  const match = ref.match(
    /^((?:[1-3]\s+)?[A-Za-z]+(?:\s+of\s+[A-Za-z]+|\s+[A-Za-z]+)?)\s+(\d+)/i
  );
  if (!match) {
    return undefined;
  }

  const bookDisplay = match[1].trim();
  const bookKey = normalizeBookKey(bookDisplay);
  const firstNumber = parseInt(match[2], 10) || 1;
  const isSingleChapterNoColon = SINGLE_CHAPTER_BOOKS.has(bookKey) && !ref.includes(':');
  const refChapter = isSingleChapterNoColon ? 1 : firstNumber;

  const firstVerse = passage.verses[0];
  const lastVerse = passage.verses[passage.verses.length - 1];
  const startChapter =
    firstVerse.chapterNumber && firstVerse.chapterNumber > 0
      ? firstVerse.chapterNumber
      : refChapter;
  const startVerse = firstVerse.verseNumber;
  const endChapter =
    lastVerse.chapterNumber && lastVerse.chapterNumber > 0
      ? lastVerse.chapterNumber
      : startChapter;
  const endVerse = lastVerse.verseNumber;

  return {
    passage,
    bookKey,
    bookDisplay,
    startChapter,
    startVerse,
    endChapter,
    endVerse,
  };
}

/**
 * Checks whether 2+ passages form a strictly contiguous biblical span with no missing verses
 * or incomplete chapters between them.
 */
export function checkPassagesContiguity(passages: Passage[]): {
  contiguous: boolean;
  reason?: string;
} {
  if (!passages || passages.length < 2) {
    return { contiguous: false, reason: 'Select at least 2 passages to combine.' };
  }

  const bounds: ParsedPassageBounds[] = [];
  for (const p of passages) {
    const parsed = parsePassageBounds(p);
    if (!parsed) {
      return {
        contiguous: false,
        reason: `Could not parse book and chapter for "${p?.reference ?? 'Unknown'}".`,
      };
    }
    bounds.push(parsed);
  }

  const firstBookKey = bounds[0].bookKey;
  for (let i = 1; i < bounds.length; i++) {
    if (bounds[i].bookKey !== firstBookKey) {
      return {
        contiguous: false,
        reason: 'Cannot combine passages from different books.',
      };
    }
  }

  bounds.sort((a, b) => {
    if (a.startChapter !== b.startChapter) {
      return a.startChapter - b.startChapter;
    }
    if (a.startVerse !== b.startVerse) {
      return a.startVerse - b.startVerse;
    }
    if (a.endChapter !== b.endChapter) {
      return a.endChapter - b.endChapter;
    }
    return a.endVerse - b.endVerse;
  });

  for (let i = 0; i < bounds.length - 1; i++) {
    const prev = bounds[i];
    const next = bounds[i + 1];

    if (next.startChapter === prev.endChapter) {
      // Same chapter: next must start at prev.endVerse + 1 (or touch/overlap)
      if (next.startVerse > prev.endVerse + 1) {
        return {
          contiguous: false,
          reason: `Missing verses ${prev.endChapter}:${prev.endVerse + 1}–${next.startVerse - 1} between passages.`,
        };
      }
    } else if (next.startChapter === prev.endChapter + 1) {
      // Next chapter: prev must reach the end of prev.endChapter AND next must start at verse 1
      if (next.startVerse !== 1) {
        return {
          contiguous: false,
          reason: `${next.bookDisplay} ${next.startChapter} must start at verse 1 to combine across chapters.`,
        };
      }
      const maxVerse = getChapterVerseCount(prev.bookDisplay, prev.endChapter);
      if (maxVerse !== undefined && prev.endVerse < maxVerse) {
        return {
          contiguous: false,
          reason: `${prev.bookDisplay} ${prev.endChapter} ends at verse ${maxVerse} (missing v. ${prev.endVerse + 1}–${maxVerse}).`,
        };
      }
    } else if (next.startChapter > prev.endChapter + 1) {
      return {
        contiguous: false,
        reason: `Missing chapter(s) between ${prev.bookDisplay} ${prev.endChapter} and ${next.startChapter}.`,
      };
    }
  }

  return { contiguous: true };
}
