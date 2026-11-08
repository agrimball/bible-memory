import { Component, EventEmitter, Output, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  BIBLE_VERSIONS,
  BibleGatewayLookupResult,
  BibleGatewayService,
  BibleVersionOption,
} from '../../core/services/bible-gateway.service';
import { PassageParserService } from '../../core/services/passage-parser.service';
import { DeckItem, StorageService } from '../../core/services/storage.service';
import {
  Verse,
  formatVerseBadge,
  isMultiChapterPassage,
} from '../../core/proto/bible_memory.pb';

const ISAIAH_40_EXAMPLE_REF = 'Isaiah 40:28-31';
const ISAIAH_40_EXAMPLE_RAW = `[28] Have you not known? Have you not heard? The LORD is the everlasting God, the Creator of the ends of the earth. He does not faint or grow weary; his understanding is unsearchable.
[29] He gives power to the faint, and to him who has no might he increases strength.
[30] Even youths shall faint and be weary, and young men shall fall exhausted;
[31] but they who wait for the LORD shall renew their strength; they shall mount up with wings like eagles; they shall run and not be weary; they shall walk and not faint.`;

const BG_VERSION_STORAGE_KEY = 'selah_bg_version_v1';

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
  chapterNumber?: number;
}

const VERSE_NUMBER_TOKEN_REGEX =
  /(\[\d{1,3}(?::\d{1,3})?\]\s*|\(\d{1,3}(?::\d{1,3})?\)\s*|[⁰¹²³⁴⁵⁶⁷⁸⁹]+\s*|(?:^|(?<=\s))\d{1,3}\s+(?=["'“‘(]*[A-Za-z]))/gm;

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
            <span class="modal-eyebrow">Simple Copy-Paste &amp; BibleGateway Editor</span>
            <h2 id="add-passage-title" class="modal-title">Add Passage</h2>
            <p class="modal-subtitle">
              Look up any passage directly on <strong>BibleGateway</strong> (with 1-click Copy &amp;
              Import) or paste text into the plain text box below.
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
              <label for="input-reference" class="field-label">
                Passage Reference
              </label>
              <input
                id="input-reference"
                type="text"
                class="text-input"
                placeholder="e.g. Isaiah 40:28-31 or Romans 8:38-9:2"
                [ngModel]="reference()"
                (ngModelChange)="onReferenceChange($event)"
                (keydown.enter)="onReferenceEnter($event)"
                data-testid="input-passage-reference"
              />
            </div>

            <div class="field-group bg-version-group">
              <label for="select-bg-version" class="field-label">
                Translation
              </label>
              <select
                id="select-bg-version"
                class="version-select"
                [ngModel]="selectedVersion()"
                (ngModelChange)="onVersionChange($event)"
                data-testid="select-bg-version"
              >
                @for (ver of bibleVersions; track ver.code) {
                  <option [value]="ver.code">{{ ver.label }}</option>
                }
              </select>
            </div>

            <div class="bg-lookup-action-wrap">
              <button
                id="btn-open-biblegateway"
                type="button"
                class="bg-lookup-btn"
                [disabled]="!reference().trim()"
                (click)="openBibleGatewayLookup()"
                data-testid="btn-open-biblegateway"
              >
                🌐 Look Up on BibleGateway
              </button>

              <button
                type="button"
                class="example-btn"
                (click)="pasteExample()"
                data-testid="btn-paste-example"
              >
                ✦ Paste Example
              </button>
            </div>
          </div>

          <div class="field-group">
            <div class="textarea-toolbar">
              <label for="passage-raw-textarea" class="field-label">
                Passage Text
                <span class="field-hint">
                  @if (hasRememberedBoundaries()) {
                    (Verse boundaries remembered — verses separated cleanly)
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
              placeholder="Paste or type your passage here (or use 🌐 Look Up on BibleGateway above)...&#10;[28] Have you not known? Have you not heard?...&#10;[29] He gives power to the faint..."
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
                accumulative stitching. Tip: Look up the passage via
                <strong>🌐 Look Up on BibleGateway</strong> or paste text with verse numbers included
                and click <strong>Highlight Verse Numbers → Remove</strong>.
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
                    <span class="verse-num-pill">[{{ getVerseBadge(verse) }}]</span>
                    <span class="verse-text-body">{{ verse.text }}</span>
                  </li>
                }
              </ul>
            } @else {
              <div class="preview-empty">
                Enter a reference and click <strong>🌐 Look Up on BibleGateway</strong>, or paste text above.
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

        <!-- ======================================================================= -->
        <!-- IN-APP BIBLEGATEWAY OVERLAY (Remember Me style with bottom-right FAB)   -->
        <!-- ======================================================================= -->
        @if (isBibleGatewayOpen()) {
          <section
            id="biblegateway-overlay"
            class="bg-overlay"
            role="dialog"
            aria-modal="true"
            aria-label="BibleGateway Passage Lookup"
            data-testid="biblegateway-overlay"
          >
            <header class="bg-overlay-topbar">
              <div class="bg-overlay-title-wrap">
                <span class="bg-brand-pill">📖 BibleGateway</span>
                <strong class="bg-ref-title">
                  {{ bgLookupResult()?.canonicalReference || reference().trim() }}
                </strong>
                <span class="bg-version-badge">{{ selectedVersion() }}</span>
              </div>

              <div class="bg-overlay-top-actions">
                <a
                  class="bg-external-link"
                  [href]="externalBibleGatewayUrl()"
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid="link-external-biblegateway"
                >
                  ↗ Open on biblegateway.com
                </a>

                <button
                  id="btn-close-biblegateway"
                  type="button"
                  class="bg-close-btn"
                  (click)="closeBibleGatewayOverlay()"
                  aria-label="Close BibleGateway overlay"
                  data-testid="btn-close-biblegateway"
                >
                  ✕ Close
                </button>
              </div>
            </header>

            <div class="bg-overlay-body">
              @if (bgIsLoading()) {
                <div
                  id="bg-loading-state"
                  class="bg-state-card bg-loading-card"
                  data-testid="bg-loading-state"
                >
                  <div class="bg-spinner" aria-hidden="true"></div>
                  <h4>Fetching "{{ reference().trim() }}" ({{ selectedVersion() }}) from BibleGateway...</h4>
                  <p>Extracting clean verses and chapter/verse boundaries...</p>
                </div>
              } @else if (bgError()) {
                <div
                  id="bg-error-state"
                  class="bg-state-card bg-error-card"
                  role="alert"
                  data-testid="bg-error-state"
                >
                  <strong class="bg-error-title">⚠️ BibleGateway Lookup Error</strong>
                  <p class="bg-error-message">{{ bgError() }}</p>
                  <div class="bg-error-actions">
                    <button
                      type="button"
                      class="bg-retry-btn"
                      (click)="openBibleGatewayLookup()"
                      data-testid="btn-retry-biblegateway"
                    >
                      ↻ Retry Lookup
                    </button>
                    <a
                      class="bg-external-link"
                      [href]="externalBibleGatewayUrl()"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      ↗ Open directly on biblegateway.com
                    </a>
                  </div>
                </div>
              } @else if (bgLookupResult()) {
                @let result = bgLookupResult()!;
                <div
                  id="bg-passage-content"
                  class="bg-passage-reader"
                  data-testid="bg-passage-content"
                >
                  <div class="bg-reader-meta">
                    <span class="bg-reader-ref">{{ result.canonicalReference }} ({{ result.version }})</span>
                    <span class="bg-reader-count">
                      {{ result.verses.length }} {{ result.verses.length === 1 ? 'verse' : 'verses' }} detected
                    </span>
                  </div>

                  <div class="bg-rendered-html" [innerHTML]="result.rawHtml"></div>

                  <div class="bg-structured-verses-preview">
                    <span class="bg-structured-label">Extracted Verses Ready for 1-Click Import:</span>
                    <ul class="bg-extracted-list">
                      @for (v of result.verses; track $index) {
                        <li>
                          <strong class="bg-verse-chip">[{{ getBgVerseBadge(v, result.verses) }}]</strong>
                          <span>{{ v.text }}</span>
                        </li>
                      }
                    </ul>
                  </div>
                </div>

                <!-- Floating Bottom-Right 1-Click Copy & Import Action Button -->
                <button
                  id="btn-bg-copy-import"
                  type="button"
                  class="bg-fab-copy-import"
                  (click)="copyAndImportFromBibleGateway()"
                  data-testid="btn-bg-copy-import"
                >
                  📋 Copy &amp; Import Passage ({{ result.verses.length }}
                  {{ result.verses.length === 1 ? 'verse' : 'verses' }})
                </button>
              }
            </div>
          </section>
        }
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

      :host-context(.light-theme),
      :host-context(html:not(.dark-theme)) {
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
        position: relative;
        width: 100%;
        max-width: 780px;
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

      :host-context(.light-theme) .modal-eyebrow,
      :host-context(html:not(.dark-theme)) .modal-eyebrow {
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
        gap: 0.75rem;
        flex-wrap: wrap;
      }

      .flex-1 {
        flex: 1 1 220px;
      }

      .bg-version-group {
        flex: 0 1 155px;
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

      :host-context(.light-theme) .highlight-trigger-btn,
      :host-context(html:not(.dark-theme)) .highlight-trigger-btn {
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
      .version-select,
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
      .version-select:focus,
      .raw-textarea:focus {
        outline: none;
        border-color: #14b8a6;
        box-shadow: 0 0 0 3px rgba(20, 184, 166, 0.2);
      }

      .bg-lookup-action-wrap {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        flex-wrap: wrap;
      }

      .bg-lookup-btn {
        padding: 0.65rem 1rem;
        border-radius: 0.6rem;
        border: 1px solid #0d9488;
        background: linear-gradient(135deg, #0d9488 0%, #0f766e 100%);
        color: #ffffff;
        font-size: 0.85rem;
        font-weight: 700;
        cursor: pointer;
        white-space: nowrap;
        transition: all 0.15s ease;
        box-shadow: 0 4px 12px rgba(13, 148, 136, 0.28);
      }

      .bg-lookup-btn:hover:not(:disabled) {
        filter: brightness(1.08);
      }

      .bg-lookup-btn:disabled {
        opacity: 0.45;
        cursor: not-allowed;
        box-shadow: none;
      }

      .example-btn {
        padding: 0.65rem 0.85rem;
        border-radius: 0.6rem;
        border: 1px solid rgba(245, 158, 11, 0.5);
        background: rgba(245, 158, 11, 0.16);
        color: #fde68a;
        font-size: 0.82rem;
        font-weight: 600;
        cursor: pointer;
        white-space: nowrap;
        transition: all 0.15s ease;
      }

      :host-context(.light-theme) .example-btn,
      :host-context(html:not(.dark-theme)) .example-btn {
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

      :host-context(.light-theme) .missing-verse-nums-warning,
      :host-context(html:not(.dark-theme)) .missing-verse-nums-warning {
        background: #fffbeb;
      }

      .warning-title {
        font-size: 0.84rem;
        color: #fcd34d;
      }

      :host-context(.light-theme) .warning-title,
      :host-context(html:not(.dark-theme)) .warning-title {
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

      :host-context(.light-theme) .highlight-preview-box,
      :host-context(html:not(.dark-theme)) .highlight-preview-box {
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

      :host-context(.light-theme) .highlight-badge,
      :host-context(html:not(.dark-theme)) .highlight-badge {
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

      :host-context(.light-theme) .highlighted-verse-num,
      :host-context(html:not(.dark-theme)) .highlighted-verse-num {
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

      :host-context(.light-theme) .preview-badge,
      :host-context(html:not(.dark-theme)) .preview-badge {
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

      :host-context(.light-theme) .remembered-boundary-pill,
      :host-context(html:not(.dark-theme)) .remembered-boundary-pill {
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

      :host-context(.light-theme) .verse-num-pill,
      :host-context(html:not(.dark-theme)) .verse-num-pill {
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

      /* ===================================================================== */
      /* In-App BibleGateway Overlay                                           */
      /* ===================================================================== */
      .bg-overlay {
        position: absolute;
        inset: 0;
        background: var(--modal-bg);
        z-index: 50;
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }

      .bg-overlay-topbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.85rem;
        flex-wrap: wrap;
        padding: 0.95rem 1.35rem;
        background: var(--modal-header-bg);
        border-bottom: 1px solid var(--border-color);
      }

      .bg-overlay-title-wrap {
        display: flex;
        align-items: center;
        gap: 0.6rem;
        flex-wrap: wrap;
      }

      .bg-brand-pill {
        font-size: 0.75rem;
        font-weight: 700;
        padding: 0.22rem 0.6rem;
        border-radius: 999px;
        background: rgba(13, 148, 136, 0.22);
        color: #5eead4;
        border: 1px solid rgba(20, 184, 166, 0.4);
      }

      :host-context(.light-theme) .bg-brand-pill,
      :host-context(html:not(.dark-theme)) .bg-brand-pill {
        background: #ccfbf1;
        color: #115e59;
      }

      .bg-ref-title {
        font-size: 1rem;
        font-weight: 700;
        color: var(--text-primary);
      }

      .bg-version-badge {
        font-size: 0.72rem;
        font-weight: 700;
        padding: 0.16rem 0.5rem;
        border-radius: 0.35rem;
        background: var(--input-bg);
        border: 1px solid var(--border-color);
        color: var(--text-secondary);
      }

      .bg-overlay-top-actions {
        display: flex;
        align-items: center;
        gap: 0.75rem;
      }

      .bg-external-link {
        font-size: 0.8rem;
        font-weight: 600;
        color: #2dd4bf;
        text-decoration: none;
      }

      :host-context(.light-theme) .bg-external-link,
      :host-context(html:not(.dark-theme)) .bg-external-link {
        color: #0f766e;
      }

      .bg-external-link:hover {
        text-decoration: underline;
      }

      .bg-close-btn {
        padding: 0.4rem 0.75rem;
        border-radius: 0.5rem;
        border: 1px solid var(--border-color);
        background: var(--input-bg);
        color: var(--text-primary);
        font-size: 0.8rem;
        font-weight: 600;
        cursor: pointer;
      }

      .bg-overlay-body {
        position: relative;
        flex: 1;
        overflow-y: auto;
        padding: 1.25rem 1.5rem 5.5rem;
        display: flex;
        flex-direction: column;
        gap: 1rem;
      }

      .bg-state-card {
        margin: auto;
        max-width: 480px;
        width: 100%;
        padding: 1.75rem 1.5rem;
        border-radius: 0.85rem;
        border: 1px solid var(--border-color);
        background: var(--modal-header-bg);
        text-align: center;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.65rem;
      }

      .bg-spinner {
        width: 2rem;
        height: 2rem;
        border-radius: 50%;
        border: 3px solid var(--border-color);
        border-top-color: #14b8a6;
        animation: bg-spin 0.8s linear infinite;
      }

      @keyframes bg-spin {
        to {
          transform: rotate(360deg);
        }
      }

      .bg-error-card {
        border-color: rgba(239, 68, 68, 0.55);
        background: rgba(127, 29, 29, 0.25);
      }

      :host-context(.light-theme) .bg-error-card,
      :host-context(html:not(.dark-theme)) .bg-error-card {
        background: #fef2f2;
        border-color: #fca5a5;
      }

      .bg-error-title {
        font-size: 0.95rem;
        color: #fca5a5;
      }

      :host-context(.light-theme) .bg-error-title,
      :host-context(html:not(.dark-theme)) .bg-error-title {
        color: #b91c1c;
      }

      .bg-error-message {
        margin: 0;
        font-size: 0.85rem;
        color: var(--text-secondary);
        line-height: 1.45;
      }

      .bg-error-actions {
        display: flex;
        align-items: center;
        gap: 0.85rem;
        margin-top: 0.4rem;
      }

      .bg-retry-btn {
        padding: 0.45rem 0.9rem;
        border-radius: 0.5rem;
        border: 1px solid #0d9488;
        background: #0d9488;
        color: #ffffff;
        font-size: 0.82rem;
        font-weight: 600;
        cursor: pointer;
      }

      .bg-passage-reader {
        display: flex;
        flex-direction: column;
        gap: 1rem;
      }

      .bg-reader-meta {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.75rem;
        flex-wrap: wrap;
        padding-bottom: 0.55rem;
        border-bottom: 1px solid var(--border-color);
      }

      .bg-reader-ref {
        font-size: 1.05rem;
        font-weight: 700;
        color: var(--text-primary);
      }

      .bg-reader-count {
        font-size: 0.8rem;
        font-weight: 600;
        color: #2dd4bf;
      }

      :host-context(.light-theme) .bg-reader-count,
      :host-context(html:not(.dark-theme)) .bg-reader-count {
        color: #0f766e;
      }

      .bg-rendered-html {
        padding: 1rem 1.15rem;
        border-radius: 0.75rem;
        border: 1px solid var(--border-color);
        background: var(--input-bg);
        color: var(--text-primary);
        font-size: 0.95rem;
        line-height: 1.7;
      }

      .bg-structured-verses-preview {
        padding: 0.85rem 1rem;
        border-radius: 0.75rem;
        border: 1px solid var(--border-color);
        background: var(--modal-header-bg);
        display: flex;
        flex-direction: column;
        gap: 0.55rem;
      }

      .bg-structured-label {
        font-size: 0.76rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--text-muted);
      }

      .bg-extracted-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 0.4rem;
      }

      .bg-extracted-list li {
        font-size: 0.85rem;
        line-height: 1.45;
        color: var(--text-primary);
        display: flex;
        align-items: flex-start;
        gap: 0.5rem;
      }

      .bg-verse-chip {
        color: #2dd4bf;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        font-size: 0.78rem;
        flex-shrink: 0;
      }

      :host-context(.light-theme) .bg-verse-chip,
      :host-context(html:not(.dark-theme)) .bg-verse-chip {
        color: #0f766e;
      }

      .bg-fab-copy-import {
        position: fixed;
        right: 2.25rem;
        bottom: 2.25rem;
        z-index: 60;
        padding: 0.85rem 1.35rem;
        border-radius: 999px;
        border: 1px solid #14b8a6;
        background: linear-gradient(135deg, #0d9488 0%, #0f766e 100%);
        color: #ffffff;
        font-size: 0.92rem;
        font-weight: 700;
        cursor: pointer;
        box-shadow: 0 14px 32px rgba(13, 148, 136, 0.48);
        transition: transform 0.15s ease, box-shadow 0.15s ease;
      }

      .bg-fab-copy-import:hover {
        transform: translateY(-2px);
        box-shadow: 0 18px 36px rgba(13, 148, 136, 0.6);
      }
    `,
  ],
})
export class AddPassageModalComponent {
  private readonly passageParser = inject(PassageParserService);
  private readonly storageService = inject(StorageService);
  private readonly bibleGatewayService = inject(BibleGatewayService);

  @Output() closed = new EventEmitter<void>();
  @Output() passageAdded = new EventEmitter<DeckItem>();

  readonly bibleVersions: BibleVersionOption[] = BIBLE_VERSIONS;

  readonly reference = signal<string>('');
  readonly rawText = signal<string>('');
  readonly selectedVersion = signal<string>(this.loadSavedVersion());

  readonly isHighlightingVerseNumbers = signal<boolean>(false);
  readonly highlightStep = signal<'idle' | 'highlighted' | 'removed'>('idle');

  readonly lockedVerses = signal<Verse[] | null>(null);
  readonly rememberedVerseNumbers = signal<number[]>([]);
  readonly rememberedChapterNumbers = signal<(number | undefined)[]>([]);

  readonly isBibleGatewayOpen = signal<boolean>(false);
  readonly bgIsLoading = signal<boolean>(false);
  readonly bgError = signal<string | null>(null);
  readonly bgLookupResult = signal<BibleGatewayLookupResult | null>(null);

  readonly externalBibleGatewayUrl = computed<string>(() =>
    this.bibleGatewayService.buildSourceUrl(this.reference() || 'Isaiah 40:28-31', this.selectedVersion())
  );

  readonly hasRememberedBoundaries = computed<boolean>(
    () =>
      this.rememberedVerseNumbers().length > 0 ||
      (this.lockedVerses()?.length ?? 0) > 0 ||
      this.highlightStep() === 'removed'
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

      const parsedToken = this.parseVerseNumberToken(matchText, fallbackNum);
      segments.push({
        type: 'verse-num',
        value: matchText,
        verseNumber: parsedToken.verseNumber,
        chapterNumber: parsedToken.chapterNumber,
      });
      fallbackNum = parsedToken.verseNumber + 1;

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
      !this.hasRememberedBoundaries()
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

    const locked = this.lockedVerses();
    if (locked && locked.length > 0) {
      return {
        reference: ref || this.formatDefaultReference(locked),
        verses: locked,
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
    const rememberedChaps = this.rememberedChapterNumbers();
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
      const verses: Verse[] = blocks.map((blockText, idx) => {
        const chap = rememberedChaps[idx];
        return {
          verseNumber: rememberedNums[idx] ?? startVerse + idx,
          text: blockText.replace(/[ \t]+/g, ' ').trim(),
          ...(chap && chap > 0 ? { chapterNumber: chap } : {}),
        };
      });

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

  readonly isMultiChapter = computed<boolean>(() =>
    isMultiChapterPassage(this.parsedResult().verses)
  );

  readonly canSave = computed<boolean>(() => {
    return this.parsedResult().verses.length > 0;
  });

  getVerseBadge(verse: Verse): string {
    return formatVerseBadge(verse, this.isMultiChapter());
  }

  getBgVerseBadge(verse: Verse, allVerses: Verse[]): string {
    return formatVerseBadge(verse, isMultiChapterPassage(allVerses));
  }

  onReferenceChange(value: string): void {
    this.reference.set(value);
  }

  onReferenceEnter(event: Event): void {
    if (!this.rawText().trim() && this.reference().trim()) {
      event.preventDefault();
      void this.openBibleGatewayLookup();
    }
  }

  onVersionChange(versionCode: string): void {
    const clean = (versionCode || 'ESV').trim().toUpperCase();
    this.selectedVersion.set(clean);
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(BG_VERSION_STORAGE_KEY, clean);
      }
    } catch {
      // Ignore localStorage errors in restricted environments
    }
  }

  async openBibleGatewayLookup(): Promise<void> {
    const ref = this.reference().trim();
    if (!ref) {
      return;
    }

    this.isBibleGatewayOpen.set(true);
    this.bgIsLoading.set(true);
    this.bgError.set(null);
    this.bgLookupResult.set(null);

    try {
      const result = await this.bibleGatewayService.fetchPassage(ref, this.selectedVersion());
      this.bgLookupResult.set(result);
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : 'Failed to fetch passage from BibleGateway. Please check your reference or connection.';
      this.bgError.set(message);
    } finally {
      this.bgIsLoading.set(false);
    }
  }

  closeBibleGatewayOverlay(): void {
    this.isBibleGatewayOpen.set(false);
  }

  async copyAndImportFromBibleGateway(): Promise<void> {
    const result = this.bgLookupResult();
    if (!result) {
      return;
    }

    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(result.cleanPlainText);
      }
    } catch {
      // Gracefully ignore clipboard permission errors in headless browsers
    }

    this.reference.set(result.canonicalReference || this.reference());
    this.rawText.set(result.cleanPlainText);
    this.lockedVerses.set(result.verses);
    this.rememberedVerseNumbers.set(result.verses.map((v) => v.verseNumber));
    this.rememberedChapterNumbers.set(result.verses.map((v) => v.chapterNumber));
    this.highlightStep.set('removed');
    this.isHighlightingVerseNumbers.set(false);
    this.isBibleGatewayOpen.set(false);
  }

  onRawTextChange(value: string): void {
    this.rawText.set(value);
    this.lockedVerses.set(null);
    if (!value.trim()) {
      this.rememberedVerseNumbers.set([]);
      this.rememberedChapterNumbers.set([]);
      this.highlightStep.set('idle');
    }
  }

  startHighlightVerseNumbers(): void {
    this.isHighlightingVerseNumbers.set(true);
    this.highlightStep.set('highlighted');
  }

  cancelHighlightVerseNumbers(): void {
    this.isHighlightingVerseNumbers.set(false);
    this.highlightStep.set(this.rememberedVerseNumbers().length > 0 ? 'removed' : 'idle');
  }

  removeHighlightedVerseNumbers(): void {
    const verses = this.extractVersesFromSegments(this.highlightSegments());
    if (verses.length === 0) {
      this.isHighlightingVerseNumbers.set(false);
      return;
    }

    this.lockedVerses.set(verses);
    this.rememberedVerseNumbers.set(verses.map((v) => v.verseNumber));
    this.rememberedChapterNumbers.set(verses.map((v) => v.chapterNumber));
    const cleanedTextWithBoundaries = verses.map((v) => v.text).join('\n\n');

    this.rawText.set(cleanedTextWithBoundaries);
    this.isHighlightingVerseNumbers.set(false);
    this.highlightStep.set('removed');
  }

  pasteExample(): void {
    this.reference.set(ISAIAH_40_EXAMPLE_REF);
    this.rawText.set(ISAIAH_40_EXAMPLE_RAW);
    this.lockedVerses.set(null);
    this.rememberedVerseNumbers.set([]);
    this.rememberedChapterNumbers.set([]);
    this.highlightStep.set('idle');
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

  private loadSavedVersion(): string {
    try {
      if (typeof localStorage !== 'undefined') {
        const saved = localStorage.getItem(BG_VERSION_STORAGE_KEY);
        if (saved && saved.trim()) {
          return saved.trim().toUpperCase();
        }
      }
    } catch {
      // Ignore storage access errors
    }
    return 'ESV';
  }

  private extractVersesFromSegments(segments: HighlightSegment[]): Verse[] {
    const verses: Verse[] = [];
    const startVerse = this.inferStartVerseNumber();

    let currentVerseNumber: number | null = null;
    let currentChapterNumber: number | undefined = undefined;
    let currentChunks: string[] = [];

    for (const seg of segments) {
      if (seg.type === 'verse-num') {
        if (currentVerseNumber !== null) {
          const text = this.cleanVerseChunk(currentChunks.join(''));
          if (text) {
            verses.push({
              verseNumber: currentVerseNumber,
              text,
              ...(currentChapterNumber ? { chapterNumber: currentChapterNumber } : {}),
            });
          }
        } else if (currentChunks.length > 0) {
          const leadingText = this.cleanVerseChunk(currentChunks.join(''));
          if (leadingText) {
            const firstMarkerNum = seg.verseNumber ?? startVerse;
            const inferredLeadingNum = firstMarkerNum > 1 ? firstMarkerNum - 1 : startVerse;
            verses.push({
              verseNumber: inferredLeadingNum,
              text: leadingText,
              ...(seg.chapterNumber ? { chapterNumber: seg.chapterNumber } : {}),
            });
          }
        }

        currentVerseNumber = seg.verseNumber ?? startVerse + verses.length;
        currentChapterNumber = seg.chapterNumber;
        currentChunks = [];
      } else {
        currentChunks.push(seg.value);
      }
    }

    if (currentVerseNumber !== null && currentChunks.length > 0) {
      const text = this.cleanVerseChunk(currentChunks.join(''));
      if (text) {
        verses.push({
          verseNumber: currentVerseNumber,
          text,
          ...(currentChapterNumber ? { chapterNumber: currentChapterNumber } : {}),
        });
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

  private parseVerseNumberToken(
    token: string,
    fallback: number
  ): { verseNumber: number; chapterNumber?: number } {
    const normalized = token
      .split('')
      .map((ch) => SUPERSCRIPT_DIGIT_MAP[ch] ?? ch)
      .join('');

    const chapVerseMatch = normalized.match(/(\d{1,3}):(\d{1,3})/);
    if (chapVerseMatch) {
      const chap = parseInt(chapVerseMatch[1], 10);
      const vNum = parseInt(chapVerseMatch[2], 10);
      if (!isNaN(chap) && !isNaN(vNum) && vNum > 0) {
        return { verseNumber: vNum, chapterNumber: chap };
      }
    }

    const match = normalized.match(/\d{1,3}/);
    if (!match) {
      return { verseNumber: fallback };
    }
    const num = parseInt(match[0], 10);
    return { verseNumber: !isNaN(num) && num > 0 ? num : fallback };
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
