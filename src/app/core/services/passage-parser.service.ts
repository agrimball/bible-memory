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
  /^(?:[1-3]\s+)?[A-Za-z]+(?:\s+of\s+[A-Za-z]+|\s+[A-Za-z]+)?\s+\d+(?::\d+(?:\s*[-–—]\s*\d+)?(?:\s*,\s*\d+(?:\s*[-–—]\s*\d+)?)*)?(?:\s*\(?[A-Z]{2,6}\)?)?$/;

@Injectable({ providedIn: 'root' })
export class PassageParserService {
  /**
   * Parses pasted Bible passage text (from ESV, YouVersion, BibleGateway, etc.)
   * into a clean reference and structured array of Verse objects.
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
    const startVerseFromRef = this.extractStartVerseFromReference(detectedReference);

    const verses = this.extractVerses(cleanedBody, startVerseFromRef);

    if (!detectedReference) {
      if (verses.length > 0) {
        const firstNum = verses[0].verseNumber;
        const lastNum = verses[verses.length - 1].verseNumber;
        detectedReference =
          firstNum === lastNum ? `Passage (v. ${firstNum})` : `Passage (vv. ${firstNum}–${lastNum})`;
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
    // Match leading non-alphanumeric punctuation, first letter/digit, middle characters, and trailing punctuation
    const match = word.match(/^([^A-Za-z0-9\u00C0-\u024F]*)([A-Za-z0-9\u00C0-\u024F])(.*)$/);
    if (!match) {
      return word;
    }

    const leadingPunct = match[1];
    const firstChar = match[2];
    const rest = match[3];

    // Replace alphanumeric characters in `rest` with underscores, keeping punctuation intact
    const maskedRest = rest.replace(/[A-Za-z0-9\u00C0-\u024F]/g, '_');
    return `${leadingPunct}${firstChar}${maskedRest}`;
  }

  private looksLikeReference(line: string): boolean {
    if (!line || line.length > 60) {
      return false;
    }
    return REFERENCE_LINE_REGEX.test(line);
  }

  private cleanReferenceString(ref: string): string {
    return ref
      .replace(/^[-–—•\s]+/, '')
      .replace(/\s*\([A-Z]{2,6}\)\s*$/, '')
      .replace(/\s+[A-Z]{2,5}$/, (match) => {
        const token = match.trim();
        const translations = new Set(['ESV', 'NIV', 'KJV', 'NKJV', 'NLT', 'NASB', 'CSB', 'NRSV', 'AMP', 'MSG']);
        return translations.has(token) ? '' : match;
      })
      .replace(/\s+/g, ' ')
      .trim();
  }

  private extractStartVerseFromReference(reference: string): number {
    if (!reference) {
      return 1;
    }
    const colonMatch = reference.match(/:\s*(\d+)/);
    if (colonMatch) {
      const parsed = parseInt(colonMatch[1], 10);
      if (!isNaN(parsed) && parsed > 0) {
        return parsed;
      }
    }
    return 1;
  }

  private cleanFootnotesAndSuperscripts(text: string): string {
    let cleaned = text;

    // Strip letter footnote markers like [a], [b], (a), (b)
    cleaned = cleaned.replace(/\[[a-zA-Z]{1,2}\]/g, '');
    cleaned = cleaned.replace(/\([a-zA-Z]\)/g, '');

    // Strip cross-reference markers like †, *, ‡
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

  private extractVerses(cleanedBody: string, defaultStartVerse: number): Verse[] {
    // Normalize bracketed or parenthesized numeric verse markers like [1] or (1) into a unified marker
    // Also detect inline or line-start numbers like `1 There is therefore... 2 For the law...`
    const normalized = cleanedBody
      .replace(/\[(\d{1,3})\]/g, ' __VERSE_MARKER_$1__ ')
      .replace(/\((\d{1,3})\)/g, ' __VERSE_MARKER_$1__ ');

    // Also match numbers at start of line or after sentence-ending punctuation followed by a capital letter or quote
    const withInlineMarkers = normalized.replace(
      /(?:^|\n|\s)(?:(\d{1,3}))(?=\s+["'“‘(]*[A-Z])/g,
      (fullMatch, numStr) => {
        const num = parseInt(numStr, 10);
        if (num >= 1 && num <= 176) {
          return ` __VERSE_MARKER_${num}__ `;
        }
        return fullMatch;
      }
    );

    if (withInlineMarkers.includes('__VERSE_MARKER_')) {
      const markerRegex = /__VERSE_MARKER_(\d{1,3})__/g;
      const matches = Array.from(withInlineMarkers.matchAll(markerRegex));

      if (matches.length > 0) {
        const verses: Verse[] = [];

        // Check if there is leading text before the first verse marker
        const firstMarkerIndex = matches[0].index ?? 0;
        const leadingText = this.normalizeWhitespace(withInlineMarkers.slice(0, firstMarkerIndex));
        const firstMarkerNum = parseInt(matches[0][1], 10);

        if (leadingText.length > 0) {
          const inferredFirstNum = firstMarkerNum > 1 ? firstMarkerNum - 1 : defaultStartVerse;
          verses.push({
            verseNumber: inferredFirstNum,
            text: leadingText,
          });
        }

        for (let i = 0; i < matches.length; i++) {
          const currentMatch = matches[i];
          const verseNumber = parseInt(currentMatch[1], 10);
          const contentStart = (currentMatch.index ?? 0) + currentMatch[0].length;
          const contentEnd =
            i + 1 < matches.length ? (matches[i + 1].index ?? withInlineMarkers.length) : withInlineMarkers.length;
          const verseText = this.normalizeWhitespace(withInlineMarkers.slice(contentStart, contentEnd));

          if (verseText.length > 0) {
            verses.push({
              verseNumber,
              text: verseText,
            });
          }
        }

        if (verses.length > 0) {
          return verses;
        }
      }
    }

    // Fallback when no explicit verse markers exist in the text:
    // Split by non-empty lines, or by sentences if a single block
    const lines = cleanedBody
      .split('\n')
      .map((l) => this.normalizeWhitespace(l))
      .filter((l) => l.length > 0);

    if (lines.length > 1) {
      return lines.map((line, idx) => ({
        verseNumber: defaultStartVerse + idx,
        text: line,
      }));
    }

    const singleBlock = this.normalizeWhitespace(cleanedBody);
    if (!singleBlock) {
      return [];
    }

    // Split single block into sentences if multiple sentences exist, or keep as 1 verse if short
    const sentences = singleBlock
      .split(/(?<=[.!?]["'”’)]*)\s+(?=["'“‘(]*[A-Z])/)
      .map((s) => this.normalizeWhitespace(s))
      .filter((s) => s.length > 0);

    if (sentences.length > 1 && defaultStartVerse >= 1) {
      return sentences.map((sentence, idx) => ({
        verseNumber: defaultStartVerse + idx,
        text: sentence,
      }));
    }

    return [
      {
        verseNumber: defaultStartVerse,
        text: singleBlock,
      },
    ];
  }

  private normalizeWhitespace(str: string): string {
    return str.replace(/\s+/g, ' ').trim();
  }
}
