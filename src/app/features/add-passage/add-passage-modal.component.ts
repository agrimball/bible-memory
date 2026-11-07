import { Component, EventEmitter, Output, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PassageParserService } from '../../core/services/passage-parser.service';
import { DeckItem, StorageService } from '../../core/services/storage.service';
import { Verse } from '../../core/proto/bible_memory.pb';

const ISAIAH_40_EXAMPLE_REF = 'Isaiah 40:28-31';
const ISAIAH_40_EXAMPLE_RAW = `[28] Have you not known? Have you not heard? The LORD is the everlasting God, the Creator of the ends of the earth. He does not faint or grow weary; his understanding is unsearchable.
[29] He gives power to the faint, and to him who has no might he increases strength.
[30] Even youths shall faint and be weary, and young men shall fall exhausted;
[31] but they who wait for the LORD shall renew their strength; they shall mount up with wings like eagles; they shall run and not be weary; they shall walk and not faint.`;

const SUPERSCRIPT_DIGIT_MAP: Record<string, string> = {
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

export interface HighlightSegment {
  type: 'text' | 'verse-num';
  value: string;
  verseNumber?: number;
}

const VERSE_NUMBER_TOKEN_REGEX =
  /(\[\d{1,3}\]\s*|\(\d{1,3}\)\s*|[⁰¹²³⁴⁵⁶⁷⁸⁹]+\s*|(?:^|(?<=\s))\d{1,3}\s+(?=["'“‘(]*[A-Za-z]))/gm;

@Component({
  selector: 'app-add-passage-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div
      class="modal-backdrop"
      (click)="onBackdropClick($event)"
      data-testid="add-passage-modal"
    >
      <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="add-passage-title">
        <header class="modal-header">
          <div>
            <span class="modal-eyebrow">Simple Copy-Paste Editor</span>
            <h2 id="add-passage-title" class="modal-title">Add Passage</h2>
            <p class="modal-subtitle">
              Paste your passage into the plain text box below and edit it freely. Use
              <strong>Highlight Verse Numbers</strong> to preview and strip verse numbers while
              automatically remembering where each verse begins and ends.
            </p>
          </div>
          <button
            type="button"
            class="icon-close-btn"
            (click)="closed.emit()"
            aria-label="Close modal"
            data-testid="btn-close-add-passage"
          >
            ✕
          </button>
        </header>

        <div class="modal-body">
          <div class="form-row-top">
            <div class="field-group flex-1">
              <label for="passage-ref-input" class="field-label">
                Passage Reference
              </label>
              <input
                id="passage-ref-input"
                type="text"
                class="text-input"
                placeholder="e.g. Isaiah 40:28-31 or Romans 8:1-4"
                [ngModel]="reference()"
                (ngModelChange)="reference.set($event)"
                data-testid="input-passage-reference"
              />
            </div>

            <div class="example-action-wrap">
              <button
                type="button"
                class="example-btn"
                (click)="pasteExample()"
                data-testid="btn-paste-example"
              >
                ✦ Paste Example (Isaiah 40:28-31)
              </button>
            </div>
          </div>

          <div class="field-group">
            <div class="textarea-toolbar">
              <label for="passage-raw-textarea" class="field-label">
                Passage Text
                <span class="field-hint">
                  @if (hasRememberedBoundaries()) {
                    (Verse boundaries remembered — verses separated by blank lines)
                  } @else {
                    (Plain editable text box — verse boundaries detected from verse numbers)
                  }
                </span>
              </label>

              <div class="verse-num-helper-actions">
                @if (!isHighlightingVerseNumbers()) {
                  <button
                    type="button"
                    class="helper-btn highlight-trigger-btn"
                    [disabled]="!rawText().trim()"
                    (click)="startHighlightVerseNumbers()"
                    data-testid="btn-highlight-verse-numbers"
                  >
                    🔍 Highlight Verse Numbers
                  </button>
                } @else {
                  <button
                    type="button"
                    class="helper-btn confirm-remove-btn"
                    [disabled]="highlightedVerseNumberCount() === 0"
                    (click)="removeHighlightedVerseNumbers()"
                    data-testid="btn-remove-verse-numbers"
                  >
                    ✂ Remove Highlighted Verse Numbers ({{ highlightedVerseNumberCount() }})
                  </button>
                  <button
                    type="button"
                    class="helper-btn cancel-highlight-btn"
                    (click)="cancelHighlightVerseNumbers()"
                    data-testid="btn-cancel-highlight-verse-numbers"
                  >
                    Keep / Cancel
                  </button>
                }
              </div>
            </div>

            <textarea
              id="passage-raw-textarea"
              rows="6"
              class="raw-textarea"
              placeholder="Paste or type your passage here...&#10;[28] Have you not known? Have you not heard?...&#10;[29] He gives power to the faint..."
              [ngModel]="rawText()"
              (ngModelChange)="onRawTextChange($event)"
              data-testid="textarea-passage-raw"
            ></textarea>
          </div>

          @if (showMissingVerseNumbersWarning()) {
            <div
              class="missing-verse-nums-warning"
              role="alert"
              data-testid="warning-no-verse-numbers"
            >
              <strong class="warning-title">⚠️ No verse numbers detected</strong>
              <p class="warning-body">
                This text doesn't contain verse numbers (e.g. <code>[1]</code>, <code>2 </code>, or
                <code>¹²³</code>), so verse boundaries aren't marked for <code>+1v</code> study and
                accumulative stitching. Tip: Paste text with verse numbers included, then click
                <strong>Highlight Verse Numbers → Remove</strong> so we can remember the exact
                verse boundaries for you (or separate verses with blank lines).
              </p>
            </div>
          }

          @if (isHighlightingVerseNumbers()) {
            <section
              class="highlight-preview-box"
              data-testid="verse-number-highlight-preview"
              aria-live="polite"
            >
              <div class="highlight-preview-header">
                <span class="highlight-badge">
                  Step 1 of 2 • Confirm Verse Numbers to Delete
                </span>
                <span class="highlight-summary">
                  @if (highlightedVerseNumberCount() > 0) {
                    <strong>{{ highlightedVerseNumberCount() }}</strong>
                    {{ highlightedVerseNumberCount() === 1 ? 'verse number' : 'verse numbers' }}
                    highlighted below will be removed, and their
                    <strong>exact verse boundaries</strong> will be remembered for
                    <code>+1v</code> study.
                  } @else {
                    No verse numbers were detected in the current text.
                  }
                </span>
              </div>

              <div class="highlight-preview-content">
                @for (seg of highlightSegments(); track $index) {
                  @if (seg.type === 'verse-num') {
                    <mark
                      class="highlighted-verse-num"
                      title="Will be removed (verse boundary remembered)"
                      data-testid="highlighted-verse-num"
                    >{{ seg.value }}</mark>
                  } @else {
                    <span class="normal-text-seg">{{ seg.value }}</span>
                  }
                }
              </div>
            </section>
          }

          <section class="preview-panel" data-testid="parsed-verses-preview">
            <div class="preview-header">
              <div class="preview-title-group">
                <span class="preview-badge">
                  Verses ({{ parsedResult().verses.length }})
                </span>
                <span class="preview-ref">{{ parsedResult().reference }}</span>
                @if (hasRememberedBoundaries()) {
                  <span
                    class="remembered-boundary-pill"
                    data-testid="remembered-boundaries-badge"
                  >
                    ✓ {{ parsedResult().verses.length }} verse
                    {{ parsedResult().verses.length === 1 ? 'boundary' : 'boundaries' }} remembered
                    from stripped verse numbers
                  </span>
                }
              </div>
              <span class="preview-count">
                {{ parsedResult().verses.length }}
                {{ parsedResult().verses.length === 1 ? 'verse' : 'verses' }} for <code>+1v</code> study
              </span>
            </div>

            @if (parsedResult().verses.length > 0) {
              <ul class="parsed-verse-list">
                @for (verse of parsedResult().verses; track $index) {
                  <li class="parsed-verse-item" [attr.data-testid]="'preview-verse-' + $index">
                    <span class="verse-num-pill">[v. {{ verse.verseNumber }}]</span>
                    <span class="verse-text-body">{{ verse.text }}</span>
                  </li>
                }
              </ul>
            } @else {
              <div class="preview-empty">
                Paste or type text above to add it to your memory deck.
              </div>
            }
          </section>
        </div>

        <footer class="modal-footer">
          <button type="button" class="secondary-btn" (click)="closed.emit()">Cancel</button>
          <button
            type="button"
            class="save-btn"
            [disabled]="!canSave()"
            (click)="savePassage()"
            data-testid="btn-save-passage"
          >
            Save Passage to Deck
          </button>
        </footer>
      </div>
    </div>
  `,
  styles: [
    `
      .modal-backdrop {
        position: fixed;
        inset: 0;
        background: rgba(28, 25, 23, 0.58);
        backdrop-filter: blur(4px);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 1.25rem;
        z-index: 100;
      }

      .modal-card {
        width: 100%;
        max-width: 740px;
        max-height: 92vh;
        background: #fffdf9;
        border: 1px solid #e7e0d3;
        border-radius: 1rem;
        box-shadow: 0 24px 48px rgba(28, 25, 23, 0.24);
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }

      .modal-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 1rem;
        padding: 1.35rem 1.5rem 1rem;
        border-bottom: 1px solid #ede7db;
        background: #faf6ee;
      }

      .modal-eyebrow {
        display: inline-block;
        font-size: 0.72rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: #0f766e;
        margin-bottom: 0.25rem;
      }

      .modal-title {
        margin: 0;
        font-size: 1.25rem;
        font-weight: 700;
        color: #1c1917;
      }

      .modal-subtitle {
        margin: 0.35rem 0 0;
        font-size: 0.84rem;
        color: #57534e;
        line-height: 1.45;
      }

      .icon-close-btn {
        background: transparent;
        border: 1px solid #d6cfc2;
        border-radius: 0.5rem;
        width: 2rem;
        height: 2rem;
        font-size: 0.9rem;
        color: #57534e;
        cursor: pointer;
        flex-shrink: 0;
      }

      .icon-close-btn:hover {
        background: #ede7db;
        color: #1c1917;
      }

      .modal-body {
        padding: 1.25rem 1.5rem;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 1.1rem;
      }

      .form-row-top {
        display: flex;
        align-items: flex-end;
        gap: 0.85rem;
        flex-wrap: wrap;
      }

      .flex-1 {
        flex: 1 1 260px;
      }

      .field-group {
        display: flex;
        flex-direction: column;
        gap: 0.45rem;
      }

      .textarea-toolbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.75rem;
        flex-wrap: wrap;
      }

      .field-label {
        font-size: 0.84rem;
        font-weight: 600;
        color: #292524;
        display: flex;
        align-items: baseline;
        gap: 0.45rem;
        flex-wrap: wrap;
      }

      .field-hint {
        font-size: 0.75rem;
        font-weight: 400;
        color: #78716c;
      }

      .verse-num-helper-actions {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        flex-wrap: wrap;
      }

      .helper-btn {
        padding: 0.42rem 0.8rem;
        border-radius: 0.5rem;
        font-size: 0.79rem;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.15s ease;
      }

      .helper-btn:disabled {
        opacity: 0.45;
        cursor: not-allowed;
      }

      .highlight-trigger-btn {
        background: #fef3c7;
        border: 1px solid #f59e0b;
        color: #92400e;
      }

      .highlight-trigger-btn:hover:not(:disabled) {
        background: #fde68a;
      }

      .confirm-remove-btn {
        background: #dc2626;
        border: 1px solid #b91c1c;
        color: #ffffff;
      }

      .confirm-remove-btn:hover:not(:disabled) {
        background: #b91c1c;
      }

      .cancel-highlight-btn {
        background: #ffffff;
        border: 1px solid #d6cfc2;
        color: #57534e;
      }

      .cancel-highlight-btn:hover {
        background: #f5f0e6;
      }

      .text-input,
      .raw-textarea {
        width: 100%;
        box-sizing: border-box;
        padding: 0.65rem 0.85rem;
        border-radius: 0.6rem;
        border: 1px solid #d6cfc2;
        background: #ffffff;
        color: #1c1917;
        font-size: 0.92rem;
        font-family: inherit;
        transition: border-color 0.15s ease, box-shadow 0.15s ease;
      }

      .raw-textarea {
        resize: vertical;
        line-height: 1.5;
      }

      .text-input:focus,
      .raw-textarea:focus {
        outline: none;
        border-color: #0f766e;
        box-shadow: 0 0 0 3px rgba(15, 118, 110, 0.14);
      }

      .example-action-wrap {
        display: flex;
        align-items: center;
      }

      .example-btn {
        padding: 0.65rem 0.95rem;
        border-radius: 0.6rem;
        border: 1px solid #b45309;
        background: #fffbeb;
        color: #92400e;
        font-size: 0.83rem;
        font-weight: 600;
        cursor: pointer;
        white-space: nowrap;
        transition: all 0.15s ease;
      }

      .example-btn:hover {
        background: #fef3c7;
      }

      .missing-verse-nums-warning {
        background: #fffbeb;
        border: 1px solid #f59e0b;
        border-left: 4px solid #d97706;
        border-radius: 0.65rem;
        padding: 0.75rem 1rem;
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
      }

      .warning-title {
        font-size: 0.84rem;
        color: #92400e;
      }

      .warning-body {
        margin: 0;
        font-size: 0.8rem;
        color: #78350f;
        line-height: 1.45;
      }

      .warning-body code {
        background: rgba(217, 119, 6, 0.12);
        padding: 0.08rem 0.3rem;
        border-radius: 0.25rem;
        font-weight: 600;
      }

      .highlight-preview-box {
        border: 2px solid #f59e0b;
        border-radius: 0.75rem;
        background: #fffbeb;
        padding: 0.9rem 1.1rem;
        display: flex;
        flex-direction: column;
        gap: 0.65rem;
      }

      .highlight-preview-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.75rem;
        flex-wrap: wrap;
        padding-bottom: 0.5rem;
        border-bottom: 1px solid #fde68a;
      }

      .highlight-badge {
        font-size: 0.72rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        padding: 0.2rem 0.55rem;
        border-radius: 999px;
        background: #fef3c7;
        color: #92400e;
        border: 1px solid #f59e0b;
      }

      .highlight-summary {
        font-size: 0.8rem;
        color: #78350f;
      }

      .highlight-preview-content {
        background: #ffffff;
        border: 1px solid #fde68a;
        border-radius: 0.55rem;
        padding: 0.75rem 0.9rem;
        font-size: 0.9rem;
        line-height: 1.65;
        white-space: pre-wrap;
        color: #1c1917;
        max-height: 180px;
        overflow-y: auto;
      }

      .highlighted-verse-num {
        background: #fee2e2;
        color: #b91c1c;
        border: 1px solid #f87171;
        border-radius: 0.3rem;
        padding: 0.05rem 0.3rem;
        margin-right: 0.15rem;
        font-weight: 700;
        text-decoration: line-through;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      }

      .preview-panel {
        border: 1px solid #e2dacb;
        border-radius: 0.75rem;
        background: #faf7f0;
        padding: 0.9rem 1.1rem;
      }

      .preview-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.75rem;
        flex-wrap: wrap;
        margin-bottom: 0.65rem;
        padding-bottom: 0.55rem;
        border-bottom: 1px solid #e7e0d3;
      }

      .preview-title-group {
        display: flex;
        align-items: center;
        gap: 0.6rem;
        flex-wrap: wrap;
      }

      .preview-badge {
        font-size: 0.72rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        padding: 0.2rem 0.55rem;
        border-radius: 999px;
        background: #ccfbf1;
        color: #115e59;
      }

      .remembered-boundary-pill {
        font-size: 0.73rem;
        font-weight: 600;
        padding: 0.18rem 0.6rem;
        border-radius: 999px;
        background: #dcfce7;
        color: #166534;
        border: 1px solid #86efac;
      }

      .preview-ref {
        font-size: 0.95rem;
        font-weight: 700;
        color: #1c1917;
      }

      .preview-count {
        font-size: 0.78rem;
        color: #57534e;
      }

      .parsed-verse-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        max-height: 170px;
        overflow-y: auto;
      }

      .parsed-verse-item {
        display: flex;
        align-items: flex-start;
        gap: 0.6rem;
        padding: 0.45rem 0.65rem;
        border-radius: 0.5rem;
        background: #ffffff;
        border: 1px solid #ece5d8;
        font-size: 0.86rem;
        line-height: 1.45;
      }

      .verse-num-pill {
        font-weight: 700;
        color: #0f766e;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        font-size: 0.78rem;
        flex-shrink: 0;
        margin-top: 0.05rem;
      }

      .verse-text-body {
        color: #292524;
        white-space: pre-line;
      }

      .preview-empty {
        font-size: 0.84rem;
        color: #78716c;
        text-align: center;
        padding: 0.85rem 0.5rem;
      }

      .modal-footer {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 0.75rem;
        padding: 1rem 1.5rem;
        border-top: 1px solid #ede7db;
        background: #faf6ee;
      }

      .secondary-btn {
        padding: 0.62rem 1.1rem;
        border-radius: 0.6rem;
        border: 1px solid #d6cfc2;
        background: #ffffff;
        color: #44403c;
        font-size: 0.88rem;
        font-weight: 600;
        cursor: pointer;
      }

      .secondary-btn:hover {
        background: #f5f0e6;
      }

      .save-btn {
        padding: 0.65rem 1.25rem;
        border-radius: 0.6rem;
        border: none;
        background: #0f766e;
        color: #ffffff;
        font-size: 0.88rem;
        font-weight: 600;
        cursor: pointer;
        transition: background 0.15s ease;
      }

      .save-btn:hover:not(:disabled) {
        background: #115e59;
      }

      .save-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
    `,
  ],
})
export class AddPassageModalComponent {
  private readonly passageParser = inject(PassageParserService);
  private readonly storageService = inject(StorageService);

  @Output() closed = new EventEmitter<void>();
  @Output() passageAdded = new EventEmitter<DeckItem>();

  readonly reference = signal<string>('');
  readonly rawText = signal<string>('');
  readonly isHighlightingVerseNumbers = signal<boolean>(false);

  /**
   * When the user strips verse numbers, we remember the exact verse numbers and
   * separate verse boundaries by blank lines (`\n\n`) so multi-line poetic verses
   * are NOT mistakenly split into separate verses on single line breaks.
   */
  readonly rememberedVerseNumbers = signal<number[]>([]);
  readonly hasRememberedBoundaries = computed<boolean>(
    () => this.rememberedVerseNumbers().length > 0
  );

  readonly highlightSegments = computed<HighlightSegment[]>(() => {
    const raw = this.rawText();
    if (!raw) {
      return [];
    }

    const segments: HighlightSegment[] = [];
    let lastIndex = 0;
    let fallbackNum = this.inferStartVerseNumber();

    for (const match of raw.matchAll(VERSE_NUMBER_TOKEN_REGEX)) {
      const matchIndex = match.index ?? 0;
      const matchText = match[0];

      if (matchIndex > lastIndex) {
        segments.push({
          type: 'text',
          value: raw.slice(lastIndex, matchIndex),
        });
      }

      const parsedNum = this.parseVerseNumberToken(matchText, fallbackNum);
      segments.push({
        type: 'verse-num',
        value: matchText,
        verseNumber: parsedNum,
      });
      fallbackNum = parsedNum + 1;

      lastIndex = matchIndex + matchText.length;
    }

    if (lastIndex < raw.length) {
      segments.push({
        type: 'text',
        value: raw.slice(lastIndex),
      });
    }

    return segments;
  });

  readonly highlightedVerseNumberCount = computed<number>(() => {
    return this.highlightSegments().filter((seg) => seg.type === 'verse-num').length;
  });

  readonly showMissingVerseNumbersWarning = computed<boolean>(() => {
    const trimmed = this.rawText().trim();
    return (
      trimmed.length > 0 &&
      this.highlightedVerseNumberCount() === 0 &&
      this.rememberedVerseNumbers().length === 0
    );
  });

  readonly parsedResult = computed<{ reference: string; verses: Verse[] }>(() => {
    const raw = this.rawText();
    const ref = this.reference().trim();
    const trimmed = raw.replace(/\r\n/g, '\n').trim();

    if (!trimmed) {
      return {
        reference: ref || 'Untitled Passage',
        verses: [],
      };
    }

    // Case 1: Text currently contains explicit verse numbers -> split ONLY at verse numbers
    // so multi-line poetry inside a verse stays together and inline verses split accurately.
    const segments = this.highlightSegments();
    const verseNumCount = segments.filter((s) => s.type === 'verse-num').length;
    if (verseNumCount > 0) {
      const versesFromMarkers = this.extractVersesFromSegments(segments);
      if (versesFromMarkers.length > 0) {
        return {
          reference: ref || this.formatDefaultReference(versesFromMarkers),
          verses: versesFromMarkers,
        };
      }
    }

    // Case 2: Verse numbers were stripped via "Remove Highlighted Verse Numbers" ->
    // use the remembered verse boundaries (separated by blank lines `\n\n` in the editor)
    // and pair each block with its remembered verse number!
    const rememberedNums = this.rememberedVerseNumbers();
    if (rememberedNums.length > 0) {
      const blocksByBlankLine = trimmed
        .split(/\n\s*\n/)
        .map((b) => b.trim())
        .filter((b) => b.length > 0);

      const blocks =
        blocksByBlankLine.length > 1
          ? blocksByBlankLine
          : trimmed
              .split('\n')
              .map((b) => b.trim())
              .filter((b) => b.length > 0);

      const startVerse = rememberedNums[0] ?? this.inferStartVerseNumber();
      const verses: Verse[] = blocks.map((blockText, idx) => ({
        verseNumber: rememberedNums[idx] ?? startVerse + idx,
        text: blockText.replace(/[ \t]+/g, ' ').trim(),
      }));

      return {
        reference: ref || this.formatDefaultReference(verses),
        verses,
      };
    }

    // Case 3: Plain text without verse numbers -> split by paragraph breaks (\n\n) if present,
    // otherwise delegate to PassageParserService
    const paragraphBlocks = trimmed
      .split(/\n\s*\n/)
      .map((b) => b.trim())
      .filter((b) => b.length > 0);

    if (paragraphBlocks.length > 1) {
      const startVerse = this.inferStartVerseNumber();
      const verses: Verse[] = paragraphBlocks.map((blockText, idx) => ({
        verseNumber: startVerse + idx,
        text: blockText.replace(/[ \t]+/g, ' ').trim(),
      }));
      return {
        reference: ref || this.formatDefaultReference(verses),
        verses,
      };
    }

    return this.passageParser.parseRawInput(raw, ref || undefined);
  });

  readonly canSave = computed<boolean>(() => {
    return this.parsedResult().verses.length > 0;
  });

  onRawTextChange(value: string): void {
    this.rawText.set(value);
    if (!value.trim()) {
      this.rememberedVerseNumbers.set([]);
    }
  }

  startHighlightVerseNumbers(): void {
    this.isHighlightingVerseNumbers.set(true);
  }

  cancelHighlightVerseNumbers(): void {
    this.isHighlightingVerseNumbers.set(false);
  }

  removeHighlightedVerseNumbers(): void {
    const verses = this.extractVersesFromSegments(this.highlightSegments());
    if (verses.length === 0) {
      this.isHighlightingVerseNumbers.set(false);
      return;
    }

    // Remember the exact verse numbers and boundaries, and format the plain text box
    // with blank lines (\n\n) between verses so multi-line verses stay grouped together.
    this.rememberedVerseNumbers.set(verses.map((v) => v.verseNumber));
    const cleanedTextWithBoundaries = verses.map((v) => v.text).join('\n\n');

    this.rawText.set(cleanedTextWithBoundaries);
    this.isHighlightingVerseNumbers.set(false);
  }

  pasteExample(): void {
    this.reference.set(ISAIAH_40_EXAMPLE_REF);
    this.rawText.set(ISAIAH_40_EXAMPLE_RAW);
    this.rememberedVerseNumbers.set([]);
    this.isHighlightingVerseNumbers.set(false);
  }

  savePassage(): void {
    const parsed = this.parsedResult();
    if (parsed.verses.length === 0) {
      return;
    }
    const createdItem = this.storageService.addPassage(parsed.reference, parsed.verses);
    this.passageAdded.emit(createdItem);
    this.closed.emit();
  }

  onBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.closed.emit();
    }
  }

  private extractVersesFromSegments(segments: HighlightSegment[]): Verse[] {
    const verses: Verse[] = [];
    const startVerse = this.inferStartVerseNumber();

    let currentVerseNumber: number | null = null;
    let currentChunks: string[] = [];

    for (const seg of segments) {
      if (seg.type === 'verse-num') {
        if (currentVerseNumber !== null) {
          const text = this.cleanVerseChunk(currentChunks.join(''));
          if (text) {
            verses.push({ verseNumber: currentVerseNumber, text });
          }
        } else if (currentChunks.length > 0) {
          const leadingText = this.cleanVerseChunk(currentChunks.join(''));
          if (leadingText) {
            const firstMarkerNum = seg.verseNumber ?? startVerse;
            const inferredLeadingNum = firstMarkerNum > 1 ? firstMarkerNum - 1 : startVerse;
            verses.push({ verseNumber: inferredLeadingNum, text: leadingText });
          }
        }

        currentVerseNumber = seg.verseNumber ?? startVerse + verses.length;
        currentChunks = [];
      } else {
        currentChunks.push(seg.value);
      }
    }

    if (currentVerseNumber !== null && currentChunks.length > 0) {
      const text = this.cleanVerseChunk(currentChunks.join(''));
      if (text) {
        verses.push({ verseNumber: currentVerseNumber, text });
      }
    }

    return verses;
  }

  private cleanVerseChunk(rawChunk: string): string {
    return rawChunk
      .replace(/\r\n/g, '\n')
      .split('\n')
      .map((line) => line.replace(/[ \t]+/g, ' ').trim())
      .filter((line) => line.length > 0)
      .join('\n')
      .trim();
  }

  private parseVerseNumberToken(token: string, fallback: number): number {
    const normalized = token
      .split('')
      .map((ch) => SUPERSCRIPT_DIGIT_MAP[ch] ?? ch)
      .join('');
    const match = normalized.match(/\d{1,3}/);
    if (!match) {
      return fallback;
    }
    const num = parseInt(match[0], 10);
    return !isNaN(num) && num > 0 ? num : fallback;
  }

  private inferStartVerseNumber(): number {
    const ref = this.reference().trim();
    const colonMatch = ref.match(/:\s*(\d+)/);
    if (colonMatch) {
      const num = parseInt(colonMatch[1], 10);
      if (!isNaN(num) && num > 0) {
        return num;
      }
    }
    return 1;
  }

  private formatDefaultReference(verses: Verse[]): string {
    if (verses.length === 0) {
      return 'Custom Passage';
    }
    const first = verses[0].verseNumber;
    const last = verses[verses.length - 1].verseNumber;
    return first === last ? `Passage (v. ${first})` : `Passage (vv. ${first}–${last})`;
  }
}
