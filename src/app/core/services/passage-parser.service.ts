import { Injectable } from '@angular/core';
import { Verse } from '../proto/bible_memory.pb';

export interface MaskedWord {
  full: string;
  masked: string;
  revealed: boolean;
  index: number;
}

const SUPERSCRIPT_MAP: Record<string, string> = {
  '⁰': '0',
  '¹': '1',
  '²': '2',
  '³': '3',
  '⁴': '4',
  '⁵': '5',
  '⁶': '6',
  '⁷': '7',
  '⁸': '8',
  '⁹': '9',
};

const REFERENCE_LINE_REGEX =
  /^(?:[1-3]\s+)?[A-Za-z]+(?:\s+of\s+[A-Za-z]+|\s+[A-Za-z]+)?\s+\d+(?::\d+(?:\s*[-–—]\s*\d+(?::\d+)?)?(?:\s*,\s*\d+(?::\d+)?(?:\s*[-–—]\s*\d+(?::\d+)?)?)*)?(?:\s*\(?[A-Z]{2,6}\)?)?$/;

@Injectable({ providedIn: 'root' })
export class PassageParserService {
  /**
   * Parses pasted Bible passage text (from BibleGateway, ESV, YouVersion, etc.)
   * into a clean reference and structured array of Verse objects (supporting single-chapter and cross-chapter passages).
   */
  parseRawInput(rawText: string, explicitReference?: string): { reference: string; verses: Verse[] } {
    const trimmedRaw = (rawText ?? '').replace(/\r\n/g, '\n').trim();
    if (!trimmedRaw) {
      return {
        reference: explicitReference?.trim() || 'Untitled Passage',
        verses: [],
      };
    }

    let lines = trimmedRaw
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    let detectedReference = explicitReference?.trim() ?? '';

    if (!detectedReference && lines.length > 1) {
      const firstLine = lines[0].replace(/^[-–—•\s]+/, '').trim();
      const lastLine = lines[lines.length - 1].replace(/^[-–—•\s]+/, '').trim();

      if (this.looksLikeReference(firstLine)) {
        detectedReference = this.cleanReferenceString(firstLine);
        lines = lines.slice(1);
      } else if (this.looksLikeReference(lastLine)) {
        detectedReference = this.cleanReferenceString(lastLine);
        lines = lines.slice(0, -1);
      }
    }

    const bodyText = lines.join('\n');
    const cleanedBody = this.cleanFootnotesAndSuperscripts(bodyText);
    const { startChapter, startVerse } = this.extractStartChapterAndVerse(detectedReference);

    const verses = this.extractVerses(cleanedBody, startVerse, startChapter);

    if (!detectedReference) {
      if (verses.length > 0) {
        const first = verses[0];
        const last = verses[verses.length - 1];
        if (first.chapterNumber && last.chapterNumber && first.chapterNumber !== last.chapterNumber) {
          detectedReference = `Passage (${first.chapterNumber}:${first.verseNumber}–${last.chapterNumber}:${last.verseNumber})`;
        } else {
          const firstNum = first.verseNumber;
          const lastNum = last.verseNumber;
          detectedReference =
            firstNum === lastNum ? `Passage (v. ${firstNum})` : `Passage (vv. ${firstNum}–${lastNum})`;
        }
      } else {
        detectedReference = 'Custom Passage';
      }
    }

    return {
      reference: detectedReference,
      verses,
    };
  }

  /**
   * Splits a verse into words and produces both full and first-letter masked forms,
   * preserving leading/trailing punctuation and keeping the first alphanumeric character visible.
   */
  formatFirstLetters(
    verseText: string,
    revealedWordCount: number
  ): { words: MaskedWord[] } {
    const tokens = (verseText ?? '')
      .trim()
      .split(/\s+/)
      .filter((t) => t.length > 0);

    const words: MaskedWord[] = tokens.map((token, index) => {
      const revealed = index < revealedWordCount;
      return {
        full: token,
        masked: this.maskSingleWord(token),
        revealed,
        index,
      };
    });

    return { words };
  }

  private maskSingleWord(word: string): string {
    const match = word.match(/^([^A-Za-z0-9\u00C0-\u024F]*)([A-Za-z0-9\u00C0-\u024F])(.*)$/);
    if (!match) {
      return word;
    }

    const leadingPunct = match[1];
    const firstChar = match[2];
    const rest = match[3];

    const maskedRest = rest.replace(/[A-Za-z0-9\u00C0-\u024F]/g, '_');
    return `${leadingPunct}${firstChar}${maskedRest}`;
  }

  private looksLikeReference(line: string): boolean {
    if (!line || line.length > 65) {
      return false;
    }
    return REFERENCE_LINE_REGEX.test(line);
  }

  private cleanReferenceString(ref: string): string {
    return ref
      .replace(/^[-–—•\s]+/, '')
      .replace(/\s*\([A-Z]{2,6}\)\s*$/, '')
      .replace(/\s+[A-Z]{2,6}$/, (match) => {
        const token = match.trim();
        const translations = new Set([
          'ESV',
          'NIV',
          'KJV',
          'NKJV',
          'NLT',
          'NASB',
          'CSB',
          'NRSV',
          'NRSVUE',
          'AMP',
          'MSG',
        ]);
        return translations.has(token) ? '' : match;
      })
      .replace(/\s+/g, ' ')
      .trim();
  }

  private extractStartChapterAndVerse(reference: string): {
    startChapter?: number;
    startVerse: number;
  } {
    if (!reference) {
      return { startVerse: 1 };
    }
    const chapVerseMatch = reference.match(/(\d+)\s*:\s*(\d+)/);
    if (chapVerseMatch) {
      const chap = parseInt(chapVerseMatch[1], 10);
      const verse = parseInt(chapVerseMatch[2], 10);
      return {
        startChapter: !isNaN(chap) && chap > 0 ? chap : undefined,
        startVerse: !isNaN(verse) && verse > 0 ? verse : 1,
      };
    }
    const chapOnlyMatch = reference.match(/\s(\d+)(?:\s|$)/);
    if (chapOnlyMatch) {
      const chap = parseInt(chapOnlyMatch[1], 10);
      return {
        startChapter: !isNaN(chap) && chap > 0 ? chap : undefined,
        startVerse: 1,
      };
    }
    return { startVerse: 1 };
  }

  private cleanFootnotesAndSuperscripts(text: string): string {
    let cleaned = text;

    // Strip letter footnote markers like [a], [b], (a), (b), (A), (B)
    cleaned = cleaned.replace(/\[[a-zA-Z]{1,2}\]/g, '');
    cleaned = cleaned.replace(/\([a-zA-Z]{1,2}\)/g, '');

    // Strip cross-reference symbols like †, *, ‡
    cleaned = cleaned.replace(/[†‡*]/g, '');

    // Convert sequences of Unicode superscript digits into bracketed verse markers `[12] `
    cleaned = cleaned.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]+/g, (supSeq) => {
      const normalDigits = supSeq
        .split('')
        .map((ch) => SUPERSCRIPT_MAP[ch] ?? ch)
        .join('');
      return ` [${normalDigits}] `;
    });

    return cleaned;
  }

  private extractVerses(
    cleanedBody: string,
    defaultStartVerse: number,
    defaultStartChapter?: number
  ): Verse[] {
    // Normalize bracketed or parenthesized chapter:verse markers like [8:38] or (9:1) first
    // and single verse markers like [1] or (1)
    const normalized = cleanedBody
      .replace(/\[(\d{1,3}):(\d{1,3})\]/g, ' __VERSE_MARKER_$1_$2__ ')
      .replace(/\((\d{1,3}):(\d{1,3})\)/g, ' __VERSE_MARKER_$1_$2__ ')
      .replace(/\[(\d{1,3})\]/g, ' __VERSE_MARKER_0_$1__ ')
      .replace(/\((\d{1,3})\)/g, ' __VERSE_MARKER_0_$1__ ');

    // Also match inline chapter:verse (e.g. `8:38 For I am sure... 9:1 I am speaking...`)
    const withInlineChapVerse = normalized.replace(
      /(?:^|\n|\s)(\d{1,3}):(\d{1,3})(?=\s+["'“‘(]*[A-Za-z])/g,
      (_fullMatch, chapStr, verseStr) => ` __VERSE_MARKER_${chapStr}_${verseStr}__ `
    );

    // Also match inline or line-start numbers like `1 There is therefore... 2 For the law...`
    const withInlineMarkers = withInlineChapVerse.replace(
      /(?:^|\n|\s)(?:(\d{1,3}))(?=\s+["'“‘(]*[A-Z])/g,
      (fullMatch, numStr) => {
        const num = parseInt(numStr, 10);
        if (num >= 1 && num <= 176) {
          return ` __VERSE_MARKER_0_${num}__ `;
        }
        return fullMatch;
      }
    );

    if (withInlineMarkers.includes('__VERSE_MARKER_')) {
      const markerRegex = /__VERSE_MARKER_(\d{1,3})_(\d{1,3})__/g;
      const matches = Array.from(withInlineMarkers.matchAll(markerRegex));

      if (matches.length > 0) {
        const verses: Verse[] = [];
        let activeChapter = defaultStartChapter;

        const firstMarkerIndex = matches[0].index ?? 0;
        const leadingText = this.normalizeWhitespace(withInlineMarkers.slice(0, firstMarkerIndex));
        const firstMarkerChap = parseInt(matches[0][1], 10);
        const firstMarkerNum = parseInt(matches[0][2], 10);

        if (firstMarkerChap > 0 && !activeChapter) {
          activeChapter = firstMarkerChap;
        }

        if (leadingText.length > 0) {
          const inferredFirstNum = firstMarkerNum > 1 ? firstMarkerNum - 1 : defaultStartVerse;
          const verseObj: Verse = {
            verseNumber: inferredFirstNum,
            text: leadingText,
          };
          if (activeChapter && activeChapter > 0) {
            verseObj.chapterNumber = activeChapter;
          }
          verses.push(verseObj);
        }

        let prevVerseNum = 0;
        for (let i = 0; i < matches.length; i++) {
          const currentMatch = matches[i];
          const explicitChap = parseInt(currentMatch[1], 10);
          const verseNumber = parseInt(currentMatch[2], 10);

          if (explicitChap > 0) {
            activeChapter = explicitChap;
          } else if (
            activeChapter &&
            prevVerseNum > 1 &&
            verseNumber === 1 &&
            i > 0
          ) {
            // Automatic chapter rollover when verse numbers reset to 1 (e.g. 38, 39 -> 1, 2)
            activeChapter += 1;
          }

          prevVerseNum = verseNumber;

          const contentStart = (currentMatch.index ?? 0) + currentMatch[0].length;
          const contentEnd =
            i + 1 < matches.length
              ? (matches[i + 1].index ?? withInlineMarkers.length)
              : withInlineMarkers.length;
          const verseText = this.normalizeWhitespace(
            withInlineMarkers.slice(contentStart, contentEnd)
          );

          if (verseText.length > 0) {
            const verseObj: Verse = {
              verseNumber,
              text: verseText,
            };
            if (activeChapter && activeChapter > 0) {
              verseObj.chapterNumber = activeChapter;
            }
            verses.push(verseObj);
          }
        }

        if (verses.length > 0) {
          return verses;
        }
      }
    }

    // Fallback when no explicit verse markers exist in the text:
    const lines = cleanedBody
      .split('\n')
      .map((l) => this.normalizeWhitespace(l))
      .filter((l) => l.length > 0);

    if (lines.length > 1) {
      return lines.map((line, idx) => ({
        verseNumber: defaultStartVerse + idx,
        text: line,
        ...(defaultStartChapter ? { chapterNumber: defaultStartChapter } : {}),
      }));
    }

    const singleBlock = this.normalizeWhitespace(cleanedBody);
    if (!singleBlock) {
      return [];
    }

    const sentences = singleBlock
      .split(/(?<=[.!?]["'”’)]*)\s+(?=["'“‘(]*[A-Z])/)
      .map((s) => this.normalizeWhitespace(s))
      .filter((s) => s.length > 0);

    if (sentences.length > 1 && defaultStartVerse >= 1) {
      return sentences.map((sentence, idx) => ({
        verseNumber: defaultStartVerse + idx,
        text: sentence,
        ...(defaultStartChapter ? { chapterNumber: defaultStartChapter } : {}),
      }));
    }

    return [
      {
        verseNumber: defaultStartVerse,
        text: singleBlock,
        ...(defaultStartChapter ? { chapterNumber: defaultStartChapter } : {}),
      },
    ];
  }

  private normalizeWhitespace(str: string): string {
    return str.replace(/\s+/g, ' ').trim();
  }
}
