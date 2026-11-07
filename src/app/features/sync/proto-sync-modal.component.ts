import { Component, EventEmitter, OnInit, Output, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { StorageService } from '../../core/services/storage.service';

@Component({
  selector: 'app-proto-sync-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div
      class="modal-backdrop"
      (click)="onBackdropClick($event)"
      data-testid="proto-sync-modal"
    >
      <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="proto-sync-title">
        <header class="modal-header">
          <div>
            <span class="modal-eyebrow">Protobuf v3 Canonical JSON • biblememory.v1.UserDataBundle</span>
            <h2 id="proto-sync-title" class="modal-title">Active Memory Data File &amp; ProtoJSON Sync</h2>
            <p class="modal-subtitle">
              Connect a local <code>.proto.json</code> file so every passage, stitch count, and Anki
              review auto-saves to disk in the background (<code>proto/bible_memory.proto</code>).
            </p>
          </div>
          <button
            type="button"
            class="icon-close-btn"
            (click)="closed.emit()"
            aria-label="Close modal"
            data-testid="btn-close-proto-sync"
          >
            ✕
          </button>
        </header>

        <div class="modal-body">
          <!-- Active Memory Data File Auto-Save Section -->
          <section class="active-file-panel" data-testid="modal-active-data-file-panel">
            <div class="active-file-header">
              <div>
                <span class="active-file-label">Background Auto-Save Target</span>
                @if (storageService.activeFileName()) {
                  <h3 class="active-file-title" data-testid="modal-active-file-name">
                    🟢 {{ storageService.activeFileName() }}
                  </h3>
                  <p class="active-file-meta">
                    @if (storageService.activeFileStatus() === 'needs-permission') {
                      Permission needed to resume auto-saving to this file.
                    } @else if (storageService.activeFileStatus() === 'saving') {
                      Writing changes to disk...
                    } @else {
                      Auto-saving every change in the background
                      @if (storageService.lastFileSavedAt()) {
                        • Last saved {{ storageService.lastFileSavedAt() }}
                      }
                    }
                  </p>
                } @else {
                  <h3 class="active-file-title disconnected-text">
                    💾 No Active Memory Data File Selected
                  </h3>
                  <p class="active-file-meta">
                    Choose an existing file or create a new <code>.proto.json</code> file to enable
                    automatic background saving as you work.
                  </p>
                }
              </div>

              <div class="active-file-actions">
                <button
                  type="button"
                  class="toolbar-btn"
                  (click)="onSelectExistingFile()"
                  data-testid="btn-modal-open-data-file"
                >
                  📂 Open Existing File...
                </button>
                <button
                  type="button"
                  class="toolbar-btn primary"
                  (click)="onCreateNewFile()"
                  data-testid="btn-modal-create-data-file"
                >
                  ✨ Create New Auto-Save File...
                </button>
                @if (storageService.activeFileName()) {
                  <button
                    type="button"
                    class="toolbar-btn subtle"
                    (click)="onDisconnectFile()"
                    data-testid="btn-modal-disconnect-data-file"
                  >
                    Disconnect
                  </button>
                }
              </div>
            </div>
          </section>

          <div class="schema-summary-bar">
            <div class="schema-pill">
              <span class="pill-label">Message</span>
              <code>biblememory.v1.UserDataBundle</code>
            </div>
            <div class="schema-pill">
              <span class="pill-label">Passages</span>
              <strong>{{ storageService.passages().length }}</strong>
            </div>
            <div class="schema-pill">
              <span class="pill-label">Flashcards</span>
              <strong>{{ storageService.flashcards().length }}</strong>
            </div>
            <div class="schema-pill">
              <span class="pill-label">Review Logs</span>
              <strong>{{ storageService.reviewLogs().length }}</strong>
            </div>
          </div>

          <div class="action-toolbar">
            <button
              type="button"
              class="toolbar-btn"
              (click)="copyProtoJson()"
              data-testid="btn-copy-protojson"
            >
              📋 Copy ProtoJSON
            </button>
            <button
              type="button"
              class="toolbar-btn"
              (click)="downloadProtoJson()"
              data-testid="btn-download-protojson"
            >
              ⬇ Download .proto.json
            </button>
            <button
              type="button"
              class="toolbar-btn primary"
              (click)="importFromTextarea()"
              data-testid="btn-import-protojson"
            >
              ⬆ Import ProtoJSON
            </button>
            <button
              type="button"
              class="toolbar-btn subtle"
              (click)="refreshFromStore()"
              data-testid="btn-refresh-protojson"
            >
              ↻ Refresh Live State
            </button>
          </div>

          @if (statusMessage()) {
            <div
              class="status-banner"
              [class.error]="statusType() === 'error'"
              data-testid="protojson-status-banner"
            >
              {{ statusMessage() }}
            </div>
          }

          <div class="editor-wrapper">
            <label for="protojson-box" class="editor-label">
              <span>Live Serialized Payload (<code>storageService.exportProtoJson(true)</code>)</span>
              <span class="editor-hint">Edit or paste a UserDataBundle JSON payload below and click Import ProtoJSON</span>
            </label>
            <textarea
              id="protojson-box"
              rows="12"
              class="proto-textarea"
              spellcheck="false"
              [ngModel]="protoJsonText()"
              (ngModelChange)="protoJsonText.set($event)"
              data-testid="protojson-textarea"
            ></textarea>
          </div>
        </div>

        <footer class="modal-footer">
          <button
            type="button"
            class="reset-btn"
            (click)="resetStarterDeck()"
            data-testid="btn-reset-starter-deck"
          >
            Reset to Starter Deck
          </button>
          <button
            type="button"
            class="done-btn"
            (click)="closed.emit()"
            data-testid="btn-done-proto-sync"
          >
            Done
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
        max-width: 780px;
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
        font-size: 1.22rem;
        font-weight: 700;
        color: #1c1917;
      }

      .modal-subtitle {
        margin: 0.35rem 0 0;
        font-size: 0.83rem;
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
        padding: 1.2rem 1.5rem;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 1rem;
      }

      .active-file-panel {
        background: #faf7f0;
        border: 1px solid #dfd7c6;
        border-radius: 0.75rem;
        padding: 0.95rem 1.1rem;
      }

      .active-file-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
        flex-wrap: wrap;
      }

      .active-file-label {
        font-size: 0.71rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: #0f766e;
      }

      .active-file-title {
        margin: 0.15rem 0 0;
        font-size: 0.98rem;
        font-weight: 700;
        color: #1c1917;
      }

      .disconnected-text {
        color: #92400e;
      }

      .active-file-meta {
        margin: 0.2rem 0 0;
        font-size: 0.79rem;
        color: #57534e;
      }

      .active-file-actions {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        flex-wrap: wrap;
      }

      .schema-summary-bar {
        display: flex;
        align-items: center;
        gap: 0.65rem;
        flex-wrap: wrap;
        background: #f5f0e6;
        border: 1px solid #e5dec9;
        border-radius: 0.65rem;
        padding: 0.6rem 0.9rem;
      }

      .schema-pill {
        display: flex;
        align-items: center;
        gap: 0.4rem;
        font-size: 0.8rem;
        color: #292524;
        padding-right: 0.65rem;
        border-right: 1px solid #d6cfc2;
      }

      .schema-pill:last-child {
        border-right: none;
        padding-right: 0;
      }

      .pill-label {
        color: #78716c;
        font-weight: 500;
      }

      .action-toolbar {
        display: flex;
        align-items: center;
        gap: 0.6rem;
        flex-wrap: wrap;
      }

      .toolbar-btn {
        padding: 0.55rem 0.95rem;
        border-radius: 0.55rem;
        border: 1px solid #d6cfc2;
        background: #ffffff;
        color: #292524;
        font-size: 0.83rem;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.15s ease;
      }

      .toolbar-btn:hover {
        background: #f5f0e6;
      }

      .toolbar-btn.primary {
        background: #0f766e;
        color: #ffffff;
        border-color: #0f766e;
      }

      .toolbar-btn.primary:hover {
        background: #115e59;
      }

      .toolbar-btn.subtle {
        background: #faf6ee;
        color: #57534e;
      }

      .status-banner {
        padding: 0.6rem 0.9rem;
        border-radius: 0.55rem;
        font-size: 0.83rem;
        font-weight: 600;
        background: #ccfbf1;
        color: #115e59;
        border: 1px solid #99f6e4;
      }

      .status-banner.error {
        background: #fee2e2;
        color: #991b1b;
        border-color: #fecaca;
      }

      .editor-wrapper {
        display: flex;
        flex-direction: column;
        gap: 0.4rem;
      }

      .editor-label {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 0.5rem;
        flex-wrap: wrap;
        font-size: 0.82rem;
        font-weight: 600;
        color: #292524;
      }

      .editor-hint {
        font-size: 0.75rem;
        font-weight: 400;
        color: #78716c;
      }

      .proto-textarea {
        width: 100%;
        box-sizing: border-box;
        padding: 0.85rem;
        border-radius: 0.65rem;
        border: 1px solid #d6cfc2;
        background: #1c1917;
        color: #f5f5f4;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        font-size: 0.8rem;
        line-height: 1.45;
        resize: vertical;
      }

      .proto-textarea:focus {
        outline: none;
        border-color: #0f766e;
        box-shadow: 0 0 0 3px rgba(15, 118, 110, 0.2);
      }

      .modal-footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.75rem;
        padding: 0.95rem 1.5rem;
        border-top: 1px solid #ede7db;
        background: #faf6ee;
      }

      .reset-btn {
        padding: 0.55rem 0.95rem;
        border-radius: 0.55rem;
        border: 1px solid #e7e0d3;
        background: transparent;
        color: #78716c;
        font-size: 0.8rem;
        font-weight: 600;
        cursor: pointer;
      }

      .reset-btn:hover {
        background: #fee2e2;
        color: #991b1b;
        border-color: #fecaca;
      }

      .done-btn {
        padding: 0.6rem 1.25rem;
        border-radius: 0.55rem;
        border: none;
        background: #292524;
        color: #ffffff;
        font-size: 0.86rem;
        font-weight: 600;
        cursor: pointer;
      }

      .done-btn:hover {
        background: #1c1917;
      }
    `,
  ],
})
export class ProtoSyncModalComponent implements OnInit {
  readonly storageService = inject(StorageService);

  @Output() closed = new EventEmitter<void>();

  readonly protoJsonText = signal<string>('');
  readonly statusMessage = signal<string>('');
  readonly statusType = signal<'success' | 'error'>('success');

  ngOnInit(): void {
    this.refreshFromStore();
  }

  refreshFromStore(): void {
    this.protoJsonText.set(this.storageService.exportProtoJson(true));
  }

  async onSelectExistingFile(): Promise<void> {
    const ok = await this.storageService.selectExistingDataFile();
    if (ok) {
      this.refreshFromStore();
      this.statusType.set('success');
      this.statusMessage.set(
        `Connected active memory data file: ${this.storageService.activeFileName()}`
      );
    }
  }

  async onCreateNewFile(): Promise<void> {
    const ok = await this.storageService.createNewDataFile();
    if (ok) {
      this.refreshFromStore();
      this.statusType.set('success');
      this.statusMessage.set(
        `Created and connected active memory data file: ${this.storageService.activeFileName()}`
      );
    }
  }

  onDisconnectFile(): void {
    this.storageService.disconnectDataFile();
    this.statusType.set('success');
    this.statusMessage.set('Disconnected active memory data file.');
  }

  async copyProtoJson(): Promise<void> {
    const payload = this.protoJsonText();
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(payload);
      }
      this.statusType.set('success');
      this.statusMessage.set('Copied ProtoJSON bundle to clipboard.');
    } catch {
      this.statusType.set('success');
      this.statusMessage.set('ProtoJSON ready in editor box.');
    }
  }

  downloadProtoJson(): void {
    const payload = this.protoJsonText();
    if (typeof document === 'undefined' || typeof Blob === 'undefined') {
      return;
    }
    const blob = new Blob([payload], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `selah-memory-bundle.proto.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    this.statusType.set('success');
    this.statusMessage.set('Downloaded selah-memory-bundle.proto.json');
  }

  importFromTextarea(): void {
    const raw = this.protoJsonText().trim();
    if (!raw) {
      this.statusType.set('error');
      this.statusMessage.set('Please provide a valid UserDataBundle ProtoJSON string.');
      return;
    }

    try {
      this.storageService.importProtoJson(raw, false);
      this.refreshFromStore();
      this.statusType.set('success');
      this.statusMessage.set(
        `Imported ProtoJSON bundle (${this.storageService.passages().length} passages, ${this.storageService.flashcards().length} cards).`
      );
    } catch (err) {
      this.statusType.set('error');
      this.statusMessage.set(
        `Failed to parse ProtoJSON: ${err instanceof Error ? err.message : 'Invalid JSON syntax'}`
      );
    }
  }

  resetStarterDeck(): void {
    this.storageService.resetToDefaults();
    this.refreshFromStore();
    this.statusType.set('success');
    this.statusMessage.set('Reset deck to the 4 default starter passages.');
  }

  onBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.closed.emit();
    }
  }
}
