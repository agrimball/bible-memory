import { Component, EventEmitter, Input, Output, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import * as pb from '../../core/proto/bible_memory.pb';
import {
  CardState,
  Passage,
  Verse,
  formatVerseBadge,
  isMultiChapterPassage,
} from '../../core/proto/bible_memory.pb';
import { SrsService } from '../../core/services/srs.service';
import { DeckItem, StorageService } from '../../core/services/storage.service';

export type DashboardTab = 'queue' | 'due' | 'active';

function getEstimatedRecitationLabel(verses: Verse[]): string {
  const pbWithHelper = pb as unknown as {
    estimateRecitationTime?: (v: Verse[]) => { label: string };
  };
  if (typeof pbWithHelper.estimateRecitationTime === 'function') {
    return pbWithHelper.estimateRecitationTime(verses).label;
  }
  const wordCount = (verses ?? []).reduce((sum, v) => {
    const words = (v.text ?? '')
      .trim()
      .split(/\s+/)
      .filter((w) => w.length > 0);
    return sum + words.length;
  }, 0);
  const seconds = wordCount === 0 ? 0 : Math.max(5, Math.round((wordCount / 135) * 60));
  if (seconds < 60) {
    return `~${Math.max(5, Math.round(seconds / 5) * 5)}s`;
  }
  const mins = Math.round((seconds / 60) * 2) / 2;
  return `~${mins} min`;
}

@Component({
  selector: 'app-deck-dashboard',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="rm-dashboard" data-testid="deck-dashboard">
      <!-- Sleek Edge-to-Edge 3-Tab Header matching Remember Me (r3.png) -->
      <nav class="rm-tabs-bar" aria-label="Memory deck tabs" data-testid="dashboard-tabs">
        <button
          type="button"
          class="rm-tab"
          [class.active]="activeTab === 'queue'"
          [class.tab-new]="activeTab === 'queue'"
          (click)="selectTab('queue')"
          data-testid="tab-queue"
        >
          <span class="rm-tab-icon-wrap">
            <span class="rm-tab-icon" aria-hidden="true">⊔</span>
            <span class="rm-tab-count">{{ newTabItems().length }}</span>
          </span>
          <span class="rm-tab-label">NEW</span>
        </button>

        <button
          type="button"
          class="rm-tab"
          [class.active]="activeTab === 'due'"
          [class.tab-due]="activeTab === 'due'"
          (click)="selectTab('due')"
          data-testid="tab-due"
        >
          <span class="rm-tab-icon-wrap">
            <span class="rm-tab-icon" aria-hidden="true">▢</span>
            <span class="rm-tab-count">{{ dueTabItems().length }}</span>
          </span>
          <span class="rm-tab-label">DUE</span>
        </button>

        <button
          type="button"
          class="rm-tab"
          [class.active]="activeTab === 'active'"
          [class.tab-known]="activeTab === 'active'"
          (click)="selectTab('active')"
          data-testid="tab-active"
        >
          <span class="rm-tab-icon-wrap">
            <span class="rm-tab-icon" aria-hidden="true">✓</span>
            <span class="rm-tab-count">{{ knownTabItems().length }}</span>
          </span>
          <span class="rm-tab-label">KNOWN</span>
        </button>
      </nav>

      <!-- ======================================================================= -->
      <!-- TAB 1: NEW (Unstarted Queue)                                            -->
      <!-- ======================================================================= -->
      @if (activeTab === 'queue') {
        <section
          class="rm-list-section"
          data-testid="queue-page-section"
        >
          <div
            class="rm-flat-list"
            data-testid="currently-memorizing-section"
          >
            <div data-testid="passage-deck-list">
              @for (item of newTabItems(); track item.card.id; let i = $index) {
                <article
                  class="rm-row"
                  (click)="onRowClick(item)"
                  role="button"
                  tabindex="0"
                  (keydown.enter)="onRowClick(item)"
                  [attr.data-testid]="'deck-item-' + i"
                >
                  <!-- Left 42x42 Square Badge -->
                  <div class="rm-square-badge badge-new-square">
                    <span class="square-primary">{{ item.passage.verses.length }}v</span>
                  </div>

                  <!-- Middle Reference + Label or Opening Snippet -->
                  <div class="rm-row-middle">
                    <div class="rm-row-line">
                      <span class="rm-ref" [attr.data-testid]="'deck-item-ref-' + i">
                        {{ item.passage.reference }}
                      </span>
                      @if (getRowCueText(item); as cue) {
                        <span class="rm-snippet" [attr.data-testid]="'deck-item-cue-' + i">
                          ({{ cue }})
                        </span>
                      }
                    </div>
                  </div>

                  <!-- Right Tag + Recitation Time + Reorder/Edit/Delete -->
                  <div class="rm-row-right">
                    @if (newTabItems().length > 1) {
                      <div class="rm-reorder-group" (click)="$event.stopPropagation()">
                        <button
                          type="button"
                          class="rm-icon-action"
                          [disabled]="i === 0"
                          (click)="moveQueueItem(i, -1, $event)"
                          title="Move up"
                          [attr.data-testid]="'btn-move-up-' + i"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          class="rm-icon-action"
                          [disabled]="i === newTabItems().length - 1"
                          (click)="moveQueueItem(i, 1, $event)"
                          title="Move down"
                          [attr.data-testid]="'btn-move-down-' + i"
                        >
                          ↓
                        </button>
                      </div>
                    }

                    <div class="rm-meta-col" (click)="onRowClick(item)">
                      <span class="rm-top-tag">ESV · ⏱ {{ getRecitationLabel(item) }}</span>
                      <span class="rm-sub-due">new</span>
                    </div>

                    <button
                      [id]="'btn-edit-new-' + i"
                      type="button"
                      class="rm-edit-btn"
                      (click)="onEditClick(item, $event)"
                      aria-label="Edit passage"
                      title="Edit passage"
                      data-testid="btn-edit-passage"
                    >
                      ✎
                    </button>

                    <button
                      [id]="'btn-delete-new-' + i"
                      type="button"
                      class="rm-delete-btn"
                      (click)="deleteItem(item, $event)"
                      aria-label="Delete passage"
                      title="Delete passage"
                      [attr.data-testid]="'btn-delete-card-' + i"
                    >
                      ✕
                    </button>
                  </div>
                </article>
              } @empty {
                <div class="rm-empty-state" data-testid="empty-queue-state">
                  <p class="rm-empty-title">No new passages in your queue</p>
                  <p class="rm-empty-sub">Tap <strong>+</strong> below to add a passage from BibleGateway or paste text.</p>
                </div>
              }
            </div>
          </div>
        </section>
      }

      <!-- ======================================================================= -->
      <!-- TAB 2: DUE (Repair Cards, Stitched Cards, Partially-Memorized, & Due)   -->
      <!-- ======================================================================= -->
      @if (activeTab === 'due') {
        <section
          class="rm-list-section"
          data-testid="due-page-section"
        >
          <div class="rm-flat-list" data-testid="due-deck-list">
            @for (item of dueTabItems(); track item.card.id; let i = $index) {
              <article
                class="rm-row"
                [class.rm-row-repair]="item.card.isRepairCard"
                (click)="onRowClick(item)"
                role="button"
                tabindex="0"
                (keydown.enter)="onRowClick(item)"
                [attr.data-testid]="'due-item-' + i"
              >
                <!-- Left 42x42 Square Badge -->
                @if (item.card.isRepairCard) {
                  <div
                    class="rm-square-badge badge-repair-square"
                    data-testid="repair-card-badge"
                  >
                    <span class="square-icon">🔧</span>
                    <span class="square-sub" data-testid="repair-heal-pill">
                      {{ item.card.repairStreak || 0 }}/{{ item.card.repairTargetStreak || 3 }}
                    </span>
                  </div>
                } @else if (item.card.isStitchedPassageCard) {
                  <div
                    class="rm-square-badge badge-stitched-square"
                    data-testid="stitched-card-badge"
                  >
                    <span class="square-icon">🔗</span>
                    <span class="square-sub">{{ getStitchedChunkCount(item) }}x</span>
                  </div>
                } @else if (isPartiallyMemorized(item)) {
                  <div class="rm-square-badge badge-partial-square">
                    <span class="square-primary">
                      {{ item.card.learningStep || 1 }}/{{ item.passage.verses.length }}
                    </span>
                  </div>
                } @else {
                  <div
                    class="rm-square-badge"
                    [ngClass]="getLevelSquareClass(item)"
                  >
                    <span class="square-level">{{ getCardLevelNumber(item) }}</span>
                  </div>
                }

                <!-- Middle Reference + Label or Opening Snippet -->
                <div class="rm-row-middle">
                  <div class="rm-row-line">
                    <span class="rm-ref" [attr.data-testid]="'due-item-ref-' + i">
                      {{ item.passage.reference }}
                    </span>
                    @if (item.card.isRepairCard) {
                      <span class="rm-repair-tag">
                        ({{ getRepairTargetLabel(item) }})
                      </span>
                    } @else if (item.card.isStitchedPassageCard) {
                      <span class="rm-stitched-tag">
                        (Stitched)
                      </span>
                    }
                    @if (getRowCueText(item); as cue) {
                      <span class="rm-snippet">({{ cue }})</span>
                    }
                  </div>
                </div>

                <!-- Right Tag + Recitation Time + Due Label + Edit/Delete -->
                <div class="rm-row-right" (click)="$event.stopPropagation()">
                  <div class="rm-meta-col" (click)="onRowClick(item)">
                    <span class="rm-top-tag">{{ getRightTopTag(item) }} · ⏱ {{ getRecitationLabel(item) }}</span>
                    <span class="rm-sub-due due-now-text">{{ getRelativeDueLabel(item) }}</span>
                  </div>

                  @if (!item.card.isRepairCard) {
                    <button
                      [id]="'btn-edit-due-' + i"
                      type="button"
                      class="rm-edit-btn"
                      (click)="onEditClick(item, $event)"
                      aria-label="Edit passage"
                      title="Edit passage"
                      data-testid="btn-edit-passage"
                    >
                      ✎
                    </button>
                  }

                  <button
                    [id]="'btn-delete-due-' + i"
                    type="button"
                    class="rm-delete-btn"
                    (click)="deleteItem(item, $event)"
                    aria-label="Delete card"
                    title="Delete card"
                    [attr.data-testid]="'btn-delete-due-' + i"
                  >
                    ✕
                  </button>
                </div>
              </article>
            } @empty {
              <div class="rm-empty-state" data-testid="due-caught-up-state">
                <p class="rm-empty-title">All caught up for today</p>
                <p class="rm-empty-sub">No passages are currently due for review.</p>
              </div>
            }
          </div>
        </section>
      }

      <!-- ======================================================================= -->
      <!-- TAB 3: KNOWN (Started / Memorized Cards Scheduled for Future Review)    -->
      <!-- ======================================================================= -->
      @if (activeTab === 'active') {
        <section
          class="rm-list-section"
          data-testid="active-page-section"
        >
          <div class="rm-flat-list" data-testid="active-deck-list">
            @for (item of knownTabItems(); track item.card.id; let i = $index) {
              <article
                class="rm-row"
                (click)="onRowClick(item)"
                role="button"
                tabindex="0"
                (keydown.enter)="onRowClick(item)"
                [attr.data-testid]="'active-item-' + i"
              >
                <!-- Left 42x42 Square Badge -->
                @if (item.card.isRepairCard) {
                  <div
                    class="rm-square-badge badge-repair-square"
                    data-testid="repair-card-badge"
                  >
                    <span class="square-icon">🔧</span>
                    <span class="square-sub" data-testid="repair-heal-pill">
                      {{ item.card.repairStreak || 0 }}/{{ item.card.repairTargetStreak || 3 }}
                    </span>
                  </div>
                } @else if (item.card.isStitchedPassageCard) {
                  <div
                    class="rm-square-badge badge-stitched-square"
                    data-testid="stitched-card-badge"
                  >
                    <span class="square-icon">🔗</span>
                    <span class="square-sub">{{ getStitchedChunkCount(item) }}x</span>
                  </div>
                } @else if (isPartiallyMemorized(item)) {
                  <div class="rm-square-badge badge-partial-square">
                    <span class="square-primary">
                      {{ item.card.learningStep || 1 }}/{{ item.passage.verses.length }}
                    </span>
                  </div>
                } @else {
                  <div
                    class="rm-square-badge"
                    [ngClass]="getLevelSquareClass(item)"
                  >
                    <span class="square-level">{{ getCardLevelNumber(item) }}</span>
                  </div>
                }

                <!-- Middle Reference + Label or Opening Snippet -->
                <div class="rm-row-middle">
                  <div class="rm-row-line">
                    <span class="rm-ref" [attr.data-testid]="'active-item-ref-' + i">
                      {{ item.passage.reference }}
                    </span>
                    @if (item.card.isRepairCard) {
                      <span class="rm-repair-tag">
                        ({{ getRepairTargetLabel(item) }})
                      </span>
                    } @else if (item.card.isStitchedPassageCard) {
                      <span class="rm-stitched-tag">
                        (Stitched)
                      </span>
                    }
                    @if (getRowCueText(item); as cue) {
                      <span class="rm-snippet">({{ cue }})</span>
                    }
                  </div>
                </div>

                <!-- Right Tag + Recitation Time + Due Label + Edit/Delete -->
                <div class="rm-row-right" (click)="$event.stopPropagation()">
                  <div class="rm-meta-col" (click)="onRowClick(item)">
                    <span class="rm-top-tag">{{ getRightTopTag(item) }} · ⏱ {{ getRecitationLabel(item) }}</span>
                    <span class="rm-sub-due">{{ getRelativeDueLabel(item) }}</span>
                  </div>

                  @if (!item.card.isRepairCard) {
                    <button
                      [id]="'btn-edit-known-' + i"
                      type="button"
                      class="rm-edit-btn"
                      (click)="onEditClick(item, $event)"
                      aria-label="Edit passage"
                      title="Edit passage"
                      data-testid="btn-edit-passage"
                    >
                      ✎
                    </button>
                  }

                  <button
                    [id]="'btn-delete-known-' + i"
                    type="button"
                    class="rm-delete-btn"
                    (click)="deleteItem(item, $event)"
                    aria-label="Delete passage"
                    title="Delete passage"
                    [attr.data-testid]="'btn-delete-active-' + i"
                  >
                    ✕
                  </button>
                </div>
              </article>
            } @empty {
              <div class="rm-empty-state" data-testid="empty-active-state">
                <p class="rm-empty-title">No scheduled passages yet</p>
                <p class="rm-empty-sub">Start memorizing a passage from <strong>NEW</strong> or complete your <strong>DUE</strong> reviews.</p>
              </div>
            }
          </div>
        </section>
      }

      <!-- Floating Bottom Circular Action Buttons (r2.png, r3.png) -->
      <div class="rm-fab-dock" role="toolbar" aria-label="Deck actions">
        <button
          id="btn-study-due"
          type="button"
          class="rm-fab rm-fab-play"
          [disabled]="currentTabItems().length === 0"
          (click)="onPlayFabClick()"
          aria-label="Study cards"
          title="Study cards in this tab"
          data-testid="btn-study-due"
        >
          ▶
        </button>

        <button
          id="btn-fab-add"
          type="button"
          class="rm-fab rm-fab-add"
          (click)="onAddFabClick()"
          aria-label="Add passage"
          title="Add passage"
          data-testid="btn-empty-add"
        >
          +
        </button>
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        --rm-bg: #0b1120;
        --rm-row-hover: #151f32;
        --rm-divider: #1e293b;
        --rm-header-bg: #0f172a;
        --rm-tab-active-bg: rgba(245, 158, 11, 0.1);
        --rm-tab-hover-bg: rgba(255, 255, 255, 0.04);
        --rm-tab-text: #94a3b8;
        --rm-tab-active-text: #f8fafc;
        --rm-tab-accent: #f59e0b;
        --rm-tab-badge-bg: rgba(245, 158, 11, 0.18);
        --rm-tab-badge-text: #fbbf24;
        --rm-text-primary: #f8fafc;
        --rm-text-snippet: #cbd5e1;
        --rm-text-muted: #94a3b8;
        --rm-fab-play-bg: linear-gradient(135deg, #1e293b 0%, #334155 100%);
        --rm-fab-play-border: #3b82f6;
        --rm-fab-add-bg: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
        --rm-fab-add-text: #0f172a;
        display: block;
      }

      :host-context(.light-theme),
      :host-context(html:not(.dark-theme)) {
        --rm-bg: #f8fafc;
        --rm-row-hover: #f1f5f9;
        --rm-divider: #e2e8f0;
        --rm-header-bg: #ffffff;
        --rm-tab-active-bg: rgba(245, 158, 11, 0.12);
        --rm-tab-hover-bg: #f1f5f9;
        --rm-tab-text: #64748b;
        --rm-tab-active-text: #0f172a;
        --rm-tab-accent: #d97706;
        --rm-tab-badge-bg: #fef3c7;
        --rm-tab-badge-text: #b45309;
        --rm-text-primary: #0f172a;
        --rm-text-snippet: #334155;
        --rm-text-muted: #64748b;
        --rm-fab-play-bg: linear-gradient(135deg, #1e293b 0%, #334155 100%);
        --rm-fab-play-border: #3b82f6;
        --rm-fab-add-bg: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
        --rm-fab-add-text: #0f172a;
      }

      .rm-dashboard {
        display: flex;
        flex-direction: column;
        min-height: calc(100vh - 56px);
        background: var(--rm-bg);
        color: var(--rm-text-primary);
        padding-bottom: 5.5rem;
      }

      /* ===================================================================== */
      /* 3-Tab Header Strip (Minimalist layout + Selah Navy & Warm Gold theme) */
      /* ===================================================================== */
      .rm-tabs-bar {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        background: var(--rm-header-bg);
        border-bottom: 1px solid var(--rm-divider);
        user-select: none;
      }

      .rm-tab {
        position: relative;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 0.18rem;
        padding: 0.55rem 0.5rem 0.5rem;
        border: none;
        background: transparent;
        color: var(--rm-tab-text);
        cursor: pointer;
        transition: background 0.15s ease, color 0.15s ease;
      }

      .rm-tab:hover {
        color: var(--rm-tab-active-text);
        background: var(--rm-tab-hover-bg);
      }

      .rm-tab.active {
        color: var(--rm-tab-active-text);
        background: var(--rm-tab-active-bg);
        box-shadow: inset 0 -3px 0 var(--rm-tab-accent);
      }

      .rm-tab-icon-wrap {
        position: relative;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 0 0.5rem;
      }

      .rm-tab-icon {
        font-size: 1.1rem;
        line-height: 1;
        font-weight: 700;
      }

      .rm-tab-count {
        font-size: 0.68rem;
        font-weight: 800;
        line-height: 1;
        padding: 0.14rem 0.4rem;
        border-radius: 999px;
        background: rgba(148, 163, 184, 0.18);
        color: var(--rm-tab-text);
        margin-left: 0.24rem;
      }

      .rm-tab.active .rm-tab-count {
        background: var(--rm-tab-badge-bg);
        color: var(--rm-tab-badge-text);
      }

      .rm-tab-label {
        font-size: 0.72rem;
        font-weight: 700;
        letter-spacing: 0.06em;
        text-transform: uppercase;
      }

      /* ===================================================================== */
      /* Flat Edge-to-Edge Passage Rows                                        */
      /* ===================================================================== */
      .rm-list-section {
        flex: 1;
        display: flex;
        flex-direction: column;
      }

      .rm-flat-list {
        display: flex;
        flex-direction: column;
        width: 100%;
      }

      .rm-row {
        display: flex;
        align-items: center;
        gap: 0.85rem;
        padding: 0.62rem 0.9rem;
        border-bottom: 1px solid var(--rm-divider);
        background: transparent;
        cursor: pointer;
        transition: background 0.12s ease;
        min-height: 56px;
        box-sizing: border-box;
      }

      .rm-row:hover {
        background: var(--rm-row-hover);
      }

      .rm-row:focus-visible {
        outline: 2px solid #f59e0b;
        outline-offset: -2px;
      }

      /* Left 42x42px Rounded Square (Selah Navy, Teal, Indigo, & Warm Gold) */
      .rm-square-badge {
        width: 42px;
        height: 42px;
        border-radius: 7px;
        flex-shrink: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        color: #ffffff;
        font-weight: 700;
        box-sizing: border-box;
        position: relative;
        padding: 2px;
      }

      .badge-new-square {
        background: linear-gradient(135deg, #1e293b 0%, #334155 100%);
        border: 1px solid #475569;
        color: #f8fafc;
      }

      .badge-partial-square {
        background: linear-gradient(135deg, #0d9488 0%, #115e59 100%);
      }

      .badge-repair-square {
        background: linear-gradient(135deg, #d97706 0%, #b45309 100%);
      }

      .badge-stitched-square {
        background: linear-gradient(135deg, #4f46e5 0%, #3730a3 100%);
      }

      .badge-level-1 {
        background: linear-gradient(135deg, #0d9488 0%, #0f766e 100%);
      }

      .badge-level-2 {
        background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
      }

      .badge-level-3 {
        background: linear-gradient(135deg, #4f46e5 0%, #4338ca 100%);
      }

      .badge-level-high {
        background: linear-gradient(135deg, #d97706 0%, #b45309 100%);
      }

      .square-primary {
        font-size: 0.78rem;
        font-weight: 800;
        letter-spacing: -0.02em;
      }

      .square-level {
        position: absolute;
        top: 4px;
        left: 6px;
        font-size: 0.78rem;
        font-weight: 700;
        line-height: 1;
      }

      .square-icon {
        font-size: 0.78rem;
        line-height: 1;
      }

      .square-sub {
        font-size: 0.64rem;
        font-weight: 800;
        line-height: 1.1;
      }

      /* Middle Single-Line Reference + Label/Opening Words */
      .rm-row-middle {
        flex: 1 1 0;
        min-width: 0;
        overflow: hidden;
      }

      .rm-row-line {
        display: block;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        font-size: 1rem;
        line-height: 1.35;
        color: var(--rm-text-primary);
      }

      .rm-ref {
        font-weight: 600;
        color: var(--rm-text-primary);
      }

      .rm-repair-tag {
        margin-left: 0.35rem;
        font-size: 0.88rem;
        font-weight: 700;
        color: #f59e0b;
      }

      .rm-stitched-tag {
        margin-left: 0.35rem;
        font-size: 0.85rem;
        font-weight: 700;
        color: #818cf8;
      }

      .rm-snippet {
        margin-left: 0.35rem;
        font-weight: 400;
        color: var(--rm-text-snippet);
      }

      /* Right Column */
      .rm-row-right {
        display: flex;
        align-items: center;
        gap: 0.35rem;
        flex-shrink: 0;
      }

      .rm-meta-col {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        justify-content: center;
        gap: 0.1rem;
        min-width: 72px;
        text-align: right;
      }

      .rm-top-tag {
        font-size: 0.76rem;
        font-weight: 500;
        color: var(--rm-text-snippet);
        line-height: 1.15;
      }

      .rm-sub-due {
        font-size: 0.72rem;
        color: var(--rm-text-muted);
        line-height: 1.15;
      }

      .due-now-text {
        color: #f59e0b;
        font-weight: 600;
      }

      .rm-reorder-group {
        display: inline-flex;
        align-items: center;
        gap: 0.15rem;
      }

      .rm-icon-action,
      .rm-edit-btn,
      .rm-delete-btn {
        background: transparent;
        border: 1px solid transparent;
        border-radius: 4px;
        color: var(--rm-text-muted);
        font-size: 0.8rem;
        width: 24px;
        height: 24px;
        padding: 0;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        opacity: 0.55;
        transition: opacity 0.12s ease, color 0.12s ease, background 0.12s ease;
      }

      .rm-row:hover .rm-icon-action,
      .rm-row:hover .rm-edit-btn,
      .rm-row:hover .rm-delete-btn {
        opacity: 0.9;
      }

      .rm-icon-action:disabled {
        opacity: 0.2;
        cursor: default;
      }

      .rm-icon-action:hover:not(:disabled),
      .rm-edit-btn:hover {
        opacity: 1;
        background: rgba(245, 158, 11, 0.12);
        color: #f59e0b;
      }

      .rm-delete-btn:hover {
        opacity: 1;
        color: #ef4444;
        background: rgba(239, 68, 68, 0.12);
      }

      .rm-empty-state {
        padding: 3.5rem 1.5rem;
        text-align: center;
        color: var(--rm-text-muted);
      }

      .rm-empty-title {
        margin: 0 0 0.35rem;
        font-size: 1rem;
        font-weight: 600;
        color: var(--rm-text-primary);
      }

      .rm-empty-sub {
        margin: 0;
        font-size: 0.85rem;
      }

      /* ===================================================================== */
      /* Floating Bottom Circular Action Buttons (Selah Slate/Indigo & Gold)   */
      /* ===================================================================== */
      .rm-fab-dock {
        position: fixed;
        left: 50%;
        bottom: 1.35rem;
        transform: translateX(-50%);
        display: flex;
        align-items: center;
        gap: 1rem;
        z-index: 40;
      }

      .rm-fab {
        width: 56px;
        height: 56px;
        border-radius: 50%;
        border: none;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        box-shadow: 0 8px 20px rgba(0, 0, 0, 0.45);
        transition: transform 0.15s ease, filter 0.15s ease, opacity 0.15s ease;
      }

      .rm-fab:hover:not(:disabled) {
        transform: translateY(-2px);
        filter: brightness(1.08);
      }

      .rm-fab:disabled {
        opacity: 0.4;
        cursor: not-allowed;
      }

      .rm-fab-play {
        background: var(--rm-fab-play-bg);
        border: 1px solid var(--rm-fab-play-border);
        color: #f8fafc;
        font-size: 1.25rem;
        padding-left: 3px;
      }

      .rm-fab-add {
        background: var(--rm-fab-add-bg);
        color: var(--rm-fab-add-text);
        font-size: 1.75rem;
        font-weight: 600;
        line-height: 1;
      }
    `,
  ],
})
export class DeckDashboardComponent {
  readonly storageService = inject(StorageService);
  private readonly srsService = inject(SrsService);

  @Input() activeTab: DashboardTab = 'queue';
  @Output() activeTabChange = new EventEmitter<DashboardTab>();

  @Output() startDueSession = new EventEmitter<void>();
  @Output() studySingleItem = new EventEmitter<DeckItem>();
  @Output() practiceSingleItem = new EventEmitter<DeckItem>();
  @Output() startMemorizeFlow = new EventEmitter<DeckItem>();
  @Output() editItem = new EventEmitter<DeckItem>();
  @Output() editPassage = new EventEmitter<Passage>();
  @Output() openAddModal = new EventEmitter<void>();
  @Output() openAddPassage = new EventEmitter<void>();
  @Output() openProtoSync = new EventEmitter<void>();

  /**
   * NEW tab: Unstarted passages (state === CARD_STATE_NEW && repetitions === 0 and not a repair card).
   */
  readonly newTabItems = computed<DeckItem[]>(() => {
    return this.storageService
      .deckItems()
      .filter(
        (item) =>
          item.card.state === CardState.CARD_STATE_NEW &&
          (item.card.repetitions ?? 0) === 0 &&
          !item.card.isRepairCard &&
          !item.card.isStitchedPassageCard
      );
  });

  /**
   * DUE tab: All cards currently due (repair cards, stitched cards, partially-memorized passages due today, and full passages due today).
   */
  readonly dueTabItems = computed<DeckItem[]>(() => {
    return this.storageService.dueDeckItems();
  });

  /**
   * KNOWN tab: All started/memorized cards scheduled for a future review date (!isDue).
   */
  readonly knownTabItems = computed<DeckItem[]>(() => {
    return this.storageService
      .activeDeckItems()
      .filter((item) => !item.isDue)
      .sort((a, b) => {
        const dueA = new Date(a.card.dueAt).getTime() || 0;
        const dueB = new Date(b.card.dueAt).getTime() || 0;
        return dueA - dueB;
      });
  });

  readonly currentTabItems = computed<DeckItem[]>(() => {
    if (this.activeTab === 'due') {
      return this.dueTabItems();
    }
    if (this.activeTab === 'active') {
      return this.knownTabItems();
    }
    return this.newTabItems();
  });

  selectTab(tab: DashboardTab): void {
    this.activeTab = tab;
    this.activeTabChange.emit(tab);
  }

  onRowClick(item: DeckItem): void {
    if (this.studySingleItem.observed) {
      this.studySingleItem.emit(item);
      return;
    }
    if (this.startMemorizeFlow.observed) {
      this.startMemorizeFlow.emit(item);
      return;
    }
    this.practiceSingleItem.emit(item);
  }

  onEditClick(item: DeckItem, event?: Event): void {
    event?.stopPropagation();
    this.editItem.emit(item);
    this.editPassage.emit(item.passage);
  }

  onPlayFabClick(): void {
    if (this.activeTab === 'due' && this.dueTabItems().length > 0) {
      this.startDueSession.emit();
      return;
    }
    const list = this.currentTabItems();
    if (list.length > 0) {
      if (this.startDueSession.observed && this.dueTabItems().length > 0) {
        this.startDueSession.emit();
      } else {
        this.onRowClick(list[0]);
      }
    }
  }

  onAddFabClick(): void {
    if (this.openAddModal.observed) {
      this.openAddModal.emit();
      return;
    }
    this.openAddPassage.emit();
  }

  isPartiallyMemorized(item: DeckItem): boolean {
    if (
      item.card.isRepairCard ||
      item.card.isStitchedPassageCard ||
      item.card.state === CardState.CARD_STATE_NEW
    ) {
      return false;
    }
    const total = item.passage.verses.length;
    const step = item.card.learningStep || 1;
    return total > 1 && step >= 1 && step < total;
  }

  getStitchedChunkCount(item: DeckItem): number {
    return Math.max(2, item.card.stitchedPassageIds?.length || 2);
  }

  getRecitationLabel(item: DeckItem): string {
    return getEstimatedRecitationLabel(item.passage.verses);
  }

  getCardLevelNumber(item: DeckItem): number {
    const reps = item.card.repetitions || 0;
    if (reps > 0) {
      return reps;
    }
    if (item.card.intervalDays >= 7) {
      return 3;
    }
    if (item.card.intervalDays >= 2) {
      return 2;
    }
    return 1;
  }

  getLevelSquareClass(item: DeckItem): string {
    const lvl = this.getCardLevelNumber(item);
    if (lvl <= 1) {
      return 'badge-level-1';
    }
    if (lvl === 2) {
      return 'badge-level-2';
    }
    if (lvl === 3) {
      return 'badge-level-3';
    }
    return 'badge-level-high';
  }

  /**
   * Returns `passage.label` if set (e.g. "the one who offers txgvg" in r2.png),
   * falling back to the opening words preview when `passage.label` is empty.
   */
  getRowCueText(item: DeckItem): string {
    const customLabel = item.passage.label?.trim();
    if (customLabel) {
      return customLabel;
    }
    return this.getOpeningWords(item);
  }

  getOpeningWords(item: DeckItem): string {
    const verse = this.getSnippetVerse(item);
    if (!verse || !verse.text) {
      return '';
    }
    const clean = verse.text.replace(/^["'“‘(\s]+/, '').trim();
    const words = clean.split(/\s+/);
    if (words.length <= 6) {
      return clean;
    }
    return `${words.slice(0, 6).join(' ')}...`;
  }

  getRepairTargetLabel(item: DeckItem): string {
    const vNum = item.card.repairVerseNumber ?? 1;
    const multiChap = isMultiChapterPassage(item.passage.verses);
    if (multiChap && item.card.repairChapterNumber) {
      return `Repair ${item.card.repairChapterNumber}:${vNum}`;
    }
    const matched = item.passage.verses.find((v) => v.verseNumber === vNum);
    if (matched) {
      return `Repair ${formatVerseBadge(matched, multiChap)}`;
    }
    return `Repair v. ${vNum}`;
  }

  getRightTopTag(item: DeckItem): string {
    if (item.card.isRepairCard) {
      return this.getRepairTargetLabel(item);
    }
    if (item.card.isStitchedPassageCard) {
      return 'Stitched';
    }
    if (this.isPartiallyMemorized(item)) {
      const step = item.card.learningStep || 1;
      return `v. 1–${step}`;
    }
    return 'ESV';
  }

  getRelativeDueLabel(item: DeckItem): string {
    if (item.card.state === CardState.CARD_STATE_NEW && !item.card.isRepairCard) {
      return 'new';
    }
    if (item.isDue) {
      return 'due';
    }
    const dueMs = new Date(item.card.dueAt).getTime();
    if (isNaN(dueMs)) {
      return this.srsService.formatIntervalDays(item.card.intervalDays);
    }
    const diffDays = Math.max(1, Math.round((dueMs - Date.now()) / (1000 * 60 * 60 * 24)));
    if (diffDays === 1) {
      return 'tomorrow';
    }
    if (diffDays < 30) {
      return `in ${diffDays} days`;
    }
    const months = Math.round(diffDays / 30);
    return months === 1 ? 'in 1 month' : `in ${months} months`;
  }

  getSnippetVerse(item: DeckItem): Verse | null {
    if (!item.passage.verses || item.passage.verses.length === 0) {
      return null;
    }
    if (item.card.isRepairCard && item.card.repairVerseNumber) {
      const target = item.passage.verses.find(
        (v) =>
          v.verseNumber === item.card.repairVerseNumber &&
          (!item.card.repairChapterNumber || v.chapterNumber === item.card.repairChapterNumber)
      );
      if (target) {
        return target;
      }
    }
    return item.passage.verses[0];
  }

  moveQueueItem(index: number, direction: -1 | 1, event?: Event): void {
    event?.stopPropagation();
    const list = this.newTabItems();
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= list.length) {
      return;
    }
    const itemA = list[index];
    const itemB = list[targetIndex];
    this.storageService.passages.update((prev) => {
      const copy = [...prev];
      const idxA = copy.findIndex((p) => p.id === itemA.passage.id);
      const idxB = copy.findIndex((p) => p.id === itemB.passage.id);
      if (idxA !== -1 && idxB !== -1) {
        const temp = copy[idxA];
        copy[idxA] = copy[idxB];
        copy[idxB] = temp;
      }
      return copy;
    });
    this.storageService.flashcards.update((prev) => {
      const copy = [...prev];
      const idxA = copy.findIndex((c) => c.id === itemA.card.id);
      const idxB = copy.findIndex((c) => c.id === itemB.card.id);
      if (idxA !== -1 && idxB !== -1) {
        const temp = copy[idxA];
        copy[idxA] = copy[idxB];
        copy[idxB] = temp;
      }
      return copy;
    });
    this.storageService.importProtoJson(this.storageService.exportProtoJson(false), false);
  }

  deleteItem(item: DeckItem, event?: Event): void {
    event?.stopPropagation();
    const svc = this.storageService as unknown as {
      deleteCard?: (cardId: string) => void;
    };
    if (
      (item.card.isRepairCard || item.card.isStitchedPassageCard) &&
      typeof svc.deleteCard === 'function'
    ) {
      svc.deleteCard(item.card.id);
      return;
    }
    this.storageService.deletePassage(item.passage.id);
  }
}
