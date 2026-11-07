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
      :host {
        --modal-bg: #1e293b;
        --modal-header-bg: #0f172a;
        --input-bg: #0f172a;
        --border-color: #334155;
        --text-primary: #f8fafc;
        --text-secondary: #cbd5e1;
        --text-muted: #94a3b8;
        display: block;
      }

      :host-context(.light-theme) {
        --modal-bg: #fffdf9;
        --modal-header-bg: #faf6ee;
        --input-bg: #ffffff;
        --border-color: #e7e0d3;
        --text-primary: #1c1917;
        --text-secondary: #44403c;
        --text-muted: #78716c;
      }

      .modal-backdrop {
        position: fixed;
        inset: 0;
        background: rgba(2, 6, 23, 0.72);
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
        background: var(--modal-bg);
        border: 1px solid var(--border-color);
        border-radius: 1rem;
        box-shadow: 0 24px 48px rgba(0, 0, 0, 0.45);
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
        border-bottom: 1px solid var(--border-color);
        background: var(--modal-header-bg);
      }

      .modal-eyebrow {
        display: inline-block;
        font-size: 0.72rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: #2dd4bf;
        margin-bottom: 0.25rem;
      }

      :host-context(.light-theme) .modal-eyebrow {
        color: #0f766e;
      }

      .modal-title {
        margin: 0;
        font-size: 1.25rem;
        font-weight: 700;
        color: var(--text-primary);
      }

      .modal-subtitle {
        margin: 0.35rem 0 0;
        font-size: 0.84rem;
        color: var(--text-secondary);
        line-height: 1.45;
      }

      .icon-close-btn {
        background: transparent;
        border: 1px solid var(--border-color);
        border-radius: 0.5rem;
        width: 2rem;
        height: 2rem;
        font-size: 0.9rem;
        color: var(--text-secondary);
        cursor: pointer;
        flex-shrink: 0;
      }

      .icon-close-btn:hover {
        background: rgba(255, 255, 255, 0.08);
        color: var(--text-primary);
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
        color: var(--text-primary);
        display: flex;
        align-items: baseline;
        gap: 0.45rem;
        flex-wrap: wrap;
      }

      .field-hint {
        font-size: 0.75rem;
        font-weight: 400;
        color: var(--text-muted);
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
        background: rgba(245, 158, 11, 0.18);
        border: 1px solid rgba(245, 158, 11, 0.5);
        color: #fcd34d;
      }

      :host-context(.light-theme) .highlight-trigger-btn {
        background: #fef3c7;
        border-color: #f59e0b;
        color: #92400e;
      }

      .highlight-trigger-btn:hover:not(:disabled) {
        background: rgba(245, 158, 11, 0.28);
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
        background: var(--input-bg);
        border: 1px solid var(--border-color);
        color: var(--text-secondary);
      }

      .text-input,
      .raw-textarea {
        width: 100%;
        box-sizing: border-box;
        padding: 0.65rem 0.85rem;
        border-radius: 0.6rem;
        border: 1px solid var(--border-color);
        background: var(--input-bg);
        color: var(--text-primary);
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
        border-color: #14b8a6;
        box-shadow: 0 0 0 3px rgba(20, 184, 166, 0.2);
      }

      .example-action-wrap {
        display: flex;
        align-items: center;
      }

      .example-btn {
        padding: 0.65rem 0.95rem;
        border-radius: 0.6rem;
        border: 1px solid rgba(245, 158, 11, 0.5);
        background: rgba(245, 158, 11, 0.16);
        color: #fde68a;
        font-size: 0.83rem;
        font-weight: 600;
        cursor: pointer;
        white-space: nowrap;
        transition: all 0.15s ease;
      }

      :host-context(.light-theme) .example-btn {
        background: #fffbeb;
        color: #92400e;
        border-color: #b45309;
      }

      .example-btn:hover {
        background: rgba(245, 158, 11, 0.28);
      }

      .missing-verse-nums-warning {
        background: rgba(120, 53, 15, 0.35);
        border: 1px solid rgba(245, 158, 11, 0.5);
        border-left: 4px solid #f59e0b;
        border-radius: 0.65rem;
        padding: 0.75rem 1rem;
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
      }

      :host-context(.light-theme) .missing-verse-nums-warning {
        background: #fffbeb;
      }

      .warning-title {
        font-size: 0.84rem;
        color: #fcd34d;
      }

      :host-context(.light-theme) .warning-title {
        color: #92400e;
      }

      .warning-body {
        margin: 0;
        font-size: 0.8rem;
        color: var(--text-secondary);
        line-height: 1.45;
      }

      .warning-body code {
        background: rgba(245, 158, 11, 0.2);
        padding: 0.08rem 0.3rem;
        border-radius: 0.25rem;
        font-weight: 600;
      }

      .highlight-preview-box {
        border: 2px solid #f59e0b;
        border-radius: 0.75rem;
        background: rgba(120, 53, 15, 0.28);
        padding: 0.9rem 1.1rem;
        display: flex;
        flex-direction: column;
        gap: 0.65rem;
      }

      :host-context(.light-theme) .highlight-preview-box {
        background: #fffbeb;
      }

      .highlight-preview-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.75rem;
        flex-wrap: wrap;
        padding-bottom: 0.5rem;
        border-bottom: 1px solid rgba(245, 158, 11, 0.35);
      }

      .highlight-badge {
        font-size: 0.72rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        padding: 0.2rem 0.55rem;
        border-radius: 999px;
        background: rgba(245, 158, 11, 0.25);
        color: #fde68a;
        border: 1px solid #f59e0b;
      }

      :host-context(.light-theme) .highlight-badge {
        background: #fef3c7;
        color: #92400e;
      }

      .highlight-summary {
        font-size: 0.8rem;
        color: var(--text-secondary);
      }

      .highlight-preview-content {
        background: var(--input-bg);
        border: 1px solid var(--border-color);
        border-radius: 0.55rem;
        padding: 0.75rem 0.9rem;
        font-size: 0.9rem;
        line-height: 1.65;
        white-space: pre-wrap;
        color: var(--text-primary);
        max-height: 180px;
        overflow-y: auto;
      }

      .highlighted-verse-num {
        background: rgba(239, 68, 68, 0.25);
        color: #fca5a5;
        border: 1px solid #f87171;
        border-radius: 0.3rem;
        padding: 0.05rem 0.3rem;
        margin-right: 0.15rem;
        font-weight: 700;
        text-decoration: line-through;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      }

      :host-context(.light-theme) .highlighted-verse-num {
        background: #fee2e2;
        color: #b91c1c;
      }

      .preview-panel {
        border: 1px solid var(--border-color);
        border-radius: 0.75rem;
        background: var(--modal-header-bg);
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
        border-bottom: 1px solid var(--border-color);
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
        background: rgba(20, 184, 166, 0.2);
        color: #5eead4;
      }

      :host-context(.light-theme) .preview-badge {
        background: #ccfbf1;
        color: #115e59;
      }

      .remembered-boundary-pill {
        font-size: 0.73rem;
        font-weight: 600;
        padding: 0.18rem 0.6rem;
        border-radius: 999px;
        background: rgba(34, 197, 94, 0.2);
        color: #86efac;
        border: 1px solid rgba(34, 197, 94, 0.45);
      }

      :host-context(.light-theme) .remembered-boundary-pill {
        background: #dcfce7;
        color: #166534;
        border-color: #86efac;
      }

      .preview-ref {
        font-size: 0.95rem;
        font-weight: 700;
        color: var(--text-primary);
      }

      .preview-count {
        font-size: 0.78rem;
        color: var(--text-muted);
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
        background: var(--modal-bg);
        border: 1px solid var(--border-color);
        font-size: 0.86rem;
        line-height: 1.45;
      }

      .verse-num-pill {
        font-weight: 700;
        color: #2dd4bf;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        font-size: 0.78rem;
        flex-shrink: 0;
        margin-top: 0.05rem;
      }

      :host-context(.light-theme) .verse-num-pill {
        color: #0f766e;
      }

      .verse-text-body {
        color: var(--text-primary);
        white-space: pre-line;
      }

      .preview-empty {
        font-size: 0.84rem;
        color: var(--text-muted);
        text-align: center;
        padding: 0.85rem 0.5rem;
      }

      .modal-footer {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 0.75rem;
        padding: 1rem 1.5rem;
        border-top: 1px solid var(--border-color);
        background: var(--modal-header-bg);
      }

      .secondary-btn {
        padding: 0.62rem 1.1rem;
        border-radius: 0.6rem;
        border: 1px solid var(--border-color);
        background: var(--modal-bg);
        color: var(--text-secondary);
        font-size: 0.88rem;
        font-weight: 600;
        cursor: pointer;
      }

      .save-btn {
        padding: 0.65rem 1.25rem;
        border-radius: 0.6rem;
        border: none;
        background: #0d9488;
        color: #ffffff;
        font-size: 0.88rem;
        font-weight: 600;
        cursor: pointer;
        transition: background 0.15s ease;
      }

      .save-btn:hover:not(:disabled) {
        background: #0f766e;
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
