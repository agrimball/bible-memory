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

export interface HighlightSegment {
  type: 'text' | 'verse-num';
  value: string;
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
              <strong>Highlight Verse Numbers</strong> to preview and confirm before stripping verse
              numbers.
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
                <span class="field-hint">(plain editable text box — one verse per line or paragraph)</span>
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
                    highlighted in red/amber below will be deleted when you click
                    <strong>Remove Highlighted Verse Numbers</strong>.
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
                      title="Will be removed"
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
                <span class="preview-badge">Card Lines / Verses ({{ parsedResult().verses.length }})</span>
                <span class="preview-ref">{{ parsedResult().reference }}</span>
              </div>
              <span class="preview-count">
                {{ parsedResult().verses.length }}
                {{ parsedResult().verses.length === 1 ? 'step' : 'steps' }} for <code>+1v</code> study
              </span>
            </div>

            @if (parsedResult().verses.length > 0) {
              <ul class="parsed-verse-list">
                @for (verse of parsedResult().verses; track $index) {
                  <li class="parsed-verse-item" [attr.data-testid]="'preview-verse-' + $index">
                    <span class="verse-num-pill">#{{ $index + 1 }}</span>
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

  readonly highlightSegments = computed<HighlightSegment[]>(() => {
    const raw = this.rawText();
    if (!raw) {
      return [];
    }

    const segments: HighlightSegment[] = [];
    let lastIndex = 0;

    for (const match of raw.matchAll(VERSE_NUMBER_TOKEN_REGEX)) {
      const matchIndex = match.index ?? 0;
      const matchText = match[0];

      if (matchIndex > lastIndex) {
        segments.push({
          type: 'text',
          value: raw.slice(lastIndex, matchIndex),
        });
      }

      segments.push({
        type: 'verse-num',
        value: matchText,
      });

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

  readonly parsedResult = computed<{ reference: string; verses: Verse[] }>(() => {
    const raw = this.rawText();
    const ref = this.reference().trim();

    // Split by non-empty lines if the user has already stripped verse numbers, or use parser
    const trimmed = raw.replace(/\r\n/g, '\n').trim();
    if (!trimmed) {
      return {
        reference: ref || 'Untitled Passage',
        verses: [],
      };
    }

    const lines = trimmed
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    if (lines.length > 1 && this.highlightedVerseNumberCount() === 0) {
      return {
        reference: ref || 'Custom Passage',
        verses: lines.map((line, idx) => ({
          verseNumber: idx + 1,
          text: line,
        })),
      };
    }

    return this.passageParser.parseRawInput(raw, ref || undefined);
  });

  readonly canSave = computed<boolean>(() => {
    return this.parsedResult().verses.length > 0;
  });

  onRawTextChange(value: string): void {
    this.rawText.set(value);
  }

  startHighlightVerseNumbers(): void {
    this.isHighlightingVerseNumbers.set(true);
  }

  cancelHighlightVerseNumbers(): void {
    this.isHighlightingVerseNumbers.set(false);
  }

  removeHighlightedVerseNumbers(): void {
    const cleaned = this.highlightSegments()
      .filter((seg) => seg.type === 'text')
      .map((seg) => seg.value)
      .join('')
      .split('\n')
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .filter((line) => line.length > 0)
      .join('\n');

    this.rawText.set(cleaned);
    this.isHighlightingVerseNumbers.set(false);
  }

  pasteExample(): void {
    this.reference.set(ISAIAH_40_EXAMPLE_REF);
    this.rawText.set(ISAIAH_40_EXAMPLE_RAW);
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
}
