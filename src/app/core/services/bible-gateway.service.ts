import { Injectable } from '@angular/core';
import { isMultiChapterPassage, Verse } from '../proto/bible_memory.pb';

export interface BibleVersionOption {
  code: string;
  label: string;
}

export const BIBLE_VERSIONS: BibleVersionOption[] = [
  { code: 'ESV', label: 'ESV — English Standard Version' },
  { code: 'NIV', label: 'NIV — New International Version' },
  { code: 'NASB', label: 'NASB — New American Standard Bible' },
  { code: 'CSB', label: 'CSB — Christian Standard Bible' },
  { code: 'NLT', label: 'NLT — New Living Translation' },
  { code: 'KJV', label: 'KJV — King James Version' },
  { code: 'NKJV', label: 'NKJV — New King James Version' },
  { code: 'NRSVUE', label: 'NRSVUE — New Revised Standard Version' },
  { code: 'AMP', label: 'AMP — Amplified Bible' },
  { code: 'MSG', label: 'MSG — The Message' },
];

export interface BibleGatewayLookupResult {
  canonicalReference: string;
  version: string;
  rawHtml: string;
  cleanPlainText: string;
  verses: Verse[];
  sourceUrl: string;
}

@Injectable({ providedIn: 'root' })
export class BibleGatewayService {
  readonly supportedVersions = BIBLE_VERSIONS;

  /**
   * Builds the direct BibleGateway print URL for a reference and translation.
   */
  buildSourceUrl(reference: string, version = 'ESV'): string {
    const cleanRef = reference.trim();
    const cleanVer = version.trim() || 'ESV';
    return `https://www.biblegateway.com/passage/?search=${encodeURIComponent(cleanRef)}&version=${encodeURIComponent(cleanVer)}&interface=print`;
  }

  /**
   * Fetches and parses a passage directly from BibleGateway via the CORS-enabled HTML reader endpoint.
   * Uses a single, explicit fetch path with zero silent fallbacks; throws a clear Error if the request
   * fails or if BibleGateway returns no matching passage verses.
   */
  async fetchPassage(reference: string, version = 'ESV'): Promise<BibleGatewayLookupResult> {
    const trimmedRef = (reference ?? '').trim();
    const trimmedVer = (version ?? 'ESV').trim().toUpperCase() || 'ESV';

    if (!trimmedRef) {
      throw new Error('Please enter a scripture reference (for example, "Romans 8:28-30").');
    }

    const sourceUrl = this.buildSourceUrl(trimmedRef, trimmedVer);
    const proxyUrl = `https://r.jina.ai/${sourceUrl}`;

    let response: Response;
    try {
      response = await fetch(proxyUrl, {
        method: 'GET',
        headers: {
          'X-Return-Format': 'html',
          'X-Target-Selector': '.bcv, .passage-text',
        },
      });
    } catch (networkErr: unknown) {
      const detail =
        networkErr instanceof Error ? networkErr.message : 'Network request failed';
      throw new Error(
        `Unable to reach BibleGateway via r.jina.ai (${detail}). Check your internet connection or try again.`
      );
    }

    if (!response.ok) {
      throw new Error(
        `BibleGateway lookup failed with HTTP ${response.status} ${response.statusText || ''}`.trim()
      );
    }

    const htmlString = await response.text();
    return this.parseBibleGatewayHtml(htmlString, trimmedRef, trimmedVer, sourceUrl);
  }

  /**
   * Parses BibleGateway HTML (`.bcv, .passage-text`) into canonical reference, clean display HTML,
   * structured Verse[] with exact chapterNumber & verseNumber, and plain text.
   */
  parseBibleGatewayHtml(
    htmlString: string,
    fallbackReference: string,
    version: string,
    sourceUrl: string
  ): BibleGatewayLookupResult {
    if (typeof DOMParser === 'undefined') {
      throw new Error('DOMParser is not available in this environment.');
    }

    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlString, 'text/html');

    const bcvEl = doc.querySelector('.bcv .dropdown-display-text, .bcv');
    const canonicalReference =
      this.normalizeWhitespace(bcvEl?.textContent ?? '') || fallbackReference;

    const passageRoot = doc.querySelector('.passage-text') ?? doc.body;
    if (!passageRoot) {
      throw new Error(
        `No passage content returned from BibleGateway for "${fallbackReference}" (${version}).`
      );
    }

    // 1. Build clean display HTML for the in-app BibleGateway preview overlay
    const displayClone = passageRoot.cloneNode(true) as HTMLElement;
    displayClone
      .querySelectorAll(
        '.footnotes, .crossrefs, .resources-section, .passage-other-trans, .full-chap-link, .publisher-info-bottom, script, style'
      )
      .forEach((el) => el.remove());
    // Strip inline footnote/crossreference markers from display clone so the preview is clean and readable
    displayClone.querySelectorAll('sup.footnote, sup.crossreference').forEach((el) => el.remove());

    // 2. Extract structured verses from a separate extraction clone
    const extractClone = passageRoot.cloneNode(true) as HTMLElement;
    // Remove headings, psalm titles, footnotes, cross-references, and resource blocks first
    // (Note: BibleGateway wraps heading text inside `<h3><span class="text Book-Chap-1">...</span></h3>`)
    extractClone
      .querySelectorAll(
        'h1, h2, h3, h4, .psalm-title, sup.footnote, .footnote, .footnotes, sup.crossreference, .crossreference, .crossrefs, .resources-section, .passage-other-trans, .full-chap-link, .publisher-info-bottom, script, style'
      )
      .forEach((el) => el.remove());

    const textSpans = Array.from(extractClone.querySelectorAll('span.text'));
    const verseMap = new Map<string, Verse>();
    const verseOrder: string[] = [];

    for (const span of textSpans) {
      const classAttr = span.getAttribute('class') ?? '';
      // Match BibleGateway's canonical class pattern: e.g. "text Rom-8-28" or "text 1Cor-13-4" or "text Ps-23-1"
      const refMatch = classAttr.match(/\b(?:[1-3]?[A-Za-z]+)-(\d+)-(\d+)\b/);
      if (!refMatch) {
        continue;
      }

      const chapterNumber = parseInt(refMatch[1], 10);
      const verseNumber = parseInt(refMatch[2], 10);
      if (isNaN(chapterNumber) || isNaN(verseNumber)) {
        continue;
      }

      const spanClone = span.cloneNode(true) as HTMLElement;
      // Strip chapter number & superscript verse number markers inside the verse span
      spanClone
        .querySelectorAll('.chapternum, sup.versenum, .versenum, sup.footnote, sup.crossreference')
        .forEach((el) => el.remove());

      const segmentText = this.normalizeWhitespace(spanClone.textContent ?? '');
      if (!segmentText) {
        continue;
      }

      const key = `${chapterNumber}:${verseNumber}`;
      const existing = verseMap.get(key);
      if (existing) {
        existing.text = this.normalizeWhitespace(`${existing.text} ${segmentText}`);
      } else {
        verseOrder.push(key);
        verseMap.set(key, {
          chapterNumber,
          verseNumber,
          text: segmentText,
        });
      }
    }

    const verses: Verse[] = verseOrder
      .map((k) => verseMap.get(k)!)
      .filter((v) => v && v.text.length > 0);

    if (verses.length === 0) {
      throw new Error(
        `No verses found on BibleGateway for "${fallbackReference}" (${version}). Please check the reference spelling.`
      );
    }

    const multiChapter = isMultiChapterPassage(verses);
    const cleanPlainText = verses
      .map((v) =>
        multiChapter && v.chapterNumber
          ? `[${v.chapterNumber}:${v.verseNumber}] ${v.text}`
          : `[${v.verseNumber}] ${v.text}`
      )
      .join('\n');

    return {
      canonicalReference,
      version,
      rawHtml: displayClone.innerHTML.trim(),
      cleanPlainText,
      verses,
      sourceUrl,
    };
  }

  private normalizeWhitespace(value: string): string {
    return value.replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim();
  }
}
