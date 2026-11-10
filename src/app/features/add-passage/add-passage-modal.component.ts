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

const ISAIAH_40_EXAMPLE_REF = 'Isaiah 40:28-31';
const ISAIAH_40_EXAMPLE_RAW = `[28] Have you not known? Have you not heard? The LORD is the everlasting God, the Creator of the ends of the earth. He does not faint or grow weary; his understanding is unsearchable.
[29] He gives power to the faint, and to him who has no might he increases strength.
[30] Even youths shall faint and be weary, and young men shall fall exhausted;
[31] but they who wait for the LORD shall renew their strength; they shall mount up with wings like eagles; they shall run and not be weary; they shall walk and not faint.`;

const BG_VERSION_STORAGE_KEY = 'selah_bg_version_v1';

const VERSE_MARKER_CHECK_REGEX =
  /(\[\d{1,3}(?::\d{1,3})?\]|\(\d{1,3}(?::\d{1,3})?\)|[⁰¹²³⁴⁵⁶⁷⁸⁹]+|(?:^|(?<=\s))\d{1,3}(?::\d{1,3})?\s+(?=["'“‘(]*[A-Za-z]))/m;

export interface RecitationTimeEstimate {
  wordCount: number;
  seconds: number;
  label: string;
  isLong: boolean;
}

export interface PassageChunkView {
  index: number;
  startIdx: number;
  endIdx: number;
  reference: string;
  label: string;
  verses: Verse[];
  recitationLabel: string;
}

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
          <div>
            <span class="modal-eyebrow">Simple Copy-Paste &amp; BibleGateway Editor</span>
            <h2 id="add-passage-title" class="modal-title">
              {{ isEditMode() ? 'Edit Passage' : 'Add Passage' }}
            </h2>
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

              @if (!isEditMode()) {
                <button
                  type="button"
                  class="example-btn"
                  (click)="pasteExample()"
                  data-testid="btn-paste-example"
                >
                  ✦ Paste Example
                </button>
              }
            </div>
          </div>

          <!-- Optional Custom Label / Memory Cue Input -->
          <div class="field-group">
            <label for="input-passage-label" class="field-label">
              Label / Memory Cue (optional)
              <span class="field-hint">
                Shown in parentheses next to the reference on your deck list
              </span>
            </label>
            <input
              id="input-passage-label"
              type="text"
              class="text-input"
              placeholder="e.g. Beatitudes, or the one who offers txgvg"
              [ngModel]="label()"
              (ngModelChange)="label.set($event)"
              data-testid="input-passage-label"
            />
          </div>

          <div class="field-group">
            <div class="textarea-toolbar">
              <label for="passage-raw-textarea" class="field-label">
                Passage Text
                <span class="field-hint">
                  @if ((lockedVerses()?.length ?? 0) > 0) {
                    (Clean text with {{ lockedVerses()!.length }} verse boundaries locked)
                  } @else {
                    (Plain editable text box — verse boundaries parsed automatically)
                  }
                </span>
              </label>

              @if (parsedResult().verses.length > 0) {
                <span class="recitation-time-pill" data-testid="add-passage-recitation-time">
                  ⏱ {{ recitationTime().label }} ({{ recitationTime().wordCount }} words)
                </span>
              }
            </div>

            <textarea
              id="passage-raw-textarea"
              rows="6"
              class="raw-textarea"
              placeholder="Paste or type your passage here (or use 🌐 Look Up on BibleGateway above)...&#10;[28] Have you not known? Have you not heard?...&#10;[29] He gives power to the faint..."
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
                <strong>🌐 Look Up on BibleGateway</strong> or include verse numbers in your pasted text.
              </p>
            </div>
          }

          <!-- >10-Verse / >180-Word Long-Passage Warning & Named Chunk Splitter -->
          @if (isLongPassage()) {
            <div
              id="warning-long-passage"
              class="long-passage-warning"
              role="region"
              aria-label="Long passage chunking recommendation"
              data-testid="warning-long-passage"
            >
              <div class="long-warning-top">
                <div class="long-warning-copy">
                  <strong class="warning-title">
                    ⚠️ Long passage ({{ parsedResult().verses.length }} verses ·
                    {{ recitationTime().label }} to recite)
                  </strong>
                  <p class="warning-body">
                    Consider splitting into smaller named chunks (~5–10 verses each). Once
                    memorized, contiguous chunks automatically schedule stitched full-passage
                    reviews!
                  </p>
                </div>

                <button
                  id="btn-split-into-chunks"
                  type="button"
                  class="split-chunks-btn"
                  (click)="openChunkSplitter()"
                  data-testid="btn-split-into-chunks"
                >
                  {{ isChunkSplitterOpen() ? '▾ Hide Chunk Splitter' : '✂️ Split into Named Chunks' }}
                </button>
              </div>

              @if (isChunkSplitterOpen()) {
                <div
                  id="chunk-splitter-editor"
                  class="chunk-splitter-box"
                  data-testid="chunk-splitter-editor"
                >
                  <div class="chunk-splitter-toolbar">
                    <span class="chunk-splitter-title">
                      Named Chunks ({{ chunkViews().length }} chunks · {{ parsedResult().verses.length }} total verses)
                    </span>
                    <button
                      type="button"
                      class="chunk-helper-btn"
                      (click)="addAnotherChunkSplit()"
                      [disabled]="chunkViews().length >= parsedResult().verses.length"
                      data-testid="btn-add-chunk-split"
                    >
                      + Add Split
                    </button>
                  </div>

                  <div class="chunk-list">
                    @for (chunk of chunkViews(); track chunk.index; let idx = $index) {
                      <div class="chunk-card" [attr.data-testid]="'chunk-card-' + idx">
                        <div class="chunk-card-header">
                          <div class="chunk-ref-group">
                            <span class="chunk-num-badge">Chunk {{ idx + 1 }}</span>
                            <strong class="chunk-subref" [attr.data-testid]="'chunk-ref-' + idx">
                              {{ chunk.reference }}
                            </strong>
                            <span class="chunk-meta">
                              ({{ chunk.verses.length }}v · ⏱ {{ chunk.recitationLabel }})
                            </span>
                          </div>

                          @if (idx < chunkViews().length - 1) {
                            <div class="chunk-boundary-controls">
                              <span class="boundary-hint">End boundary:</span>
                              <button
                                type="button"
                                class="chunk-step-btn"
                                [disabled]="chunk.verses.length <= 1"
                                (click)="adjustChunkBoundary(idx, -1)"
                                [attr.data-testid]="'btn-chunk-shrink-' + idx"
                              >
                                -1v
                              </button>
                              <button
                                type="button"
                                class="chunk-step-btn"
                                [disabled]="chunkViews()[idx + 1].verses.length <= 1"
                                (click)="adjustChunkBoundary(idx, 1)"
                                [attr.data-testid]="'btn-chunk-expand-' + idx"
                              >
                                +1v
                              </button>
                              @if (chunkViews().length > 2) {
                                <button
                                  type="button"
                                  class="chunk-merge-btn"
                                  (click)="removeChunkBoundary(idx)"
                                  title="Merge with next chunk"
                                  [attr.data-testid]="'btn-chunk-merge-' + idx"
                                >
                                  ✕
                                </button>
                              }
                            </div>
                          }
                        </div>

                        <div class="chunk-label-row">
                          <input
                            [id]="'input-chunk-label-' + idx"
                            type="text"
                            class="text-input chunk-label-input"
                            placeholder="Label this chunk (e.g. The Word Made Flesh)..."
                            [ngModel]="chunkLabels()[idx] || ''"
                            (ngModelChange)="updateChunkLabel(idx, $event)"
                            [attr.data-testid]="'input-chunk-label-' + idx"
                          />
                        </div>

                        <p class="chunk-preview-snippet">
                          <span class="verse-num-pill">[{{ getVerseBadge(chunk.verses[0]) }}]</span>
                          {{ chunk.verses[0].text }}
                          @if (chunk.verses.length > 1) {
                            <span class="chunk-through-hint">
                              … [{{ getVerseBadge(chunk.verses[chunk.verses.length - 1]) }}]
                            </span>
                          }
                        </p>
                      </div>
                    }
                  </div>

                  <div class="chunk-splitter-footer">
                    <button
                      id="btn-save-named-chunks"
                      type="button"
                      class="save-chunks-btn"
                      (click)="saveNamedChunks()"
                      data-testid="btn-save-named-chunks"
                    >
                      Save {{ chunkViews().length }} Named Chunks
                    </button>
                  </div>
                </div>
              }
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
                    Enter a reference and click <strong>🌐 Look Up on BibleGateway</strong>, or paste text above.
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
            {{ isEditMode() ? 'Save Changes' : 'Save Passage to Deck' }}
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
        gap: 1rem;
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
        gap: 0.4rem;
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

      .recitation-time-pill {
        font-size: 0.75rem;
        font-weight: 600;
        padding: 0.16rem 0.55rem;
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
        padding: 0.62rem 0.85rem;
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

      .missing-verse-nums-warning,
      .long-passage-warning {
        background: rgba(120, 53, 15, 0.35);
        border: 1px solid rgba(245, 158, 11, 0.5);
        border-left: 4px solid #f59e0b;
        border-radius: 0.65rem;
        padding: 0.8rem 1rem;
        display: flex;
        flex-direction: column;
        gap: 0.65rem;
      }

      :host-context(.light-theme) .missing-verse-nums-warning,
      :host-context(html:not(.dark-theme)) .missing-verse-nums-warning,
      :host-context(.light-theme) .long-passage-warning,
      :host-context(html:not(.dark-theme)) .long-passage-warning {
        background: #fffbeb;
      }

      .long-warning-top {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.85rem;
        flex-wrap: wrap;
      }

      .long-warning-copy {
        flex: 1 1 320px;
        display: flex;
        flex-direction: column;
        gap: 0.2rem;
      }

      .warning-title {
        font-size: 0.85rem;
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

      .split-chunks-btn {
        padding: 0.5rem 0.9rem;
        border-radius: 0.55rem;
        border: 1px solid #f59e0b;
        background: rgba(245, 158, 11, 0.22);
        color: #fef3c7;
        font-size: 0.81rem;
        font-weight: 700;
        cursor: pointer;
        white-space: nowrap;
      }

      :host-context(.light-theme) .split-chunks-btn,
      :host-context(html:not(.dark-theme)) .split-chunks-btn {
        background: #fef3c7;
        color: #92400e;
      }

      .chunk-splitter-box {
        border-top: 1px solid rgba(245, 158, 11, 0.35);
        padding-top: 0.75rem;
        display: flex;
        flex-direction: column;
        gap: 0.65rem;
      }

      .chunk-splitter-toolbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.5rem;
        flex-wrap: wrap;
      }

      .chunk-splitter-title {
        font-size: 0.8rem;
        font-weight: 700;
        color: var(--text-primary);
      }

      .chunk-helper-btn {
        padding: 0.3rem 0.65rem;
        border-radius: 0.45rem;
        border: 1px solid var(--border-color);
        background: var(--input-bg);
        color: var(--text-primary);
        font-size: 0.76rem;
        font-weight: 600;
        cursor: pointer;
      }

      .chunk-list {
        display: flex;
        flex-direction: column;
        gap: 0.55rem;
        max-height: 260px;
        overflow-y: auto;
      }

      .chunk-card {
        padding: 0.65rem 0.85rem;
        border-radius: 0.6rem;
        background: var(--modal-bg);
        border: 1px solid var(--border-color);
        display: flex;
        flex-direction: column;
        gap: 0.45rem;
      }

      .chunk-card-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.5rem;
        flex-wrap: wrap;
      }

      .chunk-ref-group {
        display: flex;
        align-items: center;
        gap: 0.45rem;
        flex-wrap: wrap;
      }

      .chunk-num-badge {
        font-size: 0.7rem;
        font-weight: 700;
        text-transform: uppercase;
        padding: 0.14rem 0.48rem;
        border-radius: 999px;
        background: rgba(20, 184, 166, 0.2);
        color: #5eead4;
      }

      :host-context(.light-theme) .chunk-num-badge,
      :host-context(html:not(.dark-theme)) .chunk-num-badge {
        background: #ccfbf1;
        color: #115e59;
      }

      .chunk-subref {
        font-size: 0.9rem;
        color: var(--text-primary);
      }

      .chunk-meta {
        font-size: 0.75rem;
        color: var(--text-muted);
      }

      .chunk-boundary-controls {
        display: flex;
        align-items: center;
        gap: 0.3rem;
      }

      .boundary-hint {
        font-size: 0.72rem;
        color: var(--text-muted);
      }

      .chunk-step-btn,
      .chunk-merge-btn {
        padding: 0.2rem 0.45rem;
        border-radius: 0.35rem;
        border: 1px solid var(--border-color);
        background: var(--input-bg);
        color: var(--text-secondary);
        font-size: 0.74rem;
        font-weight: 700;
        cursor: pointer;
      }

      .chunk-step-btn:disabled {
        opacity: 0.4;
        cursor: not-allowed;
      }

      .chunk-label-input {
        padding: 0.45rem 0.7rem;
        font-size: 0.84rem;
      }

      .chunk-preview-snippet {
        margin: 0;
        font-size: 0.78rem;
        color: var(--text-secondary);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .chunk-through-hint {
        color: var(--text-muted);
        margin-left: 0.25rem;
      }

      .chunk-splitter-footer {
        display: flex;
        justify-content: flex-end;
      }

      .save-chunks-btn {
        padding: 0.58rem 1.1rem;
        border-radius: 0.55rem;
        border: none;
        background: #d97706;
        color: #ffffff;
        font-size: 0.85rem;
        font-weight: 700;
        cursor: pointer;
      }

      .save-chunks-btn:hover {
        background: #b45309;
      }

      .peek-boundaries-container {
        display: flex;
        flex-direction: column;
        gap: 0.55rem;
      }

      .peek-boundaries-btn {
        align-self: flex-start;
        display: inline-flex;
        align-items: center;
        gap: 0.55rem;
        padding: 0.38rem 0.75rem;
        border-radius: 0.5rem;
        border: 1px solid var(--border-color);
        background: var(--modal-header-bg);
        color: var(--text-secondary);
        font-size: 0.8rem;
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
        font-size: 0.72rem;
        font-weight: 600;
        padding: 0.14rem 0.55rem;
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
export class AddPassageModalComponent implements OnInit, OnChanges {
  private readonly parserService = inject(PassageParserService);
  private readonly storageService = inject(StorageService);
  private readonly bibleGatewayService = inject(BibleGatewayService);

  @Input() editingPassage: Passage | null = null;
  @Input() editItem: DeckItem | null = null;

  @Output() closed = new EventEmitter<void>();
  @Output() passageAdded = new EventEmitter<DeckItem>();

  readonly bibleVersions: BibleVersionOption[] = BIBLE_VERSIONS;

  readonly reference = signal<string>('');
  readonly label = signal<string>('');
  readonly rawText = signal<string>('');
  readonly selectedVersion = signal<string>(this.loadSavedVersion());

  readonly lockedVerses = signal<Verse[] | null>(null);
  readonly showVerseBoundaries = signal<boolean>(false);

  /** Named Chunk Splitter state for >10-verse / >180-word passages */
  readonly isChunkSplitterOpen = signal<boolean>(false);
  /** Exclusive end indices for each chunk except the last */
  readonly chunkSplitIndices = signal<number[]>([]);
  readonly chunkLabels = signal<Record<number, string>>({});

  readonly isBibleGatewayOpen = signal<boolean>(false);
  readonly bgIsLoading = signal<boolean>(false);
  readonly bgError = signal<string | null>(null);
  readonly bgLookupResult = signal<BibleGatewayLookupResult | null>(null);

  ngOnInit(): void {
    this.syncFromEditingPassage();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['editingPassage'] || changes['editItem']) {
      this.syncFromEditingPassage();
    }
  }

  private getTargetEditingPassage(): Passage | null {
    return this.editingPassage ?? this.editItem?.passage ?? null;
  }

  isEditMode(): boolean {
    return this.getTargetEditingPassage() !== null;
  }

  private syncFromEditingPassage(): void {
    const p = this.getTargetEditingPassage();
    if (!p) {
      return;
    }
    this.reference.set(p.reference || '');
    this.label.set(p.label || '');
    const verses = p.verses ?? [];
    this.rawText.set(verses.map((v) => v.text).join('\n\n'));
    this.lockedVerses.set(verses.map((v) => ({ ...v })));
    this.chunkSplitIndices.set([]);
    this.chunkLabels.set({});
    this.isChunkSplitterOpen.set(false);
  }

  readonly externalBibleGatewayUrl = computed<string>(() =>
    this.bibleGatewayService.buildSourceUrl(
      this.reference() || 'Isaiah 40:28-31',
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

    return this.parserService.parseRawInput(raw, ref || undefined);
  });

  readonly recitationTime = computed<RecitationTimeEstimate>(() =>
    computeRecitationEstimate(this.parsedResult().verses)
  );

  readonly isLongPassage = computed<boolean>(() => {
    const verses = this.parsedResult().verses;
    return verses.length > 10 || this.recitationTime().isLong;
  });

  readonly chunkViews = computed<PassageChunkView[]>(() => {
    const verses = this.parsedResult().verses;
    if (verses.length === 0) {
      return [];
    }
    const baseRef = this.parsedResult().reference;
    const splits = this.chunkSplitIndices()
      .filter((idx) => idx > 0 && idx < verses.length)
      .sort((a, b) => a - b);

    const boundaries = [0, ...splits, verses.length];
    const labelsMap = this.chunkLabels();
    const views: PassageChunkView[] = [];

    for (let i = 0; i < boundaries.length - 1; i++) {
      const startIdx = boundaries[i];
      const endIdx = boundaries[i + 1];
      const chunkVerses = verses.slice(startIdx, endIdx);
      if (chunkVerses.length === 0) {
        continue;
      }
      const subRef = this.buildChunkReference(baseRef, chunkVerses);
      const est = computeRecitationEstimate(chunkVerses);
      views.push({
        index: i,
        startIdx,
        endIdx,
        reference: subRef,
        label: (labelsMap[i] ?? '').trim(),
        verses: chunkVerses,
        recitationLabel: est.label,
      });
    }

    return views;
  });

  readonly isMultiChapter = computed<boolean>(() =>
    isMultiChapterPassage(this.parsedResult().verses)
  );

  readonly canSave = computed<boolean>(() => {
    return this.parsedResult().verses.length > 0;
  });

  toggleVerseBoundaries(): void {
    this.showVerseBoundaries.update((v) => !v);
  }

  openChunkSplitter(): void {
    if (this.isChunkSplitterOpen()) {
      this.isChunkSplitterOpen.set(false);
      return;
    }
    const total = this.parsedResult().verses.length;
    if (total > 1 && this.chunkSplitIndices().length === 0) {
      this.initializeDefaultChunkSplits(total);
    }
    this.isChunkSplitterOpen.set(true);
  }

  private initializeDefaultChunkSplits(totalVerses: number): void {
    const targetChunkSize = 7;
    const numChunks = Math.max(2, Math.ceil(totalVerses / targetChunkSize));
    const baseSize = Math.floor(totalVerses / numChunks);
    const remainder = totalVerses % numChunks;

    const splits: number[] = [];
    let cursor = 0;
    for (let i = 0; i < numChunks - 1; i++) {
      cursor += baseSize + (i < remainder ? 1 : 0);
      if (cursor > 0 && cursor < totalVerses) {
        splits.push(cursor);
      }
    }
    this.chunkSplitIndices.set(splits);
  }

  adjustChunkBoundary(chunkIdx: number, delta: -1 | 1): void {
    const total = this.parsedResult().verses.length;
    const splits = [...this.chunkSplitIndices()];
    if (chunkIdx < 0 || chunkIdx >= splits.length) {
      return;
    }
    const prevBoundary = chunkIdx === 0 ? 0 : splits[chunkIdx - 1];
    const nextBoundary = chunkIdx + 1 < splits.length ? splits[chunkIdx + 1] : total;
    const candidate = splits[chunkIdx] + delta;
    if (candidate <= prevBoundary || candidate >= nextBoundary) {
      return;
    }
    splits[chunkIdx] = candidate;
    this.chunkSplitIndices.set(splits);
  }

  removeChunkBoundary(chunkIdx: number): void {
    const splits = [...this.chunkSplitIndices()];
    if (splits.length <= 1 || chunkIdx < 0 || chunkIdx >= splits.length) {
      return;
    }
    splits.splice(chunkIdx, 1);
    this.chunkSplitIndices.set(splits);
  }

  addAnotherChunkSplit(): void {
    const views = this.chunkViews();
    if (views.length === 0) {
      return;
    }
    let largest = views[0];
    for (const v of views) {
      if (v.verses.length > largest.verses.length) {
        largest = v;
      }
    }
    if (largest.verses.length < 2) {
      return;
    }
    const midIndex = largest.startIdx + Math.floor(largest.verses.length / 2);
    const nextSplits = [...this.chunkSplitIndices(), midIndex].sort((a, b) => a - b);
    this.chunkSplitIndices.set(nextSplits);
  }

  updateChunkLabel(chunkIdx: number, value: string): void {
    this.chunkLabels.update((prev) => ({
      ...prev,
      [chunkIdx]: value,
    }));
  }

  saveNamedChunks(): void {
    const views = this.chunkViews();
    if (views.length === 0) {
      return;
    }

    const baseLabel = this.label().trim();
    const entries = views.map((c, idx) => ({
      reference: c.reference,
      verses: c.verses,
      label: c.label || (baseLabel ? `${baseLabel} (${idx + 1}/${views.length})` : undefined),
    }));

    const editingTarget = this.getTargetEditingPassage();
    if (editingTarget) {
      this.storageService.splitPassageIntoChunks(editingTarget.id, entries);
      const firstNew = this.storageService.deckItems()[0];
      if (firstNew) {
        this.passageAdded.emit(firstNew);
      }
      this.closed.emit();
      return;
    }

    const createdPassages = this.storageService.addMultiplePassages(entries);
    if (createdPassages.length > 0) {
      const firstItem = this.storageService
        .deckItems()
        .find((item) => item.passage.id === createdPassages[0].id);
      if (firstItem) {
        this.passageAdded.emit(firstItem);
      }
    }
    this.closed.emit();
  }

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

    const cleanTextWithoutVerseNumbers = result.verses.map((v) => v.text).join('\n\n');

    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(cleanTextWithoutVerseNumbers);
      }
    } catch {
      // Gracefully ignore clipboard permission errors in headless browsers
    }

    this.reference.set(result.canonicalReference || this.reference());
    this.rawText.set(cleanTextWithoutVerseNumbers);
    this.lockedVerses.set(result.verses);
    this.chunkSplitIndices.set([]);
    this.isChunkSplitterOpen.set(false);
    this.isBibleGatewayOpen.set(false);
  }

  onTextChange(value: string): void {
    this.rawText.set(value);
    this.lockedVerses.set(null);
    this.chunkSplitIndices.set([]);
  }

  onRawTextChange(value: string): void {
    this.onTextChange(value);
  }

  pasteExample(): void {
    this.reference.set(ISAIAH_40_EXAMPLE_REF);
    this.rawText.set(ISAIAH_40_EXAMPLE_RAW);
    this.lockedVerses.set(null);
    this.chunkSplitIndices.set([]);
    this.isChunkSplitterOpen.set(false);
  }

  savePassage(): void {
    const parsed = this.parsedResult();
    if (parsed.verses.length === 0) {
      return;
    }
    const cleanLabel = this.label().trim() || undefined;
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

  private buildChunkReference(baseReference: string, chunkVerses: Verse[]): string {
    if (chunkVerses.length === 0) {
      return baseReference;
    }
    const first = chunkVerses[0];
    const last = chunkVerses[chunkVerses.length - 1];

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
