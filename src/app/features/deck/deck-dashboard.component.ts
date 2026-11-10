import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import * as pb from '../../core/proto/bible_memory.pb';
import {
  CardState,
  Passage,
  RecitationEstimate,
  Verse,
  estimateRecitationTime,
  formatVerseBadge,
  formatVerseRange,
  isMultiChapterPassage,
} from '../../core/proto/bible_memory.pb';
import { SrsService } from '../../core/services/srs.service';
import { DeckItem, StorageService } from '../../core/services/storage.service';

export type DashboardTab = 'queue' | 'due' | 'active' | 'outline';

type BatchCapableStorageService = StorageService & {
  moveCardsToReviewDeck?: (ids: string[]) => void;
  moveCardsToNew?: (ids: string[]) => void;
  deletePassages?: (ids: string[]) => void;
  combinePassages?: (ids: string[]) => Passage | DeckItem | undefined;
  canCombinePassages?: (
    ids: string[]
  ) => boolean | { canCombine: boolean; reason?: string };
  updatePassageLabel?: (passageId: string, label: string) => void;
};

export interface OutlineChunkEntry {
  item: DeckItem;
  bookDisplay: string;
  bookOrder: number;
  startChapter: number;
  startVerse: number;
  endChapter: number;
  endVerse: number;
  rangeBadge: string;
  customLabel: string;
  recitationLabel: string;
  recitationTime: RecitationEstimate;
  srsStatusBadge: string;
  srsStatusClass: 'status-new' | 'status-due' | 'status-known';
}

export interface OutlinePassageGroup {
  groupId: string;
  groupKey: string;
  bookDisplay: string;
  groupReference: string;
  nextReferenceSuggestion: string;
  chunks: OutlineChunkEntry[];
  hasActiveSeamCard: boolean;
  hasActiveStitchedCard: boolean;
  hasDisjointGap: boolean;
  seamCount: number;
}

const BIBLE_BOOK_ORDER: Record<string, number> = {
  genesis: 1,
  exodus: 2,
  leviticus: 3,
  numbers: 4,
  deuteronomy: 5,
  joshua: 6,
  judges: 7,
  ruth: 8,
  '1 samuel': 9,
  '2 samuel': 10,
  '1 kings': 11,
  '2 kings': 12,
  '1 chronicles': 13,
  '2 chronicles': 14,
  ezra: 15,
  nehemiah: 16,
  esther: 17,
  job: 18,
  psalm: 19,
  psalms: 19,
  proverbs: 20,
  ecclesiastes: 21,
  'song of solomon': 22,
  'song of songs': 22,
  isaiah: 23,
  jeremiah: 24,
  lamentations: 25,
  ezekiel: 26,
  daniel: 27,
  hosea: 28,
  joel: 29,
  amos: 30,
  obadiah: 31,
  jonah: 32,
  micah: 33,
  nahum: 34,
  habakkuk: 35,
  zephaniah: 36,
  haggai: 37,
  zechariah: 38,
  malachi: 39,
  matthew: 40,
  mark: 41,
  luke: 42,
  john: 43,
  acts: 44,
  romans: 45,
  '1 corinthians': 46,
  '2 corinthians': 47,
  galatians: 48,
  ephesians: 49,
  philippians: 50,
  colossians: 51,
  '1 thessalonians': 52,
  '2 thessalonians': 53,
  '1 timothy': 54,
  '2 timothy': 55,
  titus: 56,
  philemon: 57,
  hebrews: 58,
  james: 59,
  '1 peter': 60,
  '2 peter': 61,
  '1 john': 62,
  '2 john': 63,
  '3 john': 64,
  jude: 65,
  revelation: 66,
};

const FALLBACK_CHAPTER_VERSE_COUNTS: Record<string, number> = {
  'genesis:1': 31,
  'genesis:2': 25,
  'psalm:1': 6,
  'psalms:1': 6,
  'psalm:23': 6,
  'psalms:23': 6,
  'psalm:119': 176,
  'psalms:119': 176,
  'proverbs:3': 35,
  'isaiah:40': 31,
  'isaiah:53': 12,
  'matthew:5': 48,
  'matthew:6': 34,
  'matthew:7': 29,
  'john:1': 51,
  'john:3': 36,
  'john:14': 31,
  'john:15': 27,
  'romans:1': 32,
  'romans:2': 29,
  'romans:3': 31,
  'romans:4': 25,
  'romans:5': 21,
  'romans:6': 23,
  'romans:7': 25,
  'romans:8': 39,
  'romans:9': 33,
  'romans:10': 21,
  'romans:11': 36,
  'romans:12': 21,
  '1 corinthians:13': 13,
  '2 corinthians:5': 21,
  'galatians:2': 21,
  'galatians:5': 26,
  'ephesians:1': 23,
  'ephesians:2': 22,
  'ephesians:6': 24,
  'philippians:1': 30,
  'philippians:2': 30,
  'philippians:3': 21,
  'philippians:4': 23,
  'colossians:1': 29,
  'colossians:3': 25,
  'hebrews:11': 40,
  'hebrews:12': 29,
  'james:1': 27,
  '1 peter:1': 25,
  'revelation:21': 27,
  'revelation:22': 21,
};

@Component({
  selector: 'app-deck-dashboard',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="rm-dashboard" data-testid="deck-dashboard">
      <!-- Sleek Edge-to-Edge 4-Tab Header Pinned to Top -->
      <nav class="rm-tabs rm-tabs-bar" aria-label="Memory deck tabs" data-testid="dashboard-tabs">
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

        <button
          type="button"
          class="rm-tab"
          [class.active]="activeTab === 'outline'"
          [class.tab-outline]="activeTab === 'outline'"
          (click)="selectTab('outline')"
          data-testid="tab-outline"
        >
          <span class="rm-tab-icon-wrap">
            <span class="rm-tab-icon" aria-hidden="true">📖</span>
            <span class="rm-tab-count">{{ basePassageItems().length }}</span>
          </span>
          <span class="rm-tab-label">OUTLINE</span>
        </button>
      </nav>

      <!-- Multi-Select Batch Action Bar (Pinned at Top when cards are selected) -->
      @if (selectedCardIds().size > 0) {
        <div
          class="rm-multiselect-bar"
          role="toolbar"
          aria-label="Batch selection actions"
          data-testid="multi-select-bar"
        >
          <div class="rm-ms-left">
            <button
              type="button"
              class="rm-ms-clear-btn"
              (click)="clearSelection()"
              aria-label="Clear selection"
              title="Clear selection"
              data-testid="btn-clear-selection"
            >
              ✕
            </button>
            <span class="rm-ms-count" data-testid="selected-count-label">
              {{ selectedCardIds().size }} selected
            </span>
            <button
              type="button"
              class="rm-ms-select-all-btn"
              (click)="selectAllInCurrentTab()"
              data-testid="btn-select-all"
            >
              Select All
            </button>
          </div>

          <div class="rm-ms-actions">
            @if (selectedCardIds().size === 1) {
              <button
                type="button"
                class="rm-ms-btn rm-ms-edit"
                (click)="editSelectedCard()"
                data-testid="btn-edit-passage"
              >
                ✎ Edit
              </button>

              <button
                type="button"
                class="rm-ms-btn rm-ms-append"
                (click)="appendToSelectedPassage()"
                data-testid="btn-append-passage"
              >
                ➕ Append Verses
              </button>
            }

            @if (selectedCardIds().size >= 2) {
              <button
                type="button"
                class="rm-ms-btn rm-ms-combine"
                [disabled]="!combineSelectionStatus().canCombine"
                [title]="combineSelectionStatus().reason || 'Sew contiguous passages together'"
                (click)="combineSelectedPassages()"
                data-testid="btn-batch-combine"
              >
                🪡 Sew ({{ selectedCardIds().size }})
              </button>
            }

            @if (activeTab === 'queue') {
              <button
                type="button"
                class="rm-ms-btn rm-ms-move"
                (click)="moveSelectedToDue()"
                data-testid="btn-batch-move-to-due"
              >
                📥 Move to Due
              </button>
            }

            @if (activeTab === 'due' || activeTab === 'active') {
              <button
                type="button"
                class="rm-ms-btn rm-ms-move"
                (click)="moveSelectedToNew()"
                data-testid="btn-batch-move-to-new"
              >
                ↩ Move to New
              </button>
            }

            <button
              type="button"
              class="rm-ms-btn rm-ms-delete"
              [class.confirming]="confirmingDelete()"
              (click)="onBatchDeleteClick()"
              data-testid="btn-batch-delete"
            >
              @if (confirmingDelete()) {
                Confirm Delete ({{ selectedCardIds().size }})
              } @else {
                🗑 Delete
              }
            </button>
          </div>
        </div>
      }

      <!-- Overall Time Prediction Strip on DUE Page -->
      @if (activeTab === 'due' && dueTabItems().length > 0) {
        <div class="rm-due-summary-bar" data-testid="due-overall-time">
          ⏱ Total due: {{ totalDueTimeLabel() }} across {{ dueTabItems().length }}
          {{ dueTabItems().length === 1 ? 'passage' : 'passages' }}
        </div>
      }

      <!-- Independently Scrollable List Container -->
      <div class="rm-list-container" data-testid="deck-list-scroll-container">
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
                    [class.rm-row-selected]="isCardSelected(item.card.id)"
                    (click)="onRowClick(item, $event)"
                    role="button"
                    tabindex="0"
                    (keydown.enter)="onRowClick(item, $event)"
                    [attr.data-testid]="'deck-item-' + i"
                  >
                    <!-- Left 42x42 Square Badge (Click to toggle multi-select) -->
                    <div
                      class="rm-left-square rm-square-badge badge-new-square"
                      [class.selected]="isCardSelected(item.card.id)"
                      (click)="toggleSelectCard(item, $event)"
                      role="checkbox"
                      [attr.aria-checked]="isCardSelected(item.card.id)"
                      aria-label="Select passage"
                      [attr.data-testid]="'left-square-new-' + i"
                    >
                      @if (isCardSelected(item.card.id)) {
                        <span class="square-check" aria-hidden="true">✓</span>
                      } @else {
                        <span class="square-primary">{{ item.passage.verses.length }}v</span>
                      }
                    </div>

                    <!-- Middle Reference + Optional Custom Label Only -->
                    <div class="rm-row-middle">
                      <div class="rm-row-line">
                        <span class="rm-ref" [attr.data-testid]="'deck-item-ref-' + i">
                          {{ item.passage.reference }}
                        </span>
                        @if (getOpeningSnippet(item); as cue) {
                          <span class="rm-snippet" [attr.data-testid]="'deck-item-cue-' + i">
                            ({{ cue }})
                          </span>
                        }
                      </div>
                    </div>

                    <!-- Right Tag + Recitation Time + Queue Reorder -->
                    <div class="rm-row-right">
                      @if (newTabItems().length > 1 && selectedCardIds().size === 0) {
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

                      <div class="rm-meta-col">
                        <span class="rm-top-tag">ESV · ⏱ {{ getRecitationLabel(item) }}</span>
                        <span class="rm-sub-due">new</span>
                      </div>
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
                  [class.rm-row-selected]="isCardSelected(item.card.id)"
                  (click)="onRowClick(item, $event)"
                  role="button"
                  tabindex="0"
                  (keydown.enter)="onRowClick(item, $event)"
                  [attr.data-testid]="'due-item-' + i"
                >
                  <!-- Left 42x42 Square Badge (Click to toggle multi-select) -->
                  @if (item.card.isRepairCard) {
                    <div
                      class="rm-left-square rm-square-badge badge-repair-square"
                      [class.selected]="isCardSelected(item.card.id)"
                      (click)="toggleSelectCard(item, $event)"
                      role="checkbox"
                      [attr.aria-checked]="isCardSelected(item.card.id)"
                      aria-label="Select repair card"
                      data-testid="repair-card-badge"
                    >
                      @if (isCardSelected(item.card.id)) {
                        <span class="square-check" aria-hidden="true">✓</span>
                      } @else {
                        <span class="square-icon">🩹</span>
                        <span class="square-sub" data-testid="repair-heal-pill">
                          {{ item.card.repairStreak || 0 }}/{{ item.card.repairTargetStreak || 3 }}
                        </span>
                      }
                    </div>
                  } @else if (item.card.isStitchedPassageCard) {
                    <div
                      class="rm-left-square rm-square-badge badge-stitched-square"
                      [class.selected]="isCardSelected(item.card.id)"
                      (click)="toggleSelectCard(item, $event)"
                      role="checkbox"
                      [attr.aria-checked]="isCardSelected(item.card.id)"
                      aria-label="Select stitched card"
                      data-testid="stitched-card-badge"
                    >
                      @if (isCardSelected(item.card.id)) {
                        <span class="square-check" aria-hidden="true">✓</span>
                      } @else {
                        <span class="square-icon">🔗</span>
                        <span class="square-sub">{{ getStitchedChunkCount(item) }}x</span>
                      }
                    </div>
                  } @else if (isPartiallyMemorized(item)) {
                    <div
                      class="rm-left-square rm-square-badge badge-partial-square"
                      [class.selected]="isCardSelected(item.card.id)"
                      (click)="toggleSelectCard(item, $event)"
                      role="checkbox"
                      [attr.aria-checked]="isCardSelected(item.card.id)"
                      aria-label="Select passage"
                      [attr.data-testid]="'left-square-due-' + i"
                    >
                      @if (isCardSelected(item.card.id)) {
                        <span class="square-check" aria-hidden="true">✓</span>
                      } @else {
                        <span class="square-primary">
                          {{ item.card.learningStep || 1 }}/{{ item.passage.verses.length }}
                        </span>
                      }
                    </div>
                  } @else {
                    <div
                      class="rm-left-square rm-square-badge"
                      [ngClass]="getLevelSquareClass(item)"
                      [class.selected]="isCardSelected(item.card.id)"
                      (click)="toggleSelectCard(item, $event)"
                      role="checkbox"
                      [attr.aria-checked]="isCardSelected(item.card.id)"
                      aria-label="Select passage"
                      [attr.data-testid]="'left-square-due-' + i"
                    >
                      @if (isCardSelected(item.card.id)) {
                        <span class="square-check" aria-hidden="true">✓</span>
                      } @else {
                        <span class="square-level">{{ getCardLevelNumber(item) }}</span>
                      }
                    </div>
                  }

                  <!-- Middle Reference + Optional Custom Label Only -->
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
                      @if (getOpeningSnippet(item); as cue) {
                        <span class="rm-snippet">({{ cue }})</span>
                      }
                    </div>
                  </div>

                  <!-- Right Tag + Recitation Time + Due Label -->
                  <div class="rm-row-right">
                    <div class="rm-meta-col">
                      <span class="rm-top-tag">{{ getRightTopTag(item) }} · ⏱ {{ getRecitationLabel(item) }}</span>
                      <span class="rm-sub-due due-now-text">{{ getRelativeDueLabel(item) }}</span>
                    </div>
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
                  [class.rm-row-selected]="isCardSelected(item.card.id)"
                  (click)="onRowClick(item, $event)"
                  role="button"
                  tabindex="0"
                  (keydown.enter)="onRowClick(item, $event)"
                  [attr.data-testid]="'active-item-' + i"
                >
                  <!-- Left 42x42 Square Badge (Click to toggle multi-select) -->
                  @if (item.card.isRepairCard) {
                    <div
                      class="rm-left-square rm-square-badge badge-repair-square"
                      [class.selected]="isCardSelected(item.card.id)"
                      (click)="toggleSelectCard(item, $event)"
                      role="checkbox"
                      [attr.aria-checked]="isCardSelected(item.card.id)"
                      aria-label="Select repair card"
                      data-testid="repair-card-badge"
                    >
                      @if (isCardSelected(item.card.id)) {
                        <span class="square-check" aria-hidden="true">✓</span>
                      } @else {
                        <span class="square-icon">🩹</span>
                        <span class="square-sub" data-testid="repair-heal-pill">
                          {{ item.card.repairStreak || 0 }}/{{ item.card.repairTargetStreak || 3 }}
                        </span>
                      }
                    </div>
                  } @else if (item.card.isStitchedPassageCard) {
                    <div
                      class="rm-left-square rm-square-badge badge-stitched-square"
                      [class.selected]="isCardSelected(item.card.id)"
                      (click)="toggleSelectCard(item, $event)"
                      role="checkbox"
                      [attr.aria-checked]="isCardSelected(item.card.id)"
                      aria-label="Select stitched card"
                      data-testid="stitched-card-badge"
                    >
                      @if (isCardSelected(item.card.id)) {
                        <span class="square-check" aria-hidden="true">✓</span>
                      } @else {
                        <span class="square-icon">🔗</span>
                        <span class="square-sub">{{ getStitchedChunkCount(item) }}x</span>
                      }
                    </div>
                  } @else if (isPartiallyMemorized(item)) {
                    <div
                      class="rm-left-square rm-square-badge badge-partial-square"
                      [class.selected]="isCardSelected(item.card.id)"
                      (click)="toggleSelectCard(item, $event)"
                      role="checkbox"
                      [attr.aria-checked]="isCardSelected(item.card.id)"
                      aria-label="Select passage"
                      [attr.data-testid]="'left-square-known-' + i"
                    >
                      @if (isCardSelected(item.card.id)) {
                        <span class="square-check" aria-hidden="true">✓</span>
                      } @else {
                        <span class="square-primary">
                          {{ item.card.learningStep || 1 }}/{{ item.passage.verses.length }}
                        </span>
                      }
                    </div>
                  } @else {
                    <div
                      class="rm-left-square rm-square-badge"
                      [ngClass]="getLevelSquareClass(item)"
                      [class.selected]="isCardSelected(item.card.id)"
                      (click)="toggleSelectCard(item, $event)"
                      role="checkbox"
                      [attr.aria-checked]="isCardSelected(item.card.id)"
                      aria-label="Select passage"
                      [attr.data-testid]="'left-square-known-' + i"
                    >
                      @if (isCardSelected(item.card.id)) {
                        <span class="square-check" aria-hidden="true">✓</span>
                      } @else {
                        <span class="square-level">{{ getCardLevelNumber(item) }}</span>
                      }
                    </div>
                  }

                  <!-- Middle Reference + Optional Custom Label Only -->
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
                      @if (getOpeningSnippet(item); as cue) {
                        <span class="rm-snippet">({{ cue }})</span>
                      }
                    </div>
                  </div>

                  <!-- Right Tag + Recitation Time + Due Label -->
                  <div class="rm-row-right">
                    <div class="rm-meta-col">
                      <span class="rm-top-tag">{{ getRightTopTag(item) }} · ⏱ {{ getRecitationLabel(item) }}</span>
                      <span class="rm-sub-due">{{ getRelativeDueLabel(item) }}</span>
                    </div>
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

        <!-- ======================================================================= -->
        <!-- TAB 4: OUTLINE (Connected Chapter Mental Map & Labeled Chunks View)     -->
        <!-- ======================================================================= -->
        @if (activeTab === 'outline') {
          <section
            class="rm-list-section rm-outline-section"
            data-testid="outline-page-section"
          >
            @if (outlineGroups().length > 0) {
              @if (outlineGroups().length > 1) {
                <div class="rm-outline-utility-bar">
                  <span class="rm-outline-utility-summary">
                    {{ outlineGroups().length }} {{ outlineGroups().length === 1 ? 'group' : 'groups' }} · {{ totalOutlineChunksCount() }} {{ totalOutlineChunksCount() === 1 ? 'passage' : 'passages' }}
                  </span>
                  <button
                    type="button"
                    class="rm-outline-collapse-all-btn"
                    (click)="toggleCollapseAllOutlineGroups()"
                    data-testid="btn-outline-collapse-all"
                  >
                    {{ areAllOutlineGroupsCollapsed() ? '▸ Expand All' : '▾ Collapse All' }}
                  </button>
                </div>
              }

              @if (selectedCardIds().size !== 1) {
                <button
                  type="button"
                  class="rm-sr-only-alias"
                  (click)="onAppendToPassageClick(outlineGroups()[0].chunks[outlineGroups()[0].chunks.length - 1].item.passage, $event)"
                  tabindex="-1"
                  aria-hidden="true"
                  data-testid="btn-append-passage"
                >
                  + Append
                </button>
              }

              <div class="rm-outline-groups" data-testid="outline-group-list">
                @for (group of outlineGroups(); track group.groupId; let gIdx = $index) {
                  <div
                    class="rm-outline-group-card"
                    [class.collapsed]="isGroupCollapsed(group.groupKey)"
                    [class.group-selected]="isOutlineGroupAllSelected(group)"
                    [attr.data-testid]="'outline-group-' + gIdx"
                  >
                    <!-- Compact 42px Single-Line Group Header -->
                    <header
                      class="rm-outline-group-header"
                      (click)="toggleOutlineGroup(group.groupKey, $event)"
                    >
                      <!-- Top-Level Group Multi-Select Checkbox -->
                      <span
                        class="rm-outline-group-checkbox"
                        [class.selected]="isOutlineGroupAllSelected(group)"
                        [class.partial]="isOutlineGroupPartiallySelected(group)"
                        (click)="toggleSelectOutlineGroup(group, $event)"
                        role="checkbox"
                        tabindex="0"
                        (keydown.enter)="toggleSelectOutlineGroup(group, $event)"
                        (keydown.space)="toggleSelectOutlineGroup(group, $event)"
                        [attr.aria-checked]="
                          isOutlineGroupAllSelected(group)
                            ? 'true'
                            : isOutlineGroupPartiallySelected(group)
                              ? 'mixed'
                              : 'false'
                        "
                        aria-label="Select all chunks in group"
                        title="Select or unselect all chunks in this group"
                        [attr.data-testid]="'outline-group-select-' + gIdx"
                      >
                        @if (isOutlineGroupAllSelected(group)) {
                          ✓
                        } @else if (isOutlineGroupPartiallySelected(group)) {
                          −
                        } @else {
                          ▢
                        }
                      </span>

                      <button
                        type="button"
                        class="rm-outline-group-toggle"
                        (click)="toggleOutlineGroup(group.groupKey, $event)"
                        [attr.aria-expanded]="!isGroupCollapsed(group.groupKey)"
                        [attr.data-testid]="'btn-outline-toggle-group-' + gIdx"
                      >
                        <span class="rm-outline-chevron" aria-hidden="true">
                          {{ isGroupCollapsed(group.groupKey) ? '▸' : '▾' }}
                        </span>
                        <strong class="rm-outline-group-ref" [attr.data-testid]="'outline-group-ref-' + gIdx">
                          {{ group.groupReference }}
                        </strong>
                        <span class="rm-outline-chunk-count">
                          · {{ group.chunks.length }} {{ group.chunks.length === 1 ? 'passage' : 'passages' }}
                        </span>
                      </button>

                      <div class="rm-outline-header-actions" (click)="$event.stopPropagation()">
                        @if (group.chunks.length >= 2) {
                          <button
                            type="button"
                            class="rm-outline-combine-btn"
                            [disabled]="!getOutlineGroupCombineStatus(group).canCombine"
                            [title]="
                              getOutlineGroupCombineStatus(group).reason ||
                              'Sew contiguous passages together'
                            "
                            (click)="combineGroupChunks(group, $event)"
                            [attr.data-testid]="'btn-outline-combine-' + gIdx"
                          >
                            🪡 Sew
                          </button>
                        }

                        <button
                          type="button"
                          class="rm-outline-add-next-btn"
                          (click)="onAppendToPassageClick(group.chunks[group.chunks.length - 1].item.passage, $event)"
                          [title]="'Append verses (' + group.nextReferenceSuggestion + ')'"
                          [attr.data-testid]="'btn-outline-add-next-' + gIdx"
                        >
                          +v Append
                        </button>
                      </div>
                    </header>

                    <!-- Chunks in Canonical Order with Connected Spine & Seam/Gap Connectors -->
                    @if (!isGroupCollapsed(group.groupKey)) {
                      <div class="rm-outline-chunk-list">
                        @for (chunk of group.chunks; track chunk.item.card.id; let cIdx = $index) {
                          <div class="rm-outline-chunk-block">
                            <article
                              class="rm-outline-chunk-row"
                              [class.rm-row-selected]="isCardSelected(chunk.item.card.id)"
                              [class.verses-expanded]="isChunkVersesExpanded(chunk.item.passage.id)"
                              [attr.aria-expanded]="isChunkVersesExpanded(chunk.item.passage.id)"
                              (click)="toggleChunkVerses(chunk.item.passage.id, $event)"
                              role="button"
                              tabindex="0"
                              (keydown.enter)="toggleChunkVerses(chunk.item.passage.id, $event)"
                              [attr.data-testid]="'outline-chunk-' + gIdx + '-' + cIdx"
                            >
                              <!-- Left Pill: Verse Range Badge (Click to toggle multi-select) -->
                              <span
                                class="rm-outline-range-pill"
                                [class.selected]="isCardSelected(chunk.item.card.id)"
                                (click)="toggleSelectCard(chunk.item, $event)"
                                role="checkbox"
                                [attr.aria-checked]="isCardSelected(chunk.item.card.id)"
                                [attr.data-testid]="'outline-chunk-range-' + gIdx + '-' + cIdx"
                              >
                                @if (isCardSelected(chunk.item.card.id)) {
                                  ✓ {{ chunk.rangeBadge }}
                                } @else {
                                  {{ chunk.rangeBadge }}
                                }
                              </span>

                              <!-- Center: Section Title / First Words + Compact Verse Count & Recitation Time -->
                              <div class="rm-outline-chunk-center">
                                @if (editingOutlinePassageId() === chunk.item.passage.id) {
                                  <div
                                    class="rm-outline-inline-editor"
                                    (click)="$event.stopPropagation()"
                                  >
                                    <input
                                      type="text"
                                      class="rm-outline-inline-input"
                                      placeholder="Section title..."
                                      [value]="editingOutlineLabelDraft()"
                                      (input)="editingOutlineLabelDraft.set($any($event.target).value)"
                                      (keydown.enter)="saveInlineLabelEdit(chunk.item.passage, $event)"
                                      (keydown.escape)="cancelInlineLabelEdit($event)"
                                      data-testid="input-outline-inline-label"
                                    />
                                    <button
                                      type="button"
                                      class="rm-outline-inline-btn save"
                                      (click)="saveInlineLabelEdit(chunk.item.passage, $event)"
                                      title="Save section title"
                                      aria-label="Save section title"
                                      data-testid="btn-save-inline-label"
                                    >
                                      ✓
                                    </button>
                                    <button
                                      type="button"
                                      class="rm-outline-inline-btn cancel"
                                      (click)="cancelInlineLabelEdit($event)"
                                      title="Cancel editing"
                                      aria-label="Cancel editing"
                                      data-testid="btn-cancel-inline-label"
                                    >
                                      ✕
                                    </button>
                                  </div>
                                } @else {
                                  <div
                                    class="rm-outline-label-line"
                                    [attr.data-testid]="'btn-outline-inline-label-' + gIdx + '-' + cIdx"
                                  >
                                    @if (chunk.customLabel) {
                                      <strong
                                        class="rm-outline-custom-label"
                                        [attr.data-testid]="'outline-chunk-label-' + gIdx + '-' + cIdx"
                                      >
                                        {{ chunk.customLabel }}
                                      </strong>
                                    } @else {
                                      <span
                                        class="rm-outline-first-words"
                                        [attr.data-testid]="'outline-chunk-unlabeled-' + gIdx + '-' + cIdx"
                                      >
                                        “{{ getOutlineDefaultFirstWords(chunk.item.passage) }}”
                                      </span>
                                    }
                                  </div>
                                }

                                <span
                                  class="rm-outline-sub-meta"
                                  [attr.data-testid]="'btn-outline-peek-verses-' + gIdx + '-' + cIdx"
                                >
                                  {{ chunk.item.passage.verses.length }}v · ⏱ {{ chunk.recitationTime.label }}
                                </span>
                              </div>

                              <!-- Right: Compact SRS State Badge + 26x26 Edit Modal Button -->
                              <div class="rm-outline-chunk-right" (click)="$event.stopPropagation()">
                                <span
                                  class="rm-outline-srs-badge"
                                  [ngClass]="chunk.srsStatusClass"
                                  [attr.data-testid]="'outline-chunk-status-' + gIdx + '-' + cIdx"
                                >
                                  {{ chunk.srsStatusBadge }}
                                </span>

                                <button
                                  type="button"
                                  class="rm-outline-edit-btn"
                                  (click)="onEditClick(chunk.item, $event)"
                                  aria-label="Edit passage in modal"
                                  title="Edit passage in modal"
                                  [attr.data-testid]="'btn-outline-edit-' + gIdx + '-' + cIdx"
                                >
                                  ✎
                                </button>
                              </div>
                            </article>

                            <!-- Collapsible Inline Verse Text Preview -->
                            @if (isChunkVersesExpanded(chunk.item.passage.id)) {
                              <div
                                class="rm-outline-chunk-verses"
                                (click)="$event.stopPropagation()"
                                [attr.data-testid]="'outline-chunk-verses-' + gIdx + '-' + cIdx"
                              >
                                @for (verse of chunk.item.passage.verses; track $index) {
                                  <p class="rm-outline-verse-line">
                                    <span class="rm-outline-verse-num">[{{ verse.verseNumber }}]</span>
                                    {{ verse.text }}
                                  </p>
                                }
                              </div>
                            }

                            <!-- Inter-Chunk Seam vs. Gap Connectors on the Visual Spine -->
                            @if (cIdx < group.chunks.length - 1) {
                              @if (isChunkPairContiguous(chunk, group.chunks[cIdx + 1])) {
                                <div
                                  class="rm-outline-seam-connector"
                                  [attr.data-testid]="'outline-seam-connector-' + gIdx + '-' + cIdx"
                                >
                                  <span class="rm-outline-seam-pill">
                                    🪡 Auto-Seam (v. {{ chunk.endVerse }} → v. {{ group.chunks[cIdx + 1].startVerse }})
                                  </span>
                                </div>
                              } @else if (hasChunkPairGap(chunk, group.chunks[cIdx + 1])) {
                                <div
                                  class="rm-outline-gap-connector"
                                  [attr.data-testid]="'outline-gap-connector-' + gIdx + '-' + cIdx"
                                >
                                  <span class="rm-outline-gap-pill">
                                    {{ formatChunkPairGapLabel(chunk, group.chunks[cIdx + 1]) }}
                                  </span>
                                </div>
                              }
                            }
                          </div>
                        }
                      </div>
                    }
                  </div>
                }
              </div>
            } @else {
              <div class="rm-empty-state" data-testid="empty-outline-state">
                <p class="rm-empty-title">No passages in your outline yet</p>
                <p class="rm-empty-sub">Tap <strong>+</strong> below to add a passage or split a chapter into named chunks.</p>
              </div>
            }
          </section>
        }
      </div>

      <!-- Floating Bottom Circular Action Buttons -->
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
        --rm-row-selected-bg: rgba(245, 158, 11, 0.12);
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
        display: flex;
        flex-direction: column;
        height: 100%;
        overflow: hidden;
        user-select: none;
        -webkit-user-select: none;
        -webkit-touch-callout: none;
      }

      :host-context(.light-theme),
      :host-context(html:not(.dark-theme)) {
        --rm-bg: #f8fafc;
        --rm-row-hover: #f1f5f9;
        --rm-row-selected-bg: rgba(245, 158, 11, 0.14);
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
        height: 100%;
        max-height: calc(100dvh - 56px);
        overflow: hidden;
        display: flex;
        flex-direction: column;
        background: var(--rm-bg);
        color: var(--rm-text-primary);
        user-select: none;
        -webkit-user-select: none;
        -webkit-touch-callout: none;
      }

      /* ===================================================================== */
      /* 4-Tab Header Strip Pinned to Top                                      */
      /* ===================================================================== */
      .rm-tabs,
      .rm-tabs-bar {
        flex-shrink: 0;
        position: sticky;
        top: 0;
        z-index: 20;
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        background: var(--rm-header-bg);
        border-bottom: 1px solid var(--rm-divider);
        user-select: none;
        -webkit-user-select: none;
        -webkit-touch-callout: none;
      }

      .rm-tab {
        position: relative;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 0.18rem;
        padding: 0.55rem 0.25rem 0.5rem;
        border: none;
        background: transparent;
        color: var(--rm-tab-text);
        cursor: pointer;
        transition: background 0.15s ease, color 0.15s ease;
        user-select: none;
        -webkit-user-select: none;
        -webkit-touch-callout: none;
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
        padding: 0 0.25rem;
      }

      .rm-tab-icon {
        font-size: 1.05rem;
        line-height: 1;
        font-weight: 700;
      }

      .rm-tab-count {
        font-size: 0.66rem;
        font-weight: 800;
        line-height: 1;
        padding: 0.14rem 0.36rem;
        border-radius: 999px;
        background: rgba(148, 163, 184, 0.18);
        color: var(--rm-tab-text);
        margin-left: 0.2rem;
      }

      .rm-tab.active .rm-tab-count {
        background: var(--rm-tab-badge-bg);
        color: var(--rm-tab-badge-text);
      }

      .rm-tab-label {
        font-size: 0.68rem;
        font-weight: 700;
        letter-spacing: 0.05em;
        text-transform: uppercase;
      }

      /* ===================================================================== */
      /* Multi-Select Batch Action Bar & Due Overall Time Strip                */
      /* ===================================================================== */
      .rm-multiselect-bar {
        flex-shrink: 0;
        position: sticky;
        top: 0;
        z-index: 20;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.5rem;
        flex-wrap: wrap;
        padding: 0.45rem 0.75rem;
        background: #1e293b;
        border-bottom: 1px solid rgba(245, 158, 11, 0.4);
        color: #f8fafc;
        user-select: none;
        -webkit-user-select: none;
        -webkit-touch-callout: none;
      }

      :host-context(.light-theme) .rm-multiselect-bar,
      :host-context(html:not(.dark-theme)) .rm-multiselect-bar {
        background: #fef3c7;
        border-bottom-color: #f59e0b;
        color: #0f172a;
      }

      .rm-ms-left {
        display: flex;
        align-items: center;
        gap: 0.45rem;
      }

      .rm-ms-clear-btn {
        width: 28px;
        height: 28px;
        border-radius: 6px;
        border: 1px solid rgba(148, 163, 184, 0.35);
        background: transparent;
        color: inherit;
        font-size: 0.85rem;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }

      .rm-ms-count {
        font-size: 0.82rem;
        font-weight: 700;
      }

      .rm-ms-select-all-btn {
        padding: 0.22rem 0.55rem;
        border-radius: 6px;
        border: 1px solid rgba(148, 163, 184, 0.35);
        background: rgba(255, 255, 255, 0.06);
        color: inherit;
        font-size: 0.75rem;
        font-weight: 600;
        cursor: pointer;
      }

      .rm-ms-actions {
        display: flex;
        align-items: center;
        gap: 0.4rem;
        flex-wrap: wrap;
      }

      .rm-ms-btn {
        padding: 0.32rem 0.65rem;
        border-radius: 6px;
        border: 1px solid rgba(148, 163, 184, 0.35);
        background: rgba(15, 23, 42, 0.65);
        color: #f8fafc;
        font-size: 0.78rem;
        font-weight: 700;
        cursor: pointer;
        white-space: nowrap;
        transition: all 0.12s ease;
      }

      :host-context(.light-theme) .rm-ms-btn,
      :host-context(html:not(.dark-theme)) .rm-ms-btn {
        background: #ffffff;
        color: #0f172a;
        border-color: #cbd5e1;
      }

      .rm-ms-move {
        border-color: #0d9488;
        background: rgba(13, 148, 136, 0.22);
        color: #5eead4;
      }

      :host-context(.light-theme) .rm-ms-move,
      :host-context(html:not(.dark-theme)) .rm-ms-move {
        background: #ccfbf1;
        color: #0f766e;
        border-color: #14b8a6;
      }

      .rm-ms-delete {
        border-color: rgba(239, 68, 68, 0.5);
        background: rgba(239, 68, 68, 0.16);
        color: #fca5a5;
      }

      :host-context(.light-theme) .rm-ms-delete,
      :host-context(html:not(.dark-theme)) .rm-ms-delete {
        background: #fee2e2;
        color: #b91c1c;
        border-color: #f87171;
      }

      .rm-ms-delete.confirming {
        background: #dc2626;
        border-color: #ef4444;
        color: #ffffff;
      }

      .rm-due-summary-bar {
        flex-shrink: 0;
        position: sticky;
        top: 0;
        z-index: 19;
        padding: 0.42rem 0.9rem;
        font-size: 0.78rem;
        font-weight: 600;
        color: #fbbf24;
        background: rgba(245, 158, 11, 0.08);
        border-bottom: 1px solid var(--rm-divider);
        display: flex;
        align-items: center;
        gap: 0.4rem;
      }

      :host-context(.light-theme) .rm-due-summary-bar,
      :host-context(html:not(.dark-theme)) .rm-due-summary-bar {
        color: #b45309;
        background: #fffbeb;
      }

      /* ===================================================================== */
      /* Independently Scrollable List Container & Flat Rows                   */
      /* ===================================================================== */
      .rm-list-container {
        flex: 1;
        overflow-y: auto;
        -webkit-overflow-scrolling: touch;
        padding-bottom: 5.5rem;
        display: flex;
        flex-direction: column;
      }

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
        user-select: none;
        -webkit-user-select: none;
        -webkit-touch-callout: none;
      }

      .rm-row:hover {
        background: var(--rm-row-hover);
      }

      .rm-row.rm-row-selected {
        background: var(--rm-row-selected-bg);
      }

      .rm-row:focus-visible {
        outline: 2px solid #f59e0b;
        outline-offset: -2px;
      }

      /* Left 42x42px Rounded Square (Multi-Select Toggle) */
      .rm-left-square,
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
        cursor: pointer;
        user-select: none;
        -webkit-user-select: none;
        -webkit-touch-callout: none;
        transition: transform 0.12s ease, box-shadow 0.12s ease;
      }

      .rm-left-square.selected {
        background: linear-gradient(135deg, #f59e0b 0%, #2563eb 100%) !important;
        border: 2px solid #fbbf24 !important;
        box-shadow: 0 0 0 2px rgba(245, 158, 11, 0.45), 0 0 10px rgba(59, 130, 246, 0.45);
        color: #ffffff !important;
      }

      .square-check {
        font-size: 1.15rem;
        font-weight: 900;
        line-height: 1;
        color: #ffffff;
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

      /* Middle Single-Line Reference + Optional Custom Label */
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

      .rm-icon-action {
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

      .rm-row:hover .rm-icon-action {
        opacity: 0.9;
      }

      .rm-icon-action:disabled {
        opacity: 0.2;
        cursor: default;
      }

      .rm-icon-action:hover:not(:disabled) {
        opacity: 1;
        background: rgba(245, 158, 11, 0.12);
        color: #f59e0b;
      }

      /* ===================================================================== */
      /* TAB 4: OUTLINE (Connected Chapter Mental Map & Labeled Chunks)        */
      /* ===================================================================== */
      .rm-outline-section {
        padding: 0.65rem 0.6rem 1.5rem;
      }

      .rm-sr-only-alias {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border: 0;
      }

      .rm-outline-utility-bar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.5rem;
        margin-bottom: 0.55rem;
        padding: 0.3rem 0.65rem;
        border-radius: 0.5rem;
        background: rgba(15, 23, 42, 0.45);
        border: 1px solid var(--rm-divider);
      }

      :host-context(.light-theme) .rm-outline-utility-bar,
      :host-context(html:not(.dark-theme)) .rm-outline-utility-bar {
        background: #f1f5f9;
      }

      .rm-outline-utility-summary {
        font-size: 0.72rem;
        font-weight: 600;
        color: var(--rm-text-muted);
      }

      .rm-outline-collapse-all-btn {
        background: transparent;
        border: 1px solid var(--rm-divider);
        border-radius: 0.38rem;
        padding: 0.18rem 0.5rem;
        font-size: 0.7rem;
        font-weight: 700;
        color: var(--rm-text-snippet);
        cursor: pointer;
        transition: all 0.12s ease;
      }

      .rm-outline-collapse-all-btn:hover {
        border-color: #f59e0b;
        color: #fbbf24;
      }

      .rm-outline-groups {
        display: flex;
        flex-direction: column;
        gap: 0.7rem;
      }

      .rm-outline-group-card {
        border: 1px solid var(--rm-divider);
        border-radius: 0.7rem;
        background: var(--rm-header-bg);
        overflow: hidden;
        box-shadow: 0 3px 10px rgba(0, 0, 0, 0.14);
      }

      .rm-outline-group-card.group-selected {
        border-color: rgba(245, 158, 11, 0.55);
      }

      .rm-outline-group-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.35rem;
        flex-wrap: nowrap;
        min-height: 42px;
        padding: 0.35rem 0.5rem;
        background: rgba(15, 23, 42, 0.58);
        border-bottom: 1px solid var(--rm-divider);
        cursor: pointer;
      }

      .rm-outline-group-checkbox {
        width: 20px;
        height: 20px;
        border-radius: 0.32rem;
        border: 1.5px solid rgba(148, 163, 184, 0.5);
        background: rgba(15, 23, 42, 0.45);
        color: var(--rm-text-muted);
        font-size: 0.72rem;
        font-weight: 800;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        cursor: pointer;
        user-select: none;
        transition: all 0.12s ease;
      }

      :host-context(.light-theme) .rm-outline-group-checkbox,
      :host-context(html:not(.dark-theme)) .rm-outline-group-checkbox {
        background: #ffffff;
        border-color: #94a3b8;
      }

      .rm-outline-group-checkbox:hover {
        border-color: #f59e0b;
        color: #fbbf24;
      }

      .rm-outline-group-checkbox.partial {
        border-color: #f59e0b;
        background: rgba(245, 158, 11, 0.22);
        color: #fbbf24;
      }

      .rm-outline-group-checkbox.selected {
        background: linear-gradient(135deg, #f59e0b 0%, #2563eb 100%);
        border-color: #fbbf24;
        color: #ffffff;
      }

      .rm-outline-group-card.collapsed .rm-outline-group-header {
        border-bottom: none;
      }

      :host-context(.light-theme) .rm-outline-group-header,
      :host-context(html:not(.dark-theme)) .rm-outline-group-header {
        background: #f8fafc;
      }

      .rm-outline-group-toggle {
        display: inline-flex;
        align-items: center;
        gap: 0.28rem;
        min-width: 0;
        flex: 1 0 auto;
        padding: 0.15rem 0;
        background: transparent;
        border: none;
        color: inherit;
        text-align: left;
        cursor: pointer;
      }

      .rm-outline-chevron {
        font-size: 0.78rem;
        color: var(--rm-text-muted);
        width: 11px;
        flex-shrink: 0;
      }

      .rm-outline-group-ref {
        font-size: 0.85rem;
        font-weight: 800;
        color: var(--rm-text-primary);
        white-space: nowrap;
        flex-shrink: 0;
      }

      .rm-outline-chunk-count {
        font-size: 0.72rem;
        font-weight: 600;
        color: var(--rm-text-muted);
        white-space: nowrap;
        flex-shrink: 0;
      }

      .rm-outline-add-next-btn {
        padding: 0.2rem 0.45rem;
        border-radius: 0.4rem;
        border: 1px solid rgba(245, 158, 11, 0.4);
        background: rgba(245, 158, 11, 0.12);
        color: #fbbf24;
        font-size: 0.7rem;
        font-weight: 700;
        cursor: pointer;
        white-space: nowrap;
        transition: background 0.12s ease;
      }

      :host-context(.light-theme) .rm-outline-add-next-btn,
      :host-context(html:not(.dark-theme)) .rm-outline-add-next-btn {
        background: #fef3c7;
        border-color: #f59e0b;
        color: #b45309;
      }

      .rm-outline-add-next-btn:hover {
        background: rgba(245, 158, 11, 0.24);
      }

      .rm-outline-chunk-list {
        display: flex;
        flex-direction: column;
        position: relative;
      }

      .rm-outline-chunk-block {
        display: flex;
        flex-direction: column;
        border-bottom: 1px solid var(--rm-divider);
      }

      .rm-outline-chunk-block:last-child {
        border-bottom: none;
      }

      .rm-outline-chunk-row {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.5rem 0.65rem;
        cursor: pointer;
        transition: background 0.12s ease;
      }

      .rm-outline-chunk-row:hover {
        background: var(--rm-row-hover);
      }

      .rm-outline-range-pill {
        flex-shrink: 0;
        min-width: 48px;
        text-align: center;
        padding: 0.2rem 0.42rem;
        border-radius: 0.38rem;
        background: rgba(13, 148, 136, 0.18);
        border: 1px solid rgba(20, 184, 166, 0.4);
        color: #5eead4;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        font-size: 0.72rem;
        font-weight: 700;
      }

      :host-context(.light-theme) .rm-outline-range-pill,
      :host-context(html:not(.dark-theme)) .rm-outline-range-pill {
        background: #ccfbf1;
        border-color: #5eead4;
        color: #0f766e;
      }

      .rm-outline-chunk-center {
        flex: 1 1 0;
        min-width: 0;
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 0.14rem;
      }

      .rm-outline-label-line {
        width: 100%;
        white-space: normal;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
        line-height: 1.25;
        cursor: pointer;
      }

      .rm-outline-custom-label {
        font-size: 0.88rem;
        font-weight: 700;
        color: #fbbf24;
      }

      :host-context(.light-theme) .rm-outline-custom-label,
      :host-context(html:not(.dark-theme)) .rm-outline-custom-label {
        color: #b45309;
      }

      .rm-outline-first-words {
        font-size: 0.84rem;
        font-weight: 500;
        color: var(--rm-text-primary);
      }

      .rm-outline-unlabeled {
        font-size: 0.79rem;
        font-style: italic;
        color: var(--rm-text-muted);
      }

      .rm-outline-inline-editor {
        display: flex;
        align-items: center;
        gap: 0.28rem;
        width: 100%;
      }

      .rm-outline-inline-input {
        flex: 1 1 0;
        min-width: 0;
        height: 28px;
        padding: 0.15rem 0.45rem;
        border-radius: 0.35rem;
        border: 1px solid #f59e0b;
        background: rgba(15, 23, 42, 0.85);
        color: var(--rm-text-primary);
        font-size: 0.82rem;
        font-weight: 600;
        outline: none;
      }

      :host-context(.light-theme) .rm-outline-inline-input,
      :host-context(html:not(.dark-theme)) .rm-outline-inline-input {
        background: #ffffff;
        color: #0f172a;
      }

      .rm-outline-inline-btn {
        width: 24px;
        height: 24px;
        border-radius: 0.32rem;
        border: 1px solid var(--rm-divider);
        background: rgba(255, 255, 255, 0.06);
        color: var(--rm-text-primary);
        font-size: 0.74rem;
        font-weight: 700;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        flex-shrink: 0;
      }

      .rm-outline-inline-btn.save {
        border-color: rgba(16, 185, 129, 0.5);
        background: rgba(16, 185, 129, 0.18);
        color: #6ee7b7;
      }

      .rm-outline-inline-btn.cancel {
        color: var(--rm-text-muted);
      }

      .rm-outline-sub-meta {
        display: inline-flex;
        align-items: center;
        gap: 0.25rem;
        padding: 0;
        background: transparent;
        border: none;
        font-size: 0.72rem;
        color: var(--rm-text-muted);
        white-space: nowrap;
        cursor: pointer;
      }

      .rm-outline-chunk-right {
        display: flex;
        align-items: center;
        gap: 0.32rem;
        flex-shrink: 0;
      }

      .rm-outline-srs-badge {
        font-size: 0.65rem;
        font-weight: 700;
        padding: 0.14rem 0.4rem;
        border-radius: 999px;
        text-transform: uppercase;
        letter-spacing: 0.02em;
        white-space: nowrap;
      }

      .rm-outline-srs-badge.status-new {
        background: rgba(148, 163, 184, 0.16);
        color: var(--rm-text-snippet);
      }

      .rm-outline-srs-badge.status-due {
        background: rgba(245, 158, 11, 0.2);
        color: #fbbf24;
        border: 1px solid rgba(245, 158, 11, 0.4);
      }

      :host-context(.light-theme) .rm-outline-srs-badge.status-due,
      :host-context(html:not(.dark-theme)) .rm-outline-srs-badge.status-due {
        background: #fef3c7;
        color: #b45309;
      }

      .rm-outline-srs-badge.status-known {
        background: rgba(16, 185, 129, 0.16);
        color: #6ee7b7;
      }

      :host-context(.light-theme) .rm-outline-srs-badge.status-known,
      :host-context(html:not(.dark-theme)) .rm-outline-srs-badge.status-known {
        background: #d1fae5;
        color: #065f46;
      }

      .rm-outline-edit-btn {
        width: 26px;
        height: 26px;
        border-radius: 6px;
        border: 1px solid var(--rm-divider);
        background: rgba(255, 255, 255, 0.04);
        color: var(--rm-text-snippet);
        font-size: 0.78rem;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        transition: all 0.12s ease;
      }

      .rm-outline-edit-btn:hover {
        border-color: #f59e0b;
        color: #fbbf24;
        background: rgba(245, 158, 11, 0.14);
      }

      .rm-outline-chunk-verses {
        margin: 0 0.65rem 0.5rem 2.2rem;
        padding: 0.45rem 0.65rem;
        border-radius: 0.45rem;
        border-left: 2px solid rgba(20, 184, 166, 0.5);
        background: rgba(15, 23, 42, 0.42);
        display: flex;
        flex-direction: column;
        gap: 0.28rem;
      }

      :host-context(.light-theme) .rm-outline-chunk-verses,
      :host-context(html:not(.dark-theme)) .rm-outline-chunk-verses {
        background: #f8fafc;
      }

      .rm-outline-verse-line {
        margin: 0;
        font-size: 0.78rem;
        line-height: 1.4;
        color: var(--rm-text-primary);
      }

      .rm-outline-verse-num {
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        font-weight: 700;
        color: #5eead4;
        margin-right: 0.25rem;
      }

      :host-context(.light-theme) .rm-outline-verse-num,
      :host-context(html:not(.dark-theme)) .rm-outline-verse-num {
        color: #0f766e;
      }

      .rm-outline-seam-connector,
      .rm-outline-gap-connector {
        display: flex;
        align-items: center;
        padding: 0.16rem 0.65rem 0.28rem 1.4rem;
        font-size: 0.68rem;
      }

      .rm-outline-seam-pill {
        display: inline-flex;
        align-items: center;
        gap: 0.25rem;
        padding: 0.1rem 0.48rem;
        border-radius: 999px;
        background: rgba(20, 184, 166, 0.13);
        border: 1px solid rgba(45, 212, 191, 0.35);
        color: #5eead4;
        font-weight: 600;
      }

      :host-context(.light-theme) .rm-outline-seam-pill,
      :host-context(html:not(.dark-theme)) .rm-outline-seam-pill {
        background: #ccfbf1;
        border-color: #5eead4;
        color: #0f766e;
      }

      .rm-outline-gap-pill {
        display: inline-flex;
        align-items: center;
        gap: 0.25rem;
        padding: 0.1rem 0.48rem;
        border-radius: 999px;
        background: rgba(148, 163, 184, 0.12);
        border: 1px dashed rgba(148, 163, 184, 0.4);
        color: var(--rm-text-muted);
        font-style: italic;
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
      /* Floating Bottom Circular Action Buttons                               */
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

      .rm-outline-header-actions {
        display: flex;
        align-items: center;
        gap: 0.3rem;
        flex-shrink: 0;
      }

      .rm-outline-combine-btn {
        padding: 0.2rem 0.45rem;
        border-radius: 0.4rem;
        border: 1px solid rgba(129, 140, 248, 0.45);
        background: rgba(79, 70, 229, 0.16);
        color: #a5b4fc;
        font-size: 0.7rem;
        font-weight: 700;
        cursor: pointer;
        white-space: nowrap;
        transition: background 0.12s ease;
      }

      .rm-outline-combine-btn:hover:not(:disabled) {
        background: rgba(79, 70, 229, 0.28);
      }

      .rm-outline-combine-btn:disabled,
      .rm-ms-combine:disabled {
        opacity: 0.45;
        cursor: not-allowed;
        filter: grayscale(0.35);
      }

      .rm-outline-range-pill.selected {
        background: linear-gradient(135deg, #f59e0b 0%, #2563eb 100%);
        border-color: #fbbf24;
        color: #ffffff;
      }

      .rm-ms-append,
      .rm-ms-combine {
        border-color: rgba(245, 158, 11, 0.45);
        background: rgba(245, 158, 11, 0.16);
        color: #fbbf24;
      }

      :host-context(.light-theme) .rm-ms-append,
      :host-context(html:not(.dark-theme)) .rm-ms-append,
      :host-context(.light-theme) .rm-ms-combine,
      :host-context(html:not(.dark-theme)) .rm-ms-combine {
        background: #fef3c7;
        border-color: #f59e0b;
        color: #b45309;
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
export class DeckDashboardComponent implements OnChanges {
  readonly storageService = inject(StorageService);
  private readonly srsService = inject(SrsService);

  @Input() activeTab: DashboardTab = 'queue';
  @Output() activeTabChange = new EventEmitter<'queue' | 'due' | 'active'>();

  @Output() startDueSession = new EventEmitter<void>();
  @Output() studySingleItem = new EventEmitter<DeckItem>();
  @Output() practiceSingleItem = new EventEmitter<DeckItem>();
  @Output() startMemorizeFlow = new EventEmitter<DeckItem>();
  @Output() editItem = new EventEmitter<DeckItem>();
  @Output() editPassage = new EventEmitter<Passage>();
  @Output() appendPassage = new EventEmitter<Passage>();
  @Output() openAddModal = new EventEmitter<void>();
  @Output() openAddPassage = new EventEmitter<void>();
  @Output() openProtoSync = new EventEmitter<void>();

  /** Multi-select state */
  readonly selectedCardIds = signal<Set<string>>(new Set());
  readonly confirmingDelete = signal<boolean>(false);

  /** Outline expand/collapse (defaults to all groups collapsed) and fast inline label editing state */
  readonly expandedOutlineGroups = signal<Set<string>>(new Set());
  readonly expandedOutlineChunkIds = signal<Set<string>>(new Set());
  readonly editingOutlinePassageId = signal<string | null>(null);
  readonly editingOutlineLabelDraft = signal<string>('');

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['activeTab'] && !changes['activeTab'].firstChange) {
      this.clearSelection();
      this.cancelInlineLabelEdit();
    }
  }

  /**
   * Base (non-repair, non-auto-stitched) passage items across the user's deck.
   */
  readonly basePassageItems = computed<DeckItem[]>(() => {
    return this.storageService
      .deckItems()
      .filter(
        (item) =>
          !item.card.isRepairCard &&
          !item.card.isStitchedPassageCard &&
          !item.passage.id.startsWith('psg_stitched_') &&
          !item.passage.id.startsWith('psg_seam_')
      );
  });

  readonly totalOutlineChunksCount = computed<number>(
    () => this.basePassageItems().length
  );

  getOutlineDefaultFirstWords(passage: Passage): string {
    const firstVerseText = (passage.verses?.[0]?.text || '').trim();
    if (!firstVerseText) {
      return passage.reference;
    }
    const words = firstVerseText.split(/\s+/);
    const maxWords = 7;
    if (words.length <= maxWords) {
      return firstVerseText;
    }
    const snippet = words
      .slice(0, maxWords)
      .join(' ')
      .replace(/[,;:.!?—–-]+$/, '');
    return `${snippet}…`;
  }

  /**
   * Canonical Passages & Chunks Outline groups sorted in Bible order.
   */
  readonly outlineGroups = computed<OutlinePassageGroup[]>(() => {
    const baseItems = this.basePassageItems();
    if (baseItems.length === 0) {
      return [];
    }

    const allCards = this.storageService.flashcards();
    const entries: OutlineChunkEntry[] = baseItems.map((item) => {
      const parsed = this.parsePassageCoordinates(item.passage);
      const rangeBadge =
        parsed.startChapter === parsed.endChapter
          ? parsed.startVerse === parsed.endVerse
            ? `${parsed.startChapter}:${parsed.startVerse}`
            : `${parsed.startChapter}:${parsed.startVerse}–${parsed.endVerse}`
          : `${parsed.startChapter}:${parsed.startVerse}–${parsed.endChapter}:${parsed.endVerse}`;

      let srsStatusBadge = 'NEW';
      let srsStatusClass: 'status-new' | 'status-due' | 'status-known' = 'status-new';
      if (item.card.state === CardState.CARD_STATE_NEW) {
        srsStatusBadge = 'NEW';
        srsStatusClass = 'status-new';
      } else if (item.isDue) {
        srsStatusBadge = this.isPartiallyMemorized(item)
          ? `${item.card.learningStep || 1}/${item.passage.verses.length} DUE`
          : 'DUE';
        srsStatusClass = 'status-due';
      } else {
        const rel = this.getRelativeDueLabel(item);
        srsStatusBadge = this.isPartiallyMemorized(item)
          ? `${item.card.learningStep || 1}/${item.passage.verses.length} · ${rel}`
          : `KNOWN · ${rel}`;
        srsStatusClass = 'status-known';
      }

      const recitationTime = estimateRecitationTime(item.passage.verses);

      return {
        item,
        bookDisplay: parsed.bookDisplay,
        bookOrder: parsed.bookOrder,
        startChapter: parsed.startChapter,
        startVerse: parsed.startVerse,
        endChapter: parsed.endChapter,
        endVerse: parsed.endVerse,
        rangeBadge,
        customLabel: item.passage.label?.trim() || '',
        recitationLabel: recitationTime.label,
        recitationTime,
        srsStatusBadge,
        srsStatusClass,
      };
    });

    entries.sort((a, b) => {
      if (a.bookOrder !== b.bookOrder) {
        return a.bookOrder - b.bookOrder;
      }
      const bookCmp = a.bookDisplay.localeCompare(b.bookDisplay);
      if (bookCmp !== 0) {
        return bookCmp;
      }
      if (a.startChapter !== b.startChapter) {
        return a.startChapter - b.startChapter;
      }
      if (a.startVerse !== b.startVerse) {
        return a.startVerse - b.startVerse;
      }
      return a.endVerse - b.endVerse;
    });

    // Group contiguous or same-book/chapter chunks
    const rawClusters: OutlineChunkEntry[][] = [];
    for (const entry of entries) {
      if (rawClusters.length === 0) {
        rawClusters.push([entry]);
        continue;
      }
      const currentCluster = rawClusters[rawClusters.length - 1];
      const prev = currentCluster[currentCluster.length - 1];
      const sameBook =
        entry.bookDisplay.toLowerCase() === prev.bookDisplay.toLowerCase();
      const sameChapOrContiguous =
        sameBook &&
        (entry.startChapter === prev.endChapter ||
          (entry.startChapter === prev.endChapter + 1 && entry.startVerse === 1));

      if (sameChapOrContiguous) {
        currentCluster.push(entry);
      } else {
        rawClusters.push([entry]);
      }
    }

    return rawClusters.map((cluster, idx) => {
      const first = cluster[0];
      const last = cluster[cluster.length - 1];

      let hasDisjointGap = false;
      for (let i = 0; i < cluster.length - 1; i++) {
        const curr = cluster[i];
        const next = cluster[i + 1];
        if (!this.isChunkPairContiguous(curr, next)) {
          hasDisjointGap = true;
          break;
        }
      }

      const groupReference = hasDisjointGap
        ? first.startChapter === last.endChapter
          ? `${first.bookDisplay} ${first.startChapter}`
          : `${first.bookDisplay} ${first.startChapter}–${last.endChapter}`
        : first.startChapter === last.endChapter
          ? first.startVerse === last.endVerse
            ? `${first.bookDisplay} ${first.startChapter}:${first.startVerse}`
            : `${first.bookDisplay} ${first.startChapter}:${first.startVerse}–${last.endVerse}`
          : `${first.bookDisplay} ${first.startChapter}:${first.startVerse}–${last.endChapter}:${last.endVerse}`;

      const nextReferenceSuggestion = `${last.bookDisplay} ${last.endChapter}:${last.endVerse + 1}-${last.endVerse + 4}`;
      const clusterIds = new Set(cluster.map((c) => c.item.passage.id));

      const hasActiveSeamCard = allCards.some(
        (c) =>
          c.id.startsWith('card_seam_') &&
          (c.stitchedPassageIds ?? []).some((pid) => clusterIds.has(pid))
      );
      const hasActiveStitchedCard = allCards.some(
        (c) =>
          c.id.startsWith('card_stitched_') &&
          (c.stitchedPassageIds ?? []).some((pid) => clusterIds.has(pid))
      );

      const groupKey = `${first.bookDisplay.toLowerCase()}_${first.startChapter}_${idx}`;

      return {
        groupId: `outline_group_${idx}_${first.item.passage.id}`,
        groupKey,
        bookDisplay: first.bookDisplay,
        groupReference,
        nextReferenceSuggestion,
        chunks: cluster,
        hasActiveSeamCard,
        hasActiveStitchedCard,
        hasDisjointGap,
        seamCount: Math.max(0, cluster.length - 1),
      };
    });
  });

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
    if (this.activeTab === 'outline') {
      return this.basePassageItems();
    }
    return this.newTabItems();
  });

  /**
   * Overall recitation time prediction across all due items (attached only to the verses actively being recited).
   */
  readonly totalDueTimeLabel = computed<string>(() => {
    const items = this.dueTabItems();
    if (items.length === 0) {
      return '~0s';
    }
    const allRecitedVerses = items.flatMap((item) => this.getActiveRecitedVerses(item));
    return estimateRecitationTime(allRecitedVerses).label;
  });

  selectTab(tab: DashboardTab): void {
    this.activeTab = tab;
    this.clearSelection();
    this.cancelInlineLabelEdit();
    if (tab === 'queue' || tab === 'due' || tab === 'active') {
      this.activeTabChange.emit(tab);
    }
  }

  isGroupCollapsed(groupKey: string): boolean {
    return !this.expandedOutlineGroups().has(groupKey);
  }

  toggleOutlineGroup(groupKey: string, event?: Event): void {
    event?.stopPropagation();
    const next = new Set(this.expandedOutlineGroups());
    if (next.has(groupKey)) {
      next.delete(groupKey);
    } else {
      next.add(groupKey);
    }
    this.expandedOutlineGroups.set(next);
  }

  areAllOutlineGroupsCollapsed(): boolean {
    const groups = this.outlineGroups();
    if (groups.length === 0) {
      return true;
    }
    const expanded = this.expandedOutlineGroups();
    return groups.every((g) => !expanded.has(g.groupKey));
  }

  toggleAllOutlineGroups(event?: Event): void {
    event?.stopPropagation();
    if (this.areAllOutlineGroupsCollapsed()) {
      const allKeys = new Set(this.outlineGroups().map((g) => g.groupKey));
      this.expandedOutlineGroups.set(allKeys);
      return;
    }
    this.expandedOutlineGroups.set(new Set());
  }

  toggleCollapseAllOutlineGroups(event?: Event): void {
    this.toggleAllOutlineGroups(event);
  }

  isChunkVersesExpanded(passageId: string): boolean {
    return this.expandedOutlineChunkIds().has(passageId);
  }

  toggleChunkVerses(passageId: string, event?: Event): void {
    event?.stopPropagation();
    const next = new Set(this.expandedOutlineChunkIds());
    if (next.has(passageId)) {
      next.delete(passageId);
    } else {
      next.add(passageId);
    }
    this.expandedOutlineChunkIds.set(next);
  }

  startInlineLabelEdit(passage: Passage, event?: Event): void {
    event?.stopPropagation();
    this.editingOutlinePassageId.set(passage.id);
    this.editingOutlineLabelDraft.set(passage.label?.trim() || '');
  }

  saveInlineLabelEdit(passage: Passage, event?: Event): void {
    event?.stopPropagation();
    const draft = this.editingOutlineLabelDraft().trim();
    const svc = this.storageService as BatchCapableStorageService;
    if (typeof svc.updatePassageLabel === 'function') {
      svc.updatePassageLabel(passage.id, draft);
    } else {
      this.storageService.updatePassage(
        passage.id,
        passage.reference,
        passage.verses,
        passage.verses,
        draft || undefined
      );
    }
    this.editingOutlinePassageId.set(null);
    this.editingOutlineLabelDraft.set('');
  }

  cancelInlineLabelEdit(event?: Event): void {
    event?.stopPropagation();
    this.editingOutlinePassageId.set(null);
    this.editingOutlineLabelDraft.set('');
  }

  /**
   * Evaluates whether the currently selected passages can be combined (requires >= 2 contiguous passages in the same book).
   */
  readonly combineSelectionStatus = computed<{ canCombine: boolean; reason?: string }>(() => {
    const selectedIds = this.selectedCardIds();
    if (selectedIds.size < 2) {
      return {
        canCombine: false,
        reason: 'Select at least 2 contiguous passages to combine',
      };
    }

    const allItems = this.storageService.deckItems();
    const selectedItems = allItems.filter((item) => selectedIds.has(item.card.id));
    return this.evaluateChunksContiguity(selectedItems);
  });

  isChunkPairContiguous(prev: OutlineChunkEntry, next: OutlineChunkEntry): boolean {
    if (prev.bookDisplay.toLowerCase() !== next.bookDisplay.toLowerCase()) {
      return false;
    }
    if (prev.endChapter === next.startChapter) {
      return prev.endVerse + 1 === next.startVerse;
    }
    if (next.startChapter === prev.endChapter + 1 && next.startVerse === 1) {
      const maxVerses = this.getChapterMaxVerses(prev.bookDisplay, prev.endChapter);
      return maxVerses ? prev.endVerse === maxVerses : true;
    }
    return false;
  }

  hasChunkPairGap(prev: OutlineChunkEntry, next: OutlineChunkEntry): boolean {
    if (prev.bookDisplay.toLowerCase() !== next.bookDisplay.toLowerCase()) {
      return false;
    }
    if (this.isChunkPairContiguous(prev, next)) {
      return false;
    }
    if (prev.endChapter === next.startChapter) {
      return next.startVerse > prev.endVerse + 1;
    }
    return next.startChapter > prev.endChapter;
  }

  formatChunkPairGapLabel(prev: OutlineChunkEntry, next: OutlineChunkEntry): string {
    if (prev.endChapter === next.startChapter) {
      const gapStart = prev.endVerse + 1;
      const gapEnd = next.startVerse - 1;
      return gapStart === gapEnd
        ? `⋮ Gap: v. ${gapStart} not in deck`
        : `⋮ Gap: v. ${gapStart}–${gapEnd} not in deck`;
    }
    const maxVerses = this.getChapterMaxVerses(prev.bookDisplay, prev.endChapter);
    if (
      next.startChapter === prev.endChapter + 1 &&
      maxVerses &&
      prev.endVerse < maxVerses &&
      next.startVerse === 1
    ) {
      const gapStart = prev.endVerse + 1;
      return gapStart === maxVerses
        ? `⋮ Gap: ${prev.endChapter}:${gapStart} not in deck`
        : `⋮ Gap: ${prev.endChapter}:${gapStart}–${maxVerses} not in deck`;
    }
    return `⋮ Gap between ${prev.endChapter}:${prev.endVerse} and ${next.startChapter}:${next.startVerse} not in deck`;
  }

  isOutlineGroupAllSelected(group: OutlinePassageGroup): boolean {
    return (
      group.chunks.length > 0 &&
      group.chunks.every((c) => this.isCardSelected(c.item.card.id))
    );
  }

  isOutlineGroupPartiallySelected(group: OutlinePassageGroup): boolean {
    return (
      !this.isOutlineGroupAllSelected(group) &&
      group.chunks.some((c) => this.isCardSelected(c.item.card.id))
    );
  }

  toggleSelectOutlineGroup(group: OutlinePassageGroup, event?: Event): void {
    event?.stopPropagation();
    this.confirmingDelete.set(false);
    const next = new Set(this.selectedCardIds());
    if (this.isOutlineGroupAllSelected(group)) {
      for (const chunk of group.chunks) {
        next.delete(chunk.item.card.id);
      }
    } else {
      for (const chunk of group.chunks) {
        next.add(chunk.item.card.id);
      }
    }
    this.selectedCardIds.set(next);
  }

  getOutlineGroupCombineStatus(group: OutlinePassageGroup): {
    canCombine: boolean;
    targetChunkIds: string[];
    reason?: string;
  } {
    const selectedInGroup = group.chunks.filter((c) =>
      this.isCardSelected(c.item.card.id)
    );
    const targetChunks =
      selectedInGroup.length >= 2 ? selectedInGroup : group.chunks;
    const check = this.evaluateChunksContiguity(targetChunks.map((c) => c.item));
    if (check.canCombine) {
      return {
        canCombine: true,
        targetChunkIds: targetChunks.map((c) => c.item.passage.id),
      };
    }
    return {
      canCombine: false,
      targetChunkIds: [],
      reason:
        check.reason ||
        'Select contiguous chunks in this group (with no verse gaps) to combine',
    };
  }

  private evaluateChunksContiguity(items: DeckItem[]): {
    canCombine: boolean;
    reason?: string;
  } {
    if (items.length < 2) {
      return {
        canCombine: false,
        reason: 'Select at least 2 contiguous passages to combine',
      };
    }

    if (
      items.some(
        (i) =>
          i.card.isRepairCard ||
          i.card.isStitchedPassageCard ||
          i.passage.id.startsWith('psg_stitched_') ||
          i.passage.id.startsWith('psg_seam_')
      )
    ) {
      return {
        canCombine: false,
        reason: 'Cannot combine repair or auto-stitched cards',
      };
    }

    const withCoords = items.map((item) => ({
      item,
      coords: this.parsePassageCoordinates(item.passage),
    }));

    const firstBookKey = withCoords[0].coords.bookDisplay.toLowerCase();
    for (const entry of withCoords) {
      if (entry.coords.bookDisplay.toLowerCase() !== firstBookKey) {
        return {
          canCombine: false,
          reason: `Cannot combine passages from different books (${withCoords[0].coords.bookDisplay} and ${entry.coords.bookDisplay})`,
        };
      }
    }

    withCoords.sort((a, b) => {
      if (a.coords.startChapter !== b.coords.startChapter) {
        return a.coords.startChapter - b.coords.startChapter;
      }
      if (a.coords.startVerse !== b.coords.startVerse) {
        return a.coords.startVerse - b.coords.startVerse;
      }
      return a.coords.endVerse - b.coords.endVerse;
    });

    for (let i = 0; i < withCoords.length - 1; i++) {
      const prev = withCoords[i].coords;
      const next = withCoords[i + 1].coords;

      if (prev.endChapter === next.startChapter) {
        if (next.startVerse <= prev.endVerse) {
          return {
            canCombine: false,
            reason: `Passages overlap at ${prev.bookDisplay} ${prev.endChapter}:${next.startVerse}`,
          };
        }
        if (next.startVerse !== prev.endVerse + 1) {
          return {
            canCombine: false,
            reason: `Non-contiguous: missing v. ${prev.endVerse + 1}–${next.startVerse - 1} in ${prev.bookDisplay} ${prev.endChapter}`,
          };
        }
      } else if (next.startChapter === prev.endChapter + 1) {
        const maxVerses = this.getChapterMaxVerses(prev.bookDisplay, prev.endChapter);
        if (
          next.startVerse !== 1 ||
          (maxVerses !== undefined && prev.endVerse !== maxVerses)
        ) {
          return {
            canCombine: false,
            reason: `Non-contiguous across chapter boundary (${prev.bookDisplay} ${prev.endChapter}:${prev.endVerse} → ${next.startChapter}:${next.startVerse})`,
          };
        }
      } else {
        return {
          canCombine: false,
          reason: `Non-contiguous chapters (${prev.bookDisplay} ${prev.endChapter} and ${next.startChapter})`,
        };
      }
    }

    const svc = this.storageService as BatchCapableStorageService;
    if (typeof svc.canCombinePassages === 'function') {
      const svcCheck = svc.canCombinePassages(items.map((i) => i.passage.id));
      if (typeof svcCheck === 'boolean' && !svcCheck) {
        return {
          canCombine: false,
          reason: 'Selected passages are not contiguous',
        };
      }
      if (
        svcCheck &&
        typeof svcCheck === 'object' &&
        'canCombine' in svcCheck &&
        !svcCheck.canCombine
      ) {
        return svcCheck;
      }
    }

    return { canCombine: true };
  }

  private getChapterMaxVerses(bookDisplay: string, chapter: number): number | undefined {
    const pbHelper = pb as unknown as {
      getChapterVerseCount?: (bookName: string, chap: number) => number | undefined;
    };
    if (typeof pbHelper.getChapterVerseCount === 'function') {
      const count = pbHelper.getChapterVerseCount(bookDisplay, chapter);
      if (typeof count === 'number' && count > 0) {
        return count;
      }
    }
    const key = `${bookDisplay.toLowerCase().replace(/\s+/g, ' ')}:${chapter}`;
    return FALLBACK_CHAPTER_VERSE_COUNTS[key];
  }

  onAddNextVersesClick(nextRef?: string, event?: Event): void {
    event?.stopPropagation();
    if (nextRef && typeof sessionStorage !== 'undefined') {
      try {
        sessionStorage.setItem('selah_prefill_reference_v1', nextRef);
      } catch {
        // Ignore storage errors
      }
    }
    this.onAddFabClick();
  }

  isCardSelected(cardId: string): boolean {
    return this.selectedCardIds().has(cardId);
  }

  toggleSelectCard(item: DeckItem, event?: Event): void {
    event?.stopPropagation();
    const next = new Set(this.selectedCardIds());
    if (next.has(item.card.id)) {
      next.delete(item.card.id);
    } else {
      next.add(item.card.id);
    }
    this.selectedCardIds.set(next);
    this.confirmingDelete.set(false);
  }

  selectAllInCurrentTab(): void {
    const next = new Set<string>();
    for (const item of this.currentTabItems()) {
      next.add(item.card.id);
    }
    this.selectedCardIds.set(next);
    this.confirmingDelete.set(false);
  }

  clearSelection(): void {
    this.selectedCardIds.set(new Set());
    this.confirmingDelete.set(false);
  }

  editSelectedCard(): void {
    const ids = Array.from(this.selectedCardIds());
    if (ids.length !== 1) {
      return;
    }
    const target = this.storageService.deckItems().find((i) => i.card.id === ids[0]);
    if (!target) {
      return;
    }
    this.clearSelection();
    this.editItem.emit(target);
    this.editPassage.emit(target.passage);
  }

  appendToSelectedPassage(): void {
    const ids = Array.from(this.selectedCardIds());
    if (ids.length !== 1) {
      return;
    }
    const target = this.storageService.deckItems().find((i) => i.card.id === ids[0]);
    if (!target) {
      return;
    }
    this.clearSelection();
    this.onAppendToPassageClick(target.passage);
  }

  onAppendToPassageClick(passage: Passage, event?: Event): void {
    event?.stopPropagation();
    if (typeof sessionStorage !== 'undefined') {
      try {
        sessionStorage.setItem('selah_append_passage_id_v1', passage.id);
      } catch {
        // Ignore storage errors
      }
    }
    this.appendPassage.emit(passage);
    if (!this.appendPassage.observed) {
      this.onAddFabClick();
    }
  }

  combineSelectedPassages(): void {
    const ids = Array.from(this.selectedCardIds());
    if (ids.length < 2 || !this.combineSelectionStatus().canCombine) {
      return;
    }
    this.combineByCardOrPassageIds(ids);
    this.clearSelection();
  }

  combineGroupChunks(group: OutlinePassageGroup, event?: Event): void {
    event?.stopPropagation();
    const status = this.getOutlineGroupCombineStatus(group);
    if (!status.canCombine || status.targetChunkIds.length < 2) {
      return;
    }
    this.combineByCardOrPassageIds(status.targetChunkIds);
    this.clearSelection();
  }

  private combineByCardOrPassageIds(ids: string[]): void {
    const svc = this.storageService as BatchCapableStorageService;
    if (typeof svc.combinePassages === 'function') {
      svc.combinePassages(ids);
      return;
    }

    // Fallback combine implementation when combinePassages is not yet defined on StorageService
    const idSet = new Set(ids);
    const matchedItems = this.basePassageItems().filter(
      (i) => idSet.has(i.card.id) || idSet.has(i.passage.id)
    );
    if (matchedItems.length < 2) {
      return;
    }

    const sorted = [...matchedItems].sort((a, b) => {
      const ca = this.parsePassageCoordinates(a.passage);
      const cb = this.parsePassageCoordinates(b.passage);
      if (ca.bookOrder !== cb.bookOrder) {
        return ca.bookOrder - cb.bookOrder;
      }
      if (ca.startChapter !== cb.startChapter) {
        return ca.startChapter - cb.startChapter;
      }
      return ca.startVerse - cb.startVerse;
    });

    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const firstCoords = this.parsePassageCoordinates(first.passage);
    const lastCoords = this.parsePassageCoordinates(last.passage);
    const combinedVerses = sorted.flatMap((i) => i.passage.verses);
    const combinedRef =
      firstCoords.startChapter === lastCoords.endChapter
        ? `${firstCoords.bookDisplay} ${firstCoords.startChapter}:${firstCoords.startVerse}-${lastCoords.endVerse}`
        : `${firstCoords.bookDisplay} ${firstCoords.startChapter}:${firstCoords.startVerse}-${lastCoords.endChapter}:${lastCoords.endVerse}`;
    const combinedLabels = sorted
      .map((i) => i.passage.label?.trim())
      .filter((l): l is string => Boolean(l));
    const mergedLabel = combinedLabels.length > 0 ? combinedLabels.join(' · ') : undefined;

    this.storageService.updatePassage(
      first.passage.id,
      combinedRef,
      combinedVerses,
      combinedVerses,
      mergedLabel
    );

    const otherPassageIds = sorted.slice(1).map((i) => i.passage.id);
    for (const pid of otherPassageIds) {
      this.storageService.deletePassage(pid);
    }
  }

  moveSelectedToDue(): void {
    const ids = Array.from(this.selectedCardIds());
    if (ids.length === 0) {
      return;
    }
    const svc = this.storageService as BatchCapableStorageService;
    if (typeof svc.moveCardsToReviewDeck === 'function') {
      svc.moveCardsToReviewDeck(ids);
    } else {
      for (const id of ids) {
        this.storageService.startMemorizingPassage(id);
      }
    }
    this.clearSelection();
  }

  moveSelectedToNew(): void {
    const ids = Array.from(this.selectedCardIds());
    if (ids.length === 0) {
      return;
    }
    const svc = this.storageService as BatchCapableStorageService;
    if (typeof svc.moveCardsToNew === 'function') {
      svc.moveCardsToNew(ids);
    } else {
      for (const id of ids) {
        const item = this.storageService.deckItems().find((i) => i.card.id === id);
        if (item?.card.isRepairCard || item?.card.isStitchedPassageCard) {
          this.storageService.deleteCard(id);
        } else {
          this.storageService.truncatePassageProgress(id, 0);
        }
      }
    }
    this.clearSelection();
  }

  onBatchDeleteClick(): void {
    const ids = Array.from(this.selectedCardIds());
    if (ids.length === 0) {
      return;
    }
    if (!this.confirmingDelete()) {
      this.confirmingDelete.set(true);
      return;
    }

    const selectedItems = this.storageService
      .deckItems()
      .filter((item) => this.selectedCardIds().has(item.card.id));

    const specialCardIds = selectedItems
      .filter((i) => i.card.isRepairCard || i.card.isStitchedPassageCard)
      .map((i) => i.card.id);
    const passageIds = selectedItems
      .filter((i) => !i.card.isRepairCard && !i.card.isStitchedPassageCard)
      .map((i) => i.passage.id);

    for (const cid of specialCardIds) {
      this.storageService.deleteCard(cid);
    }

    if (passageIds.length > 0) {
      const svc = this.storageService as BatchCapableStorageService;
      if (typeof svc.deletePassages === 'function') {
        svc.deletePassages(passageIds);
        for (const pid of passageIds) {
          if (this.storageService.passages().some((p) => p.id === pid)) {
            this.storageService.deletePassage(pid);
          }
        }
      } else {
        for (const pid of passageIds) {
          this.storageService.deletePassage(pid);
        }
      }
    }

    this.clearSelection();
  }

  onRowClick(item: DeckItem, event?: Event): void {
    if (this.selectedCardIds().size > 0) {
      this.toggleSelectCard(item, event);
      return;
    }
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

  private getActiveRecitedVerses(item: DeckItem): Verse[] {
    const allVerses = item.passage.verses ?? [];
    if (allVerses.length === 0) {
      return [];
    }
    const step =
      item.card.state === CardState.CARD_STATE_REVIEW
        ? allVerses.length
        : Math.max(1, Math.min(item.card.learningStep || 1, allVerses.length));
    return allVerses.slice(0, step);
  }

  getRecitationLabel(item: DeckItem): string {
    const verses = this.getActiveRecitedVerses(item);
    const pbWithHelper = pb as unknown as {
      estimateRecitationTime?: (v: Verse[]) => { label: string };
    };
    if (typeof pbWithHelper.estimateRecitationTime === 'function') {
      return pbWithHelper.estimateRecitationTime(verses).label;
    }
    return estimateRecitationTime(verses).label;
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
   * Only returns `item.passage.label` if the user explicitly added one.
   * Never falls back to the first few words of verse 1.
   */
  getOpeningSnippet(item: DeckItem): string {
    return item.passage.label?.trim() || '';
  }

  getRowCueText(item: DeckItem): string {
    return this.getOpeningSnippet(item);
  }

  getOpeningWords(item: DeckItem): string {
    return this.getOpeningSnippet(item);
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
      const verses = item.passage.verses || [];
      const step = Math.min(Math.max(1, item.card.learningStep || 1), Math.max(1, verses.length));
      if (verses.length > 0) {
        const range = formatVerseRange(verses[0], verses[step - 1], isMultiChapterPassage(verses));
        return range.startsWith('v.') ? range : `v. ${range}`;
      }
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

  private parsePassageCoordinates(passage: Passage): {
    bookDisplay: string;
    bookOrder: number;
    startChapter: number;
    startVerse: number;
    endChapter: number;
    endVerse: number;
  } {
    const ref = (passage.reference || 'Passage 1:1').trim();
    const match = ref.match(
      /^((?:[1-3]\s+)?[A-Za-z]+(?:\s+of\s+[A-Za-z]+|\s+[A-Za-z]+)?)\s+(\d+)(?::(\d+))?/i
    );
    const bookDisplay = match ? match[1].trim() : 'Passage';
    const bookKey = bookDisplay.toLowerCase().replace(/\s+/g, ' ');
    const bookOrder = BIBLE_BOOK_ORDER[bookKey] ?? 999;
    const refChapter = match ? parseInt(match[2], 10) || 1 : 1;
    const refVerse = match && match[3] ? parseInt(match[3], 10) || 1 : 1;

    const verses = passage.verses ?? [];
    const first = verses[0];
    const last = verses[verses.length - 1];

    const startChapter =
      first?.chapterNumber && first.chapterNumber > 0 ? first.chapterNumber : refChapter;
    const startVerse = first?.verseNumber && first.verseNumber > 0 ? first.verseNumber : refVerse;
    const endChapter =
      last?.chapterNumber && last.chapterNumber > 0 ? last.chapterNumber : startChapter;
    const endVerse =
      last?.verseNumber && last.verseNumber > 0 ? last.verseNumber : startVerse;

    return {
      bookDisplay,
      bookOrder,
      startChapter,
      startVerse,
      endChapter,
      endVerse,
    };
  }
}
