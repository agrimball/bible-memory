import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  OnInit,
  Output,
  SimpleChanges,
  computed,
  inject,
  signal,
} from '@angular/core';
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
import * as pb from '../../core/proto/bible_memory.pb';
import {
  Passage,
  Verse,
  formatVerseBadge,
  isMultiChapterPassage,
} from '../../core/proto/bible_memory.pb';

const BG_VERSION_STORAGE_KEY = 'selah_bg_version_v1';

const VERSE_MARKER_CHECK_REGEX =
  /(\[\d{1,3}(?::\d{1,3})?\]|\(\d{1,3}(?::\d{1,3})?\)|[⁰¹²³⁴⁵⁶⁷⁸⁹]+|(?:^|(?<=\s))\d{1,3}(?::\d{1,3})?\s+(?=["'“‘(]*[A-Za-z]))/m;

export interface RecitationTimeEstimate {
  wordCount: number;
  seconds: number;
  label: string;
  isLong: boolean;
}

type AppendCapableStorageService = StorageService & {
  appendVersesToPassage?: (
    passageId: string,
    versesToAppend: Verse[],
    updatedReference?: string
  ) => Passage | DeckItem | undefined;
};

function computeRecitationEstimate(verses: Verse[]): RecitationTimeEstimate {
  const pbWithHelper = pb as unknown as {
    estimateRecitationTime?: (v: Verse[]) => RecitationTimeEstimate;
  };
  if (typeof pbWithHelper.estimateRecitationTime === 'function') {
    return pbWithHelper.estimateRecitationTime(verses);
  }
  const wordCount = (verses ?? []).reduce((sum, v) => {
    const words = (v.text ?? '')
      .trim()
      .split(/\s+/)
      .filter((w) => w.length > 0);
    return sum + words.length;
  }, 0);
  const seconds = wordCount === 0 ? 0 : Math.max(5, Math.round((wordCount / 135) * 60));
  let label = '~0s';
  if (seconds > 0 && seconds < 60) {
    const rounded5 = Math.max(5, Math.round(seconds / 5) * 5);
    label = `~${rounded5}s`;
  } else if (seconds >= 60) {
    const mins = Math.round((seconds / 60) * 2) / 2;
    label = `~${mins} min`;
  }
  const isLong = (verses?.length ?? 0) > 10 || wordCount > 180;
  return { wordCount, seconds, label, isLong };
}

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
          <h2 id="add-passage-title" class="modal-title">
            @if (isAppendMode()) {
              Append to {{ getTargetAppendingPassage()!.reference }}
            } @else if (isEditMode()) {
              Edit Passage
            } @else {
              Add Passage
            }
          </h2>
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
                {{ isAppendMode() ? 'Verses to Append' : 'Reference' }}
              </label>
              <input
                id="input-reference"
                type="text"
                class="text-input compact-control"
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
                class="version-select compact-control"
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
                class="bg-lookup-btn compact-control"
                [disabled]="!reference().trim()"
                (click)="openBibleGatewayLookup()"
                data-testid="btn-open-biblegateway"
              >
                🌐 BibleGateway
              </button>
            </div>
          </div>

          <!-- Optional Custom Label / Memory Cue Input -->
          @if (!isAppendMode()) {
            <div class="field-group">
              <label for="input-passage-label" class="field-label">
                Label (optional)
              </label>
              <input
                id="input-passage-label"
                type="text"
                class="text-input compact-control"
                placeholder="e.g. Beatitudes, or custom cue shown next to reference"
                [ngModel]="label()"
                (ngModelChange)="label.set($event)"
                data-testid="input-passage-label"
              />
            </div>
          }

          <div class="field-group passage-text-group">
            <div class="textarea-toolbar">
              <label for="textarea-passage" class="field-label">
                {{ isAppendMode() ? 'New Verses Text' : 'Passage Text' }}
              </label>

              @if (parsedResult().verses.length > 0) {
                <span class="recitation-time-pill" data-testid="add-passage-recitation-time">
                  ⏱ {{ recitationTime().label }} ({{ recitationTime().wordCount }} words)
                </span>
              }
            </div>

            <textarea
              id="textarea-passage"
              rows="9"
              class="raw-textarea"
              placeholder="Paste or type your passage here (or use 🌐 BibleGateway above)...&#10;[28] Have you not known? Have you not heard?...&#10;[29] He gives power to the faint..."
              [ngModel]="rawText()"
              (ngModelChange)="onTextChange($event)"
              data-testid="textarea-passage-raw"
            ></textarea>
          </div>

          @if (showMissingVerseNumbersWarning()) {
            <div
              id="warning-no-verse-numbers"
              class="missing-verse-nums-warning"
              role="alert"
              data-testid="warning-no-verse-numbers"
            >
              <strong class="warning-title">⚠️ No verse numbers detected</strong>
              <p class="warning-body">
                This text doesn't contain verse numbers (e.g. <code>[1]</code>, <code>2 </code>, or
                <code>¹²³</code>), so verse boundaries aren't marked for <code>+1v</code> study and
                accumulative stitching. Tip: Look up the passage via
                <strong>🌐 BibleGateway</strong> or include verse numbers in your pasted text.
              </p>
            </div>
          }

          <!-- Subtle, collapsed-by-default "Peek beneath the covers" disclosure for verse boundaries -->
          <div class="peek-boundaries-container">
            <button
              id="btn-peek-verse-boundaries"
              type="button"
              class="peek-boundaries-btn"
              (click)="toggleVerseBoundaries()"
              [attr.aria-expanded]="showVerseBoundaries()"
              data-testid="btn-peek-verse-boundaries"
            >
              <span>
                {{ showVerseBoundaries() ? '▾ Hide verse boundaries' : '▸ Peek verse boundaries' }}
                ({{ parsedResult().verses.length }}
                {{ parsedResult().verses.length === 1 ? 'verse' : 'verses' }})
              </span>
              @if ((lockedVerses()?.length ?? 0) > 0) {
                <span
                  class="remembered-boundary-pill"
                  data-testid="remembered-boundaries-badge"
                >
                  ✓ Exact verse boundaries
                </span>
              }
            </button>

            @if (showVerseBoundaries()) {
              <section
                id="parsed-verses-preview"
                class="preview-panel"
                data-testid="parsed-verses-preview"
              >
                <div class="preview-header">
                  <div class="preview-title-group">
                    <span class="preview-badge">
                      Verses ({{ parsedResult().verses.length }})
                    </span>
                    <span class="preview-ref">{{ parsedResult().reference }}</span>
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
                    Enter a reference and click <strong>🌐 BibleGateway</strong>, or paste text above.
                  </div>
                }
              </section>
            }
          </div>
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
            @if (isAppendMode()) {
              Append Verses
            } @else if (isEditMode()) {
              Save Changes
            } @else {
              Save Passage to Deck
            }
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
                </div>

                <!-- Floating Bottom-Right 1-Click Import Action Button -->
                <button
                  id="btn-bg-copy-import"
                  type="button"
                  class="bg-fab-copy-import"
                  (click)="copyAndImportFromBibleGateway()"
                  data-testid="btn-bg-copy-import"
                >
                  📋 Import Passage ({{ result.verses.length }}
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
        padding: 0.75rem;
        z-index: 100;
      }

      .modal-card {
        position: relative;
        width: 100%;
        max-width: 780px;
        max-height: 94vh;
        background: var(--modal-bg);
        border: 1px solid var(--border-color);
        border-radius: 0.9rem;
        box-shadow: 0 24px 48px rgba(0, 0, 0, 0.45);
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }

      .modal-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.75rem;
        padding: 0.75rem 1.15rem;
        border-bottom: 1px solid var(--border-color);
        background: var(--modal-header-bg);
        flex-shrink: 0;
      }

      .modal-title {
        margin: 0;
        font-size: 1.1rem;
        font-weight: 700;
        color: var(--text-primary);
      }

      .icon-close-btn {
        background: transparent;
        border: 1px solid var(--border-color);
        border-radius: 0.45rem;
        width: 1.85rem;
        height: 1.85rem;
        font-size: 0.85rem;
        color: var(--text-secondary);
        cursor: pointer;
        flex-shrink: 0;
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }

      .icon-close-btn:hover {
        background: rgba(255, 255, 255, 0.08);
        color: var(--text-primary);
      }

      .modal-body {
        padding: 0.85rem 1.15rem;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 8px;
        flex: 1;
      }

      .form-row-top {
        display: flex;
        align-items: flex-end;
        gap: 8px;
        flex-wrap: wrap;
      }

      .flex-1 {
        flex: 1 1 200px;
      }

      .bg-version-group {
        flex: 0 1 135px;
      }

      .field-group {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .passage-text-group {
        flex: 1;
        display: flex;
        flex-direction: column;
        min-height: 250px;
      }

      .textarea-toolbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        flex-wrap: wrap;
      }

      .field-label {
        font-size: 0.76rem;
        font-weight: 600;
        color: var(--text-secondary);
        display: flex;
        align-items: baseline;
        gap: 0.35rem;
        flex-wrap: wrap;
      }

      .recitation-time-pill {
        font-size: 0.72rem;
        font-weight: 600;
        padding: 0.12rem 0.5rem;
        border-radius: 999px;
        background: var(--modal-header-bg);
        border: 1px solid var(--border-color);
        color: var(--text-secondary);
      }

      .text-input,
      .version-select,
      .raw-textarea {
        width: 100%;
        box-sizing: border-box;
        border-radius: 0.5rem;
        border: 1px solid var(--border-color);
        background: var(--input-bg);
        color: var(--text-primary);
        font-family: inherit;
        transition: border-color 0.15s ease, box-shadow 0.15s ease;
      }

      .compact-control {
        height: 36px;
        padding: 6px 10px;
        font-size: 0.88rem;
      }

      .raw-textarea {
        flex: 1;
        min-height: 220px;
        padding: 0.65rem 0.8rem;
        font-size: 0.92rem;
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
        gap: 8px;
      }

      .bg-lookup-btn {
        height: 36px;
        padding: 6px 12px;
        border-radius: 0.5rem;
        border: 1px solid #0d9488;
        background: linear-gradient(135deg, #0d9488 0%, #0f766e 100%);
        color: #ffffff;
        font-size: 0.84rem;
        font-weight: 700;
        cursor: pointer;
        white-space: nowrap;
        transition: all 0.15s ease;
        box-shadow: 0 2px 8px rgba(13, 148, 136, 0.24);
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }

      .bg-lookup-btn:hover:not(:disabled) {
        filter: brightness(1.08);
      }

      .bg-lookup-btn:disabled {
        opacity: 0.45;
        cursor: not-allowed;
        box-shadow: none;
      }

      .missing-verse-nums-warning {
        background: rgba(120, 53, 15, 0.35);
        border: 1px solid rgba(245, 158, 11, 0.5);
        border-left: 4px solid #f59e0b;
        border-radius: 0.6rem;
        padding: 0.65rem 0.85rem;
        display: flex;
        flex-direction: column;
        gap: 0.4rem;
      }

      :host-context(.light-theme) .missing-verse-nums-warning,
      :host-context(html:not(.dark-theme)) .missing-verse-nums-warning {
        background: #fffbeb;
      }

      .warning-title {
        font-size: 0.82rem;
        color: #fcd34d;
      }

      :host-context(.light-theme) .warning-title,
      :host-context(html:not(.dark-theme)) .warning-title {
        color: #92400e;
      }

      .warning-body {
        margin: 0;
        font-size: 0.78rem;
        color: var(--text-secondary);
        line-height: 1.4;
      }

      .warning-body code {
        background: rgba(245, 158, 11, 0.2);
        padding: 0.06rem 0.28rem;
        border-radius: 0.25rem;
        font-weight: 600;
      }

      .peek-boundaries-container {
        display: flex;
        flex-direction: column;
        gap: 0.45rem;
      }

      .peek-boundaries-btn {
        align-self: flex-start;
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.32rem 0.65rem;
        border-radius: 0.45rem;
        border: 1px solid var(--border-color);
        background: var(--modal-header-bg);
        color: var(--text-secondary);
        font-size: 0.76rem;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.15s ease;
      }

      .peek-boundaries-btn:hover {
        color: var(--text-primary);
        border-color: #14b8a6;
      }

      .preview-panel {
        border: 1px solid var(--border-color);
        border-radius: 0.65rem;
        background: var(--modal-header-bg);
        padding: 0.75rem 0.95rem;
      }

      .preview-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.65rem;
        flex-wrap: wrap;
        margin-bottom: 0.5rem;
        padding-bottom: 0.45rem;
        border-bottom: 1px solid var(--border-color);
      }

      .preview-title-group {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        flex-wrap: wrap;
      }

      .preview-badge {
        font-size: 0.7rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        padding: 0.16rem 0.48rem;
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
        font-size: 0.7rem;
        font-weight: 600;
        padding: 0.12rem 0.48rem;
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
        font-size: 0.9rem;
        font-weight: 700;
        color: var(--text-primary);
      }

      .preview-count {
        font-size: 0.75rem;
        color: var(--text-muted);
      }

      .parsed-verse-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 0.4rem;
        max-height: 150px;
        overflow-y: auto;
      }

      .parsed-verse-item {
        display: flex;
        align-items: flex-start;
        gap: 0.5rem;
        padding: 0.4rem 0.6rem;
        border-radius: 0.45rem;
        background: var(--modal-bg);
        border: 1px solid var(--border-color);
        font-size: 0.82rem;
        line-height: 1.4;
      }

      .verse-num-pill {
        font-weight: 700;
        color: #2dd4bf;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        font-size: 0.76rem;
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
        font-size: 0.8rem;
        color: var(--text-muted);
        text-align: center;
        padding: 0.75rem 0.5rem;
      }

      .modal-footer {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 0.65rem;
        padding: 0.75rem 1.15rem;
        border-top: 1px solid var(--border-color);
        background: var(--modal-header-bg);
        flex-shrink: 0;
      }

      .secondary-btn {
        height: 36px;
        padding: 0 1rem;
        border-radius: 0.5rem;
        border: 1px solid var(--border-color);
        background: var(--modal-bg);
        color: var(--text-secondary);
        font-size: 0.85rem;
        font-weight: 600;
        cursor: pointer;
      }

      .save-btn {
        height: 36px;
        padding: 0 1.15rem;
        border-radius: 0.5rem;
        border: none;
        background: #0d9488;
        color: #ffffff;
        font-size: 0.85rem;
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
        gap: 0.75rem;
        flex-wrap: wrap;
        padding: 0.75rem 1.15rem;
        background: var(--modal-header-bg);
        border-bottom: 1px solid var(--border-color);
      }

      .bg-overlay-title-wrap {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        flex-wrap: wrap;
      }

      .bg-brand-pill {
        font-size: 0.72rem;
        font-weight: 700;
        padding: 0.18rem 0.55rem;
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
        font-size: 0.95rem;
        font-weight: 700;
        color: var(--text-primary);
      }

      .bg-version-badge {
        font-size: 0.7rem;
        font-weight: 700;
        padding: 0.14rem 0.45rem;
        border-radius: 0.35rem;
        background: var(--input-bg);
        border: 1px solid var(--border-color);
        color: var(--text-secondary);
      }

      .bg-overlay-top-actions {
        display: flex;
        align-items: center;
        gap: 0.65rem;
      }

      .bg-external-link {
        font-size: 0.78rem;
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
        padding: 0.35rem 0.7rem;
        border-radius: 0.45rem;
        border: 1px solid var(--border-color);
        background: var(--input-bg);
        color: var(--text-primary);
        font-size: 0.78rem;
        font-weight: 600;
        cursor: pointer;
      }

      .bg-overlay-body {
        position: relative;
        flex: 1;
        overflow-y: auto;
        padding: 1rem 1.25rem 5rem;
        display: flex;
        flex-direction: column;
        gap: 0.85rem;
      }

      .bg-state-card {
        margin: auto;
        max-width: 460px;
        width: 100%;
        padding: 1.5rem 1.25rem;
        border-radius: 0.75rem;
        border: 1px solid var(--border-color);
        background: var(--modal-header-bg);
        text-align: center;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.55rem;
      }

      .bg-spinner {
        width: 1.85rem;
        height: 1.85rem;
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
        font-size: 0.92rem;
        color: #fca5a5;
      }

      :host-context(.light-theme) .bg-error-title,
      :host-context(html:not(.dark-theme)) .bg-error-title {
        color: #b91c1c;
      }

      .bg-error-message {
        margin: 0;
        font-size: 0.82rem;
        color: var(--text-secondary);
        line-height: 1.45;
      }

      .bg-error-actions {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        margin-top: 0.35rem;
      }

      .bg-retry-btn {
        padding: 0.4rem 0.85rem;
        border-radius: 0.45rem;
        border: 1px solid #0d9488;
        background: #0d9488;
        color: #ffffff;
        font-size: 0.8rem;
        font-weight: 600;
        cursor: pointer;
      }

      .bg-passage-reader {
        display: flex;
        flex-direction: column;
        gap: 0.85rem;
      }

      .bg-reader-meta {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.65rem;
        flex-wrap: wrap;
        padding-bottom: 0.45rem;
        border-bottom: 1px solid var(--border-color);
      }

      .bg-reader-ref {
        font-size: 1rem;
        font-weight: 700;
        color: var(--text-primary);
      }

      .bg-reader-count {
        font-size: 0.78rem;
        font-weight: 600;
        color: #2dd4bf;
      }

      :host-context(.light-theme) .bg-reader-count,
      :host-context(html:not(.dark-theme)) .bg-reader-count {
        color: #0f766e;
      }

      .bg-rendered-html {
        padding: 0.9rem 1.05rem;
        border-radius: 0.65rem;
        border: 1px solid var(--border-color);
        background: var(--input-bg);
        color: var(--text-primary);
        font-size: 0.94rem;
        line-height: 1.65;
      }

      .bg-fab-copy-import {
        position: fixed;
        right: 2rem;
        bottom: 2rem;
        z-index: 60;
        padding: 0.78rem 1.25rem;
        border-radius: 999px;
        border: 1px solid #14b8a6;
        background: linear-gradient(135deg, #0d9488 0%, #0f766e 100%);
        color: #ffffff;
        font-size: 0.88rem;
        font-weight: 700;
        cursor: pointer;
        box-shadow: 0 12px 28px rgba(13, 148, 136, 0.45);
        transition: transform 0.15s ease, box-shadow 0.15s ease;
      }

      .bg-fab-copy-import:hover {
        transform: translateY(-2px);
        box-shadow: 0 16px 32px rgba(13, 148, 136, 0.58);
      }
    `,
  ],
})
export class AddPassageModalComponent implements OnInit, OnChanges {
  private readonly parserService = inject(PassageParserService);
  private readonly storageService = inject(StorageService);
  private readonly bibleGatewayService = inject(BibleGatewayService);

  @Input() editingPassage: Passage | null = null;
  @Input() editItem: DeckItem | null = null;
  @Input() appendingToPassage: Passage | null = null;

  @Output() closed = new EventEmitter<void>();
  @Output() passageAdded = new EventEmitter<DeckItem>();

  readonly bibleVersions: BibleVersionOption[] = BIBLE_VERSIONS;

  readonly reference = signal<string>('');
  readonly label = signal<string>('');
  readonly rawText = signal<string>('');
  readonly selectedVersion = signal<string>(this.loadSavedVersion());

  readonly lockedVerses = signal<Verse[] | null>(null);
  readonly showVerseBoundaries = signal<boolean>(false);
  private readonly fallbackAppendPassage = signal<Passage | null>(null);

  readonly isBibleGatewayOpen = signal<boolean>(false);
  readonly bgIsLoading = signal<boolean>(false);
  readonly bgError = signal<string | null>(null);
  readonly bgLookupResult = signal<BibleGatewayLookupResult | null>(null);

  ngOnInit(): void {
    this.syncModalMode();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (
      changes['editingPassage'] ||
      changes['editItem'] ||
      changes['appendingToPassage']
    ) {
      this.syncModalMode();
    }
  }

  private getTargetEditingPassage(): Passage | null {
    return this.editingPassage ?? this.editItem?.passage ?? null;
  }

  getTargetAppendingPassage(): Passage | null {
    return this.appendingToPassage ?? this.fallbackAppendPassage();
  }

  isEditMode(): boolean {
    return !this.isAppendMode() && this.getTargetEditingPassage() !== null;
  }

  isAppendMode(): boolean {
    return this.getTargetAppendingPassage() !== null;
  }

  private formatVersesWithBrackets(verses: Verse[]): string {
    const isMulti = isMultiChapterPassage(verses);
    return (verses ?? [])
      .map((v) => {
        const marker =
          isMulti && v.chapterNumber && v.chapterNumber > 0
            ? `${v.chapterNumber}:${v.verseNumber}`
            : `${v.verseNumber}`;
        return `[${marker}] ${v.text}`;
      })
      .join('\n\n');
  }

  private syncModalMode(): void {
    let appendTarget = this.appendingToPassage;
    if (!appendTarget && !this.getTargetEditingPassage() && typeof sessionStorage !== 'undefined') {
      try {
        const appendId = sessionStorage.getItem('selah_append_passage_id_v1');
        if (appendId) {
          sessionStorage.removeItem('selah_append_passage_id_v1');
          appendTarget =
            this.storageService.passages().find((p) => p.id === appendId) ?? null;
          this.fallbackAppendPassage.set(appendTarget);
        }
      } catch {
        // Ignore storage errors
      }
    }

    if (appendTarget) {
      this.reference.set(this.computeNextReferencePrefix(appendTarget));
      this.label.set(appendTarget.label || '');
      this.rawText.set('');
      this.lockedVerses.set(null);
      return;
    }

    const editTarget = this.getTargetEditingPassage();
    if (editTarget) {
      this.reference.set(editTarget.reference || '');
      this.label.set(editTarget.label || '');
      const verses = editTarget.verses ?? [];
      this.rawText.set(this.formatVersesWithBrackets(verses));
      this.lockedVerses.set(verses.map((v) => ({ ...v })));
      return;
    }

    if (typeof sessionStorage !== 'undefined') {
      try {
        const prefill = sessionStorage.getItem('selah_prefill_reference_v1');
        if (prefill) {
          sessionStorage.removeItem('selah_prefill_reference_v1');
          this.reference.set(prefill);
        }
      } catch {
        // Ignore storage errors
      }
    }
  }

  private computeNextReferencePrefix(passage: Passage): string {
    const ref = (passage.reference || '').trim();
    const bookMatch = ref.match(
      /^((?:[1-3]\s+)?[A-Za-z]+(?:\s+of\s+[A-Za-z]+|\s+[A-Za-z]+)?)\s+(\d+)/i
    );
    const bookName = bookMatch ? bookMatch[1].trim() : ref || 'Passage';
    const refChap = bookMatch ? parseInt(bookMatch[2], 10) || 1 : 1;
    const verses = passage.verses ?? [];
    const lastVerseObj = verses[verses.length - 1];
    const lastChap =
      lastVerseObj?.chapterNumber && lastVerseObj.chapterNumber > 0
        ? lastVerseObj.chapterNumber
        : refChap;
    const nextVerse = (lastVerseObj?.verseNumber ?? 0) + 1;
    return `${bookName} ${lastChap}:${nextVerse}-`;
  }

  readonly externalBibleGatewayUrl = computed<string>(() =>
    this.bibleGatewayService.buildSourceUrl(
      this.normalizeLookupReference(this.reference()) || 'Isaiah 40:28-31',
      this.selectedVersion()
    )
  );

  readonly showMissingVerseNumbersWarning = computed<boolean>(() => {
    const trimmed = this.rawText().trim();
    if (!trimmed) {
      return false;
    }
    if ((this.lockedVerses()?.length ?? 0) > 0) {
      return false;
    }
    return !VERSE_MARKER_CHECK_REGEX.test(trimmed);
  });

  readonly parsedResult = computed<{ reference: string; verses: Verse[] }>(() => {
    const raw = this.rawText();
    const ref = this.normalizeLookupReference(this.reference());
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

    return this.parserService.parseRawInput(raw, ref || undefined);
  });

  readonly recitationTime = computed<RecitationTimeEstimate>(() =>
    computeRecitationEstimate(this.parsedResult().verses)
  );

  readonly isMultiChapter = computed<boolean>(() =>
    isMultiChapterPassage(this.parsedResult().verses)
  );

  readonly canSave = computed<boolean>(() => {
    return this.parsedResult().verses.length > 0;
  });

  toggleVerseBoundaries(): void {
    this.showVerseBoundaries.update((v) => !v);
  }

  getVerseBadge(verse: Verse): string {
    return formatVerseBadge(verse, this.isMultiChapter());
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

  private normalizeLookupReference(rawRef: string): string {
    return (rawRef || '').trim().replace(/[-–—]+\s*$/, '').trim();
  }

  async openBibleGatewayLookup(): Promise<void> {
    const ref = this.normalizeLookupReference(this.reference());
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

  copyAndImportFromBibleGateway(): void {
    const result = this.bgLookupResult();
    if (!result) {
      return;
    }

    const bracketedText = this.formatVersesWithBrackets(result.verses);

    this.reference.set(result.canonicalReference || this.reference());
    this.rawText.set(bracketedText);
    this.lockedVerses.set(result.verses);
    this.isBibleGatewayOpen.set(false);
  }

  onTextChange(value: string): void {
    this.rawText.set(value);
    this.lockedVerses.set(null);
  }

  onRawTextChange(value: string): void {
    this.onTextChange(value);
  }

  savePassage(): void {
    const parsed = this.parsedResult();
    if (parsed.verses.length === 0) {
      return;
    }
    const cleanLabel = this.label().trim() || undefined;

    const appendTarget = this.getTargetAppendingPassage();
    if (appendTarget) {
      const combinedVerses = [...(appendTarget.verses ?? []), ...parsed.verses];
      const newFullReference = this.buildCombinedReference(
        appendTarget.reference,
        combinedVerses
      );
      const svc = this.storageService as AppendCapableStorageService;
      if (typeof svc.appendVersesToPassage === 'function') {
        svc.appendVersesToPassage(appendTarget.id, parsed.verses, newFullReference);
      } else {
        this.storageService.updatePassage(
          appendTarget.id,
          newFullReference,
          combinedVerses,
          combinedVerses,
          appendTarget.label
        );
      }
      const updatedItem = this.storageService
        .deckItems()
        .find((item) => item.passage.id === appendTarget.id && !item.card.isRepairCard);
      if (updatedItem) {
        this.passageAdded.emit(updatedItem);
      }
      this.closed.emit();
      return;
    }

    const editingTarget = this.getTargetEditingPassage();
    if (editingTarget) {
      this.storageService.updatePassage(
        editingTarget.id,
        parsed.reference,
        this.rawText(),
        parsed.verses,
        cleanLabel
      );
      const updatedItem = this.storageService
        .deckItems()
        .find((item) => item.passage.id === editingTarget.id && !item.card.isRepairCard);
      if (updatedItem) {
        this.passageAdded.emit(updatedItem);
      }
      this.closed.emit();
      return;
    }

    const createdItem = this.storageService.addPassage(
      parsed.reference,
      parsed.verses,
      cleanLabel
    );
    this.passageAdded.emit(createdItem);
    this.closed.emit();
  }

  onBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.closed.emit();
    }
  }

  private buildCombinedReference(baseReference: string, allVerses: Verse[]): string {
    if (allVerses.length === 0) {
      return baseReference;
    }
    const first = allVerses[0];
    const last = allVerses[allVerses.length - 1];

    const bookMatch = baseReference
      .trim()
      .match(/^((?:[1-3]\s+)?[A-Za-z]+(?:\s+of\s+[A-Za-z]+|\s+[A-Za-z]+)?)\s+(\d+)/);
    const bookName = bookMatch
      ? bookMatch[1].trim()
      : baseReference.replace(/\s*\d+:.*$/, '').trim() || 'Passage';
    const fallbackChap = bookMatch ? parseInt(bookMatch[2], 10) : undefined;

    const firstChap = first.chapterNumber ?? fallbackChap;
    const lastChap = last.chapterNumber ?? firstChap;

    if (firstChap && lastChap) {
      if (firstChap === lastChap) {
        return first.verseNumber === last.verseNumber
          ? `${bookName} ${firstChap}:${first.verseNumber}`
          : `${bookName} ${firstChap}:${first.verseNumber}-${last.verseNumber}`;
      }
      return `${bookName} ${firstChap}:${first.verseNumber}-${lastChap}:${last.verseNumber}`;
    }

    return first.verseNumber === last.verseNumber
      ? `${bookName} ${first.verseNumber}`
      : `${bookName} ${first.verseNumber}-${last.verseNumber}`;
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

  private formatDefaultReference(verses: Verse[]): string {
    if (verses.length === 0) {
      return 'Custom Passage';
    }
    const first = verses[0].verseNumber;
    const last = verses[verses.length - 1].verseNumber;
    return first === last ? `Passage (v. ${first})` : `Passage (vv. ${first}–${last})`;
  }
}
