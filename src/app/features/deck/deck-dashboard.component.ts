import { Component, EventEmitter, Output, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CardState } from '../../core/proto/bible_memory.pb';
import { SrsService } from '../../core/services/srs.service';
import { DeckItem, StorageService } from '../../core/services/storage.service';

@Component({
  selector: 'app-deck-dashboard',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="dashboard-container" data-testid="deck-dashboard">
      <!-- Hero Banner + Primary Action Bar -->
      <section class="hero-card">
        <div class="hero-copy">
          <span class="hero-eyebrow">Anki SRS • Voice Recitation • First-Letter Recall</span>
          <h2 class="hero-title">Scripture Memory Deck</h2>
          <p class="hero-description">
            Recite passages aloud from memory, or enter <strong>Study Mode</strong> to reveal
            first-letter hints word-by-word (<code>+1w</code>) or verse-by-verse (<code>+1v</code>).
          </p>
        </div>

        <div class="primary-action-bar">
          <button
            type="button"
            class="action-btn study-due-btn"
            (click)="startDueSession.emit()"
            data-testid="btn-study-due"
          >
            ▶ Study Due Cards ({{ storageService.stats().due }})
          </button>

          <button
            type="button"
            class="action-btn add-passage-btn"
            (click)="openAddPassage.emit()"
            data-testid="btn-open-add-passage"
          >
            + Add Passage (Copy-Paste)
          </button>

          <button
            type="button"
            class="action-btn proto-sync-btn"
            (click)="openProtoSync.emit()"
            data-testid="btn-open-proto-sync"
          >
            ⇄ ProtoJSON Data / Sync
          </button>
        </div>
      </section>

      <!-- Summary KPI Grid -->
      <section class="stats-grid" data-testid="deck-stats-grid" aria-label="Deck statistics">
        <div class="kpi-card due-kpi" data-testid="kpi-due-today">
          <span class="kpi-label">Due Today</span>
          <strong class="kpi-value">{{ storageService.stats().due }}</strong>
          <span class="kpi-sub">Ready for recitation</span>
        </div>

        <div class="kpi-card new-kpi" data-testid="kpi-new">
          <span class="kpi-label">New</span>
          <strong class="kpi-value">{{ storageService.stats().newCount }}</strong>
          <span class="kpi-sub">Unseen passages</span>
        </div>

        <div class="kpi-card learning-kpi" data-testid="kpi-learning">
          <span class="kpi-label">Learning</span>
          <strong class="kpi-value">{{ storageService.stats().learningCount }}</strong>
          <span class="kpi-sub">Short-interval steps</span>
        </div>

        <div class="kpi-card review-kpi" data-testid="kpi-review">
          <span class="kpi-label">Review / Known</span>
          <strong class="kpi-value">{{ storageService.stats().reviewCount }}</strong>
          <span class="kpi-sub">Graduated Anki cards</span>
        </div>

        <div class="kpi-card total-kpi" data-testid="kpi-total">
          <span class="kpi-label">Total Passages</span>
          <strong class="kpi-value">{{ storageService.stats().total }}</strong>
          <span class="kpi-sub">In ProtoJSON store</span>
        </div>
      </section>

      <!-- Passage Deck List -->
      <section class="deck-list-section">
        <div class="section-header">
          <div>
            <h3 class="section-title">Passage Deck ({{ storageService.deckItems().length }})</h3>
            <p class="section-subtitle">
              Click <strong>Study Card</strong> on any passage to practice voice recitation &amp;
              <code>+1w</code> / <code>+1v</code> first-letter scaffolding.
            </p>
          </div>
        </div>

        <div class="passage-deck-list" data-testid="passage-deck-list">
          @for (item of storageService.deckItems(); track item.passage.id; let i = $index) {
            <article
              class="deck-item-card"
              [class.is-due]="item.isDue"
              [attr.data-testid]="'deck-item-' + i"
            >
              <div class="deck-item-main">
                <div class="deck-item-header">
                  <h4 class="passage-ref" [attr.data-testid]="'deck-item-ref-' + i">
                    {{ item.passage.reference }}
                  </h4>

                  <span class="verse-count-pill">
                    {{ item.passage.verses.length }}
                    {{ item.passage.verses.length === 1 ? 'verse' : 'verses' }}
                  </span>

                  <span
                    class="state-badge"
                    [ngClass]="getBadgeClass(item.card.state)"
                    [attr.data-testid]="'deck-item-badge-' + i"
                  >
                    {{ getStateLabel(item.card.state) }}
                  </span>

                  @if (item.isDue) {
                    <span class="due-indicator">Due Now</span>
                  }
                </div>

                <p class="first-verse-snippet">
                  @if (item.passage.verses.length > 0) {
                    <span class="verse-num">[{{ item.passage.verses[0].verseNumber }}]</span>
                    {{ item.passage.verses[0].text }}
                    @if (item.passage.verses.length > 1) {
                      <span class="more-verses-hint">
                        (+{{ item.passage.verses.length - 1 }} more
                        {{ item.passage.verses.length - 1 === 1 ? 'verse' : 'verses' }})
                      </span>
                    }
                  }
                </p>

                <div class="srs-meta-row">
                  <span class="meta-chip">
                    Interval:
                    <strong>{{ formatCardInterval(item) }}</strong>
                  </span>
                  <span class="meta-chip">
                    Ease:
                    <strong>{{ (item.card.easeFactor * 100).toFixed(0) }}%</strong>
                  </span>
                  <span class="meta-chip">
                    Reps:
                    <strong>{{ item.card.repetitions }}</strong>
                  </span>
                  @if (item.card.lapses > 0) {
                    <span class="meta-chip">
                      Lapses:
                      <strong>{{ item.card.lapses }}</strong>
                    </span>
                  }
                </div>
              </div>

              <div class="deck-item-actions">
                <button
                  type="button"
                  class="study-card-btn"
                  (click)="practiceSingleItem.emit(item)"
                  [attr.data-testid]="'btn-study-card-' + i"
                >
                  Study Card →
                </button>
                <button
                  type="button"
                  class="delete-card-btn"
                  (click)="deletePassage(item.passage.id)"
                  aria-label="Delete passage"
                  title="Delete passage"
                  [attr.data-testid]="'btn-delete-card-' + i"
                >
                  🗑
                </button>
              </div>
            </article>
          } @empty {
            <div class="empty-deck-box">
              <p>Your deck is currently empty. Add a Bible passage via Copy-Paste to begin!</p>
              <button
                type="button"
                class="action-btn add-passage-btn"
                (click)="openAddPassage.emit()"
              >
                + Add Passage (Copy-Paste)
              </button>
            </div>
          }
        </div>
      </section>
    </div>
  `,
  styles: [
    `
      .dashboard-container {
        display: flex;
        flex-direction: column;
        gap: 1.5rem;
      }

      .hero-card {
        background: linear-gradient(135deg, #292524 0%, #1c1917 100%);
        color: #fafaf9;
        border-radius: 1.1rem;
        padding: 1.65rem 1.85rem;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1.5rem;
        flex-wrap: wrap;
        box-shadow: 0 12px 28px rgba(28, 25, 23, 0.14);
      }

      .hero-copy {
        max-width: 540px;
      }

      .hero-eyebrow {
        display: inline-block;
        font-size: 0.72rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: #5eead4;
        margin-bottom: 0.35rem;
      }

      .hero-title {
        margin: 0;
        font-size: 1.55rem;
        font-weight: 800;
        letter-spacing: -0.02em;
        color: #ffffff;
      }

      .hero-description {
        margin: 0.45rem 0 0;
        font-size: 0.88rem;
        line-height: 1.5;
        color: #d6d3d1;
      }

      .hero-description code {
        background: rgba(255, 255, 255, 0.12);
        padding: 0.1rem 0.35rem;
        border-radius: 0.3rem;
        color: #fde68a;
      }

      .primary-action-bar {
        display: flex;
        align-items: center;
        gap: 0.65rem;
        flex-wrap: wrap;
      }

      .action-btn {
        padding: 0.7rem 1.1rem;
        border-radius: 0.65rem;
        font-size: 0.86rem;
        font-weight: 700;
        cursor: pointer;
        border: 1px solid transparent;
        transition: all 0.15s ease;
        white-space: nowrap;
      }

      .study-due-btn {
        background: #0d9488;
        color: #ffffff;
        box-shadow: 0 4px 12px rgba(13, 148, 136, 0.32);
      }

      .study-due-btn:hover {
        background: #0f766e;
      }

      .add-passage-btn {
        background: #fde68a;
        color: #1c1917;
      }

      .add-passage-btn:hover {
        background: #fcd34d;
      }

      .proto-sync-btn {
        background: rgba(255, 255, 255, 0.1);
        color: #f5f5f4;
        border-color: rgba(255, 255, 255, 0.22);
      }

      .proto-sync-btn:hover {
        background: rgba(255, 255, 255, 0.18);
      }

      .stats-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
        gap: 0.85rem;
      }

      .kpi-card {
        background: #fffdf9;
        border: 1px solid #e7e0d3;
        border-radius: 0.85rem;
        padding: 1rem 1.15rem;
        display: flex;
        flex-direction: column;
        gap: 0.2rem;
        box-shadow: 0 2px 6px rgba(28, 25, 23, 0.04);
      }

      .kpi-label {
        font-size: 0.76rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: #78716c;
      }

      .kpi-value {
        font-size: 1.75rem;
        font-weight: 800;
        line-height: 1.15;
        color: #1c1917;
      }

      .due-kpi .kpi-value {
        color: #0f766e;
      }

      .new-kpi .kpi-value {
        color: #2563eb;
      }

      .learning-kpi .kpi-value {
        color: #d97706;
      }

      .review-kpi .kpi-value {
        color: #15803d;
      }

      .kpi-sub {
        font-size: 0.75rem;
        color: #a8a29e;
      }

      .deck-list-section {
        display: flex;
        flex-direction: column;
        gap: 0.9rem;
      }

      .section-header {
        display: flex;
        align-items: flex-end;
        justify-content: space-between;
        gap: 1rem;
        flex-wrap: wrap;
      }

      .section-title {
        margin: 0;
        font-size: 1.15rem;
        font-weight: 700;
        color: #1c1917;
      }

      .section-subtitle {
        margin: 0.2rem 0 0;
        font-size: 0.82rem;
        color: #57534e;
      }

      .passage-deck-list {
        display: flex;
        flex-direction: column;
        gap: 0.8rem;
      }

      .deck-item-card {
        background: #fffdf9;
        border: 1px solid #e7e0d3;
        border-radius: 0.9rem;
        padding: 1.15rem 1.3rem;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1.25rem;
        transition: border-color 0.15s ease, box-shadow 0.15s ease;
      }

      .deck-item-card:hover {
        border-color: #c7bdb0;
        box-shadow: 0 6px 16px rgba(28, 25, 23, 0.06);
      }

      .deck-item-card.is-due {
        border-left: 4px solid #0f766e;
      }

      .deck-item-main {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 0.45rem;
      }

      .deck-item-header {
        display: flex;
        align-items: center;
        gap: 0.55rem;
        flex-wrap: wrap;
      }

      .passage-ref {
        margin: 0;
        font-size: 1.05rem;
        font-weight: 700;
        color: #1c1917;
      }

      .verse-count-pill {
        font-size: 0.74rem;
        font-weight: 600;
        padding: 0.15rem 0.55rem;
        border-radius: 999px;
        background: #f5f0e6;
        color: #57534e;
        border: 1px solid #e7e0d3;
      }

      .state-badge {
        font-size: 0.7rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        padding: 0.16rem 0.55rem;
        border-radius: 0.35rem;
      }

      .badge-new {
        background: #dbeafe;
        color: #1e40af;
      }

      .badge-learning {
        background: #fef3c7;
        color: #92400e;
      }

      .badge-review {
        background: #dcfce7;
        color: #166534;
      }

      .due-indicator {
        font-size: 0.72rem;
        font-weight: 700;
        color: #0f766e;
        background: #ccfbf1;
        padding: 0.14rem 0.5rem;
        border-radius: 999px;
      }

      .first-verse-snippet {
        margin: 0;
        font-size: 0.9rem;
        color: #44403c;
        line-height: 1.48;
      }

      .verse-num {
        font-weight: 700;
        color: #0f766e;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        font-size: 0.8rem;
        margin-right: 0.25rem;
      }

      .more-verses-hint {
        font-size: 0.8rem;
        color: #78716c;
        font-style: italic;
        margin-left: 0.3rem;
      }

      .srs-meta-row {
        display: flex;
        align-items: center;
        gap: 0.85rem;
        flex-wrap: wrap;
        margin-top: 0.1rem;
      }

      .meta-chip {
        font-size: 0.76rem;
        color: #78716c;
      }

      .meta-chip strong {
        color: #292524;
      }

      .deck-item-actions {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        flex-shrink: 0;
      }

      .study-card-btn {
        padding: 0.6rem 1.05rem;
        border-radius: 0.6rem;
        border: 1px solid #0f766e;
        background: #0f766e;
        color: #ffffff;
        font-size: 0.84rem;
        font-weight: 600;
        cursor: pointer;
        transition: background 0.15s ease;
        white-space: nowrap;
      }

      .study-card-btn:hover {
        background: #115e59;
      }

      .delete-card-btn {
        padding: 0.55rem 0.7rem;
        border-radius: 0.55rem;
        border: 1px solid #e7e0d3;
        background: #faf6ee;
        color: #78716c;
        font-size: 0.85rem;
        cursor: pointer;
        transition: all 0.15s ease;
      }

      .delete-card-btn:hover {
        background: #fee2e2;
        border-color: #fecaca;
        color: #991b1b;
      }

      .empty-deck-box {
        text-align: center;
        background: #fffdf9;
        border: 1px dashed #d6cfc2;
        border-radius: 0.9rem;
        padding: 2.5rem 1.5rem;
        color: #57534e;
      }

      @media (max-width: 680px) {
        .deck-item-card {
          flex-direction: column;
          align-items: stretch;
        }

        .deck-item-actions {
          justify-content: flex-end;
        }
      }
    `,
  ],
})
export class DeckDashboardComponent {
  readonly storageService = inject(StorageService);
  private readonly srsService = inject(SrsService);

  @Output() startDueSession = new EventEmitter<void>();
  @Output() practiceSingleItem = new EventEmitter<DeckItem>();
  @Output() openAddPassage = new EventEmitter<void>();
  @Output() openProtoSync = new EventEmitter<void>();

  getStateLabel(state: CardState): string {
    switch (state) {
      case CardState.CARD_STATE_NEW:
        return 'NEW';
      case CardState.CARD_STATE_LEARNING:
        return 'LEARNING';
      case CardState.CARD_STATE_RELEARNING:
        return 'RELEARNING';
      case CardState.CARD_STATE_REVIEW:
        return 'REVIEW';
      default:
        return 'NEW';
    }
  }

  getBadgeClass(state: CardState): string {
    switch (state) {
      case CardState.CARD_STATE_NEW:
        return 'badge-new';
      case CardState.CARD_STATE_LEARNING:
      case CardState.CARD_STATE_RELEARNING:
        return 'badge-learning';
      case CardState.CARD_STATE_REVIEW:
        return 'badge-review';
      default:
        return 'badge-new';
    }
  }

  formatCardInterval(item: DeckItem): string {
    if (item.card.state === CardState.CARD_STATE_NEW) {
      return 'New';
    }
    return this.srsService.formatIntervalDays(item.card.intervalDays);
  }

  deletePassage(passageId: string): void {
    this.storageService.deletePassage(passageId);
  }
}
