import { Component, EventEmitter, OnInit, Output, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DEFAULT_MEMORY_FILE_NAME, StorageService } from '../../core/services/storage.service';

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
          <h2 id="proto-sync-title" class="modal-title">Memory File</h2>
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
          <!-- Concise 1-line status + primary file actions -->
          <section class="active-file-panel" data-testid="modal-active-data-file-panel">
            <div class="status-row">
              @if (storageService.fileConnectionStatus() === 'connected' && storageService.activeFileName()) {
                <p class="status-line connected" data-testid="modal-active-file-name">
                  🟢 Connected to <strong>{{ storageService.activeFileName() }}</strong> (auto-saving)
                </p>
              } @else if (storageService.fileConnectionStatus() === 'unsaved-disconnected' && storageService.activeFileName()) {
                <p class="status-line warning" data-testid="modal-active-file-name">
                  ⚠️ Unsaved changes — reconnect <strong>{{ storageService.activeFileName() }}</strong> to save to disk
                </p>
              } @else if (storageService.fileConnectionStatus() === 'disconnected-clean' && storageService.activeFileName()) {
                <p class="status-line disconnected" data-testid="modal-active-file-name">
                  ☁ Disconnected from <strong>{{ storageService.activeFileName() }}</strong> (no unsaved changes)
                </p>
              } @else {
                <p class="status-line disconnected" data-testid="modal-active-file-name">
                  ☁ No file selected — saving to browser storage only
                </p>
              }

              @if (
                (storageService.fileConnectionStatus() === 'unsaved-disconnected' ||
                  storageService.fileConnectionStatus() === 'disconnected-clean') &&
                storageService.activeFileName()
              ) {
                <button
                  type="button"
                  class="toolbar-btn primary small"
                  (click)="onReconnectFile()"
                  data-testid="btn-modal-reconnect-data-file"
                >
                  {{ storageService.hasUnsavedFileChanges() ? 'Reconnect & Save Now' : 'Reconnect' }}
                </button>
              }
            </div>

            <div class="active-file-actions">
              <button
                type="button"
                class="toolbar-btn"
                (click)="onSelectExistingFile()"
                data-testid="btn-modal-open-data-file"
              >
                📂 Open .selahmemory File
              </button>
              <button
                type="button"
                class="toolbar-btn primary"
                (click)="onCreateNewFile()"
                data-testid="btn-modal-create-data-file"
              >
                ✨ Create New .selahmemory File
              </button>
              <button
                type="button"
                class="toolbar-btn"
                (click)="downloadBackup()"
                data-testid="btn-download-protojson"
              >
                ⬇ Download .selahmemory Backup
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
          </section>

          @if (statusMessage()) {
            <div
              class="status-banner"
              [class.error]="statusType() === 'error'"
              data-testid="protojson-status-banner"
            >
              {{ statusMessage() }}
            </div>
          }

          <!-- Collapsed-by-default Advanced disclosure -->
          <div class="advanced-section">
            <button
              type="button"
              id="btn-toggle-advanced-sync"
              class="advanced-toggle-btn"
              (click)="toggleAdvanced()"
              [attr.aria-expanded]="showAdvanced()"
              data-testid="btn-toggle-advanced-sync"
            >
              <span>{{ showAdvanced() ? '▾ Advanced' : '▸ Advanced' }}</span>
              <span class="advanced-meta">
                {{ storageService.passages().length }} passages • {{ storageService.flashcards().length }} cards
              </span>
            </button>

            @if (showAdvanced()) {
              <div class="advanced-body" data-testid="advanced-sync-panel">
                <div class="action-toolbar">
                  <button
                    type="button"
                    class="toolbar-btn"
                    (click)="copyBackupData()"
                    data-testid="btn-copy-protojson"
                  >
                    📋 Copy Backup Data
                  </button>
                  <button
                    type="button"
                    class="toolbar-btn primary"
                    (click)="importFromTextarea()"
                    data-testid="btn-import-protojson"
                  >
                    ⬆ Import Backup Data
                  </button>
                </div>

                <div class="editor-wrapper">
                  <label for="protojson-box" class="editor-label">
                    <span>Raw Backup Data (.selahmemory)</span>
                    <span class="editor-hint">Paste a .selahmemory backup below and click Import Backup Data</span>
                  </label>
                  <textarea
                    id="protojson-box"
                    rows="8"
                    class="proto-textarea"
                    spellcheck="false"
                    [ngModel]="protoJsonText()"
                    (ngModelChange)="protoJsonText.set($event)"
                    data-testid="protojson-textarea"
                  ></textarea>
                </div>

                <div class="danger-zone">
                  @if (!confirmingReset()) {
                    <button
                      type="button"
                      id="btn-reset-all-data"
                      class="danger-reset-btn"
                      (click)="onRequestReset()"
                      data-testid="btn-reset-all-data"
                    >
                      Reset All Data to Zero
                    </button>
                  } @else {
                    <div class="confirm-reset-row" data-testid="confirm-reset-box">
                      <button
                        type="button"
                        id="btn-confirm-reset-all-data"
                        class="danger-confirm-btn"
                        (click)="onConfirmResetToZero()"
                        data-testid="btn-confirm-reset-all-data"
                      >
                        Confirm: Delete All Passages (0 cards)
                      </button>
                      <button
                        type="button"
                        class="toolbar-btn subtle"
                        (click)="onCancelReset()"
                        data-testid="btn-cancel-reset-all-data"
                      >
                        Cancel
                      </button>
                    </div>
                  }
                </div>
              </div>
            }
          </div>
        </div>

        <footer class="modal-footer">
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
      :host {
        --modal-bg: #1e293b;
        --modal-header-bg: #0f172a;
        --panel-bg: #0f172a;
        --border-color: #334155;
        --text-primary: #f8fafc;
        --text-secondary: #cbd5e1;
        --text-muted: #94a3b8;
        display: block;
      }

      :host-context(.light-theme) {
        --modal-bg: #fffdf9;
        --modal-header-bg: #faf6ee;
        --panel-bg: #faf7f0;
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
        max-width: 640px;
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
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
        padding: 1rem 1.35rem;
        border-bottom: 1px solid var(--border-color);
        background: var(--modal-header-bg);
      }

      .modal-title {
        margin: 0;
        font-size: 1.15rem;
        font-weight: 700;
        color: var(--text-primary);
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
        padding: 1.15rem 1.35rem;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 0.9rem;
      }

      .active-file-panel {
        background: var(--panel-bg);
        border: 1px solid var(--border-color);
        border-radius: 0.75rem;
        padding: 0.95rem 1.1rem;
        display: flex;
        flex-direction: column;
        gap: 0.85rem;
      }

      .status-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.75rem;
        flex-wrap: wrap;
      }

      .status-line {
        margin: 0;
        font-size: 0.9rem;
        color: var(--text-primary);
      }

      .status-line.warning {
        color: #fbbf24;
      }

      :host-context(.light-theme) .status-line.warning {
        color: #b45309;
      }

      .status-line.disconnected {
        color: var(--text-secondary);
      }

      .active-file-actions {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        flex-wrap: wrap;
      }

      .action-toolbar {
        display: flex;
        align-items: center;
        gap: 0.6rem;
        flex-wrap: wrap;
      }

      .toolbar-btn {
        padding: 0.52rem 0.9rem;
        border-radius: 0.55rem;
        border: 1px solid var(--border-color);
        background: var(--modal-bg);
        color: var(--text-primary);
        font-size: 0.82rem;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.15s ease;
      }

      .toolbar-btn.small {
        padding: 0.35rem 0.7rem;
        font-size: 0.78rem;
      }

      .toolbar-btn:hover {
        border-color: #64748b;
      }

      .toolbar-btn.primary {
        background: #0d9488;
        color: #ffffff;
        border-color: #0d9488;
      }

      .toolbar-btn.primary:hover {
        background: #0f766e;
      }

      .toolbar-btn.subtle {
        background: var(--panel-bg);
        color: var(--text-secondary);
      }

      .status-banner {
        padding: 0.6rem 0.9rem;
        border-radius: 0.55rem;
        font-size: 0.82rem;
        font-weight: 600;
        background: rgba(20, 184, 166, 0.2);
        color: #5eead4;
        border: 1px solid rgba(20, 184, 166, 0.45);
      }

      :host-context(.light-theme) .status-banner {
        background: #ccfbf1;
        color: #115e59;
        border-color: #99f6e4;
      }

      .status-banner.error {
        background: rgba(239, 68, 68, 0.2);
        color: #fca5a5;
        border-color: rgba(239, 68, 68, 0.45);
      }

      .advanced-section {
        border: 1px solid var(--border-color);
        border-radius: 0.75rem;
        background: var(--panel-bg);
        overflow: hidden;
      }

      .advanced-toggle-btn {
        width: 100%;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.75rem;
        padding: 0.7rem 1rem;
        background: transparent;
        border: none;
        color: var(--text-secondary);
        font-size: 0.83rem;
        font-weight: 600;
        cursor: pointer;
        text-align: left;
      }

      .advanced-toggle-btn:hover {
        color: var(--text-primary);
      }

      .advanced-meta {
        font-size: 0.76rem;
        font-weight: 500;
        color: var(--text-muted);
      }

      .advanced-body {
        padding: 0.85rem 1rem 1rem;
        border-top: 1px solid var(--border-color);
        display: flex;
        flex-direction: column;
        gap: 0.85rem;
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
        font-size: 0.8rem;
        font-weight: 600;
        color: var(--text-primary);
      }

      .editor-hint {
        font-size: 0.74rem;
        font-weight: 400;
        color: var(--text-muted);
      }

      .proto-textarea {
        width: 100%;
        box-sizing: border-box;
        padding: 0.75rem;
        border-radius: 0.6rem;
        border: 1px solid var(--border-color);
        background: #020617;
        color: #f8fafc;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        font-size: 0.78rem;
        line-height: 1.45;
        resize: vertical;
      }

      .proto-textarea:focus {
        outline: none;
        border-color: #14b8a6;
        box-shadow: 0 0 0 3px rgba(20, 184, 166, 0.2);
      }

      .danger-zone {
        padding-top: 0.65rem;
        border-top: 1px dashed var(--border-color);
        display: flex;
        align-items: center;
        justify-content: flex-start;
      }

      .danger-reset-btn {
        padding: 0.48rem 0.85rem;
        border-radius: 0.5rem;
        border: 1px solid rgba(239, 68, 68, 0.45);
        background: transparent;
        color: #ef4444;
        font-size: 0.8rem;
        font-weight: 600;
        cursor: pointer;
      }

      .danger-reset-btn:hover {
        background: rgba(239, 68, 68, 0.14);
        border-color: #ef4444;
      }

      .confirm-reset-row {
        display: flex;
        align-items: center;
        gap: 0.55rem;
        flex-wrap: wrap;
      }

      .danger-confirm-btn {
        padding: 0.5rem 0.9rem;
        border-radius: 0.5rem;
        border: 1px solid #ef4444;
        background: #ef4444;
        color: #ffffff;
        font-size: 0.8rem;
        font-weight: 700;
        cursor: pointer;
      }

      .danger-confirm-btn:hover {
        background: #dc2626;
      }

      .modal-footer {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 0.75rem;
        padding: 0.85rem 1.35rem;
        border-top: 1px solid var(--border-color);
        background: var(--modal-header-bg);
      }

      .done-btn {
        padding: 0.55rem 1.25rem;
        border-radius: 0.55rem;
        border: none;
        background: #0d9488;
        color: #ffffff;
        font-size: 0.85rem;
        font-weight: 600;
        cursor: pointer;
      }

      .done-btn:hover {
        background: #0f766e;
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
  readonly showAdvanced = signal<boolean>(false);
  readonly confirmingReset = signal<boolean>(false);

  ngOnInit(): void {
    this.syncTextareaFromStore();
  }

  toggleAdvanced(): void {
    const next = !this.showAdvanced();
    this.showAdvanced.set(next);
    if (next) {
      this.syncTextareaFromStore();
    } else {
      this.confirmingReset.set(false);
    }
  }

  private syncTextareaFromStore(): void {
    this.protoJsonText.set(this.storageService.exportProtoJson(true));
  }

  async onSelectExistingFile(): Promise<void> {
    const ok = await this.storageService.selectExistingDataFile();
    if (ok) {
      this.syncTextareaFromStore();
      this.statusType.set('success');
      this.statusMessage.set(
        `Connected memory file: ${this.storageService.activeFileName()}`
      );
    }
  }

  async onCreateNewFile(): Promise<void> {
    const ok = await this.storageService.createNewDataFile(DEFAULT_MEMORY_FILE_NAME);
    if (ok) {
      this.syncTextareaFromStore();
      this.statusType.set('success');
      this.statusMessage.set(
        `Created and connected memory file: ${this.storageService.activeFileName()}`
      );
    }
  }

  async onReconnectFile(): Promise<void> {
    const ok = await this.storageService.reconnectAndSyncNow();
    if (ok) {
      this.statusType.set('success');
      this.statusMessage.set(
        `Reconnected and saved to ${this.storageService.activeFileName()}`
      );
    }
  }

  onDisconnectFile(): void {
    this.storageService.disconnectDataFile();
    this.statusType.set('success');
    this.statusMessage.set('Disconnected memory file.');
  }

  async copyBackupData(): Promise<void> {
    this.syncTextareaFromStore();
    const payload = this.protoJsonText();
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(payload);
      }
      this.statusType.set('success');
      this.statusMessage.set('Copied backup data to clipboard.');
    } catch {
      this.statusType.set('success');
      this.statusMessage.set('Backup data ready in editor box.');
    }
  }

  downloadBackup(): void {
    this.syncTextareaFromStore();
    const payload = this.protoJsonText();
    if (typeof document === 'undefined' || typeof Blob === 'undefined') {
      return;
    }
    const fileName = this.storageService.activeFileName() || DEFAULT_MEMORY_FILE_NAME;
    const blob = new Blob([payload], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    URL.revokeObjectURL(url);
    this.statusType.set('success');
    this.statusMessage.set(`Downloaded ${fileName}`);
  }

  importFromTextarea(): void {
    const raw = this.protoJsonText().trim();
    if (!raw) {
      this.statusType.set('error');
      this.statusMessage.set('Please paste valid .selahmemory backup data.');
      return;
    }

    try {
      this.storageService.importProtoJson(raw, false);
      this.syncTextareaFromStore();
      this.statusType.set('success');
      this.statusMessage.set(
        `Imported backup (${this.storageService.passages().length} passages, ${this.storageService.flashcards().length} cards).`
      );
    } catch (err) {
      this.statusType.set('error');
      this.statusMessage.set(
        `Failed to read backup data: ${err instanceof Error ? err.message : 'Invalid syntax'}`
      );
    }
  }

  onRequestReset(): void {
    this.confirmingReset.set(true);
  }

  onCancelReset(): void {
    this.confirmingReset.set(false);
  }

  onConfirmResetToZero(): void {
    this.storageService.clearAllData();
    this.confirmingReset.set(false);
    this.syncTextareaFromStore();
    this.statusType.set('success');
    this.statusMessage.set('All passages and cards have been deleted (0 cards).');
  }

  onBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.closed.emit();
    }
  }
}
