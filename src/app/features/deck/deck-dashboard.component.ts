import { Component, EventEmitter, Input, Output, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CardState, ReviewRating, Verse } from '../../core/proto/bible_memory.pb';
import { SrsService } from '../../core/services/srs.service';
import { DeckItem, StorageService } from '../../core/services/storage.service';

export type DashboardTab = 'queue' | 'due' | 'active';

@Component({
  selector: 'app-deck-dashboard',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="dashboard-container" data-testid="deck-dashboard">
      <!-- Active Memory Data File Auto-Save Bar -->
      <section class="data-file-bar" data-testid="active-data-file-bar" aria-label="Active memory data file status">
        @if (!storageService.activeFileName()) {
          <div class="data-file-empty-row" data-testid="active-data-file-empty">
            <div class="data-file-info">
              <span class="file-status-dot disconnected" aria-hidden="true"></span>
              <div class="file-copy">
                <strong class="file-headline">💾 No Active Memory Data File selected</strong>
                <span class="file-subtext">
                  Select or create a <code>.proto.json</code> file on your computer so every change
                  auto-saves to disk in the background.
                </span>
              </div>
            </div>

            <div class="data-file-actions">
              <button
                type="button"
                class="file-btn open-file-btn"
                (click)="onOpenDataFile()"
                data-testid="btn-open-data-file"
              >
                📂 Open Memory File...
              </button>
              <button
                type="button"
                class="file-btn create-file-btn"
                (click)="onCreateDataFile()"
                data-testid="btn-create-data-file"
              >
                ✨ Create New Memory File...
              </button>
            </div>
          </div>
        } @else {
          <div class="data-file-connected-row" data-testid="active-data-file-connected">
            <div class="data-file-info">
              <span
                class="file-status-dot"
                [class.connected]="storageService.activeFileStatus() !== 'needs-permission' && storageService.activeFileStatus() !== 'error'"
                [class.warning]="storageService.activeFileStatus() === 'needs-permission'"
                [class.error]="storageService.activeFileStatus() === 'error'"
                aria-hidden="true"
              ></span>
              <div class="file-copy">
                <strong class="file-headline" data-testid="active-data-file-name">
                  🟢 Active Memory Data File: <code>{{ storageService.activeFileName() }}</code>
                </strong>
                <span class="file-subtext" data-testid="active-data-file-status-pill">
                  @if (storageService.activeFileStatus() === 'saving') {
                    Auto-saving changes to disk...
                  } @else if (storageService.activeFileStatus() === 'needs-permission') {
                    Permission needed to resume background auto-save to this file.
                  } @else if (storageService.activeFileStatus() === 'error') {
                    {{ storageService.fileSyncError() || 'Auto-save error' }}
                  } @else {
                    ✓ Auto-saving in background
                    @if (storageService.lastFileSavedAt()) {
                      • Last saved {{ formatSavedTime(storageService.lastFileSavedAt()) }}
                    }
                  }
                </span>
              </div>
            </div>

            <div class="data-file-actions">
              @if (storageService.activeFileStatus() === 'needs-permission') {
                <button
                  type="button"
                  class="file-btn create-file-btn"
                  (click)="onReconnectDataFile()"
                  data-testid="btn-reconnect-data-file"
                >
                  🔓 Reconnect Permission
                </button>
              }
              <button
                type="button"
                class="file-btn open-file-btn"
                (click)="onOpenDataFile()"
                data-testid="btn-change-data-file"
              >
                Change File
              </button>
              <button
                type="button"
                class="file-btn disconnect-file-btn"
                (click)="onDisconnectDataFile()"
                data-testid="btn-disconnect-data-file"
              >
                Disconnect
              </button>
            </div>
          </div>
        }
      </section>

      <!-- Top Navigation Tabs (Home: Memorizing & Backlog | Due | Memorized / Known) -->
      <nav class="dashboard-tabs-bar" aria-label="Memory deck views" data-testid="dashboard-tabs">
        <button
          type="button"
          class="tab-pill"
          [class.active]="activeTab === 'queue'"
          (click)="selectTab('queue')"
          data-testid="tab-queue"
        >
          <span class="tab-title">Memorizing &amp; Backlog (Home)</span>
          <span class="tab-badge queue-badge">
            {{ currentlyMemorizingItems().length }} / {{ storageService.queuedDeckItems().length }}
          </span>
        </button>

        <button
          type="button"
          class="tab-pill"
          [class.active]="activeTab === 'due'"
          (click)="selectTab('due')"
          data-testid="tab-due"
        >
          <span class="tab-title">Due</span>
          <span class="tab-badge due-badge">{{ storageService.stats().due }}</span>
        </button>

        <button
          type="button"
          class="tab-pill"
          [class.active]="activeTab === 'active'"
          (click)="selectTab('active')"
          data-testid="tab-active"
        >
          <span class="tab-title">Memorized / Known</span>
          <span class="tab-badge active-badge">{{ storageService.stats().reviewCount }}</span>
        </button>
      </nav>

      <!-- Summary KPI Grid -->
      <section class="stats-grid" data-testid="deck-stats-grid" aria-label="Deck statistics">
        <div
          class="kpi-card learning-kpi clickable-kpi"
          [class.selected-kpi]="activeTab === 'queue'"
          (click)="selectTab('queue')"
          data-testid="kpi-learning"
        >
          <span class="kpi-label">Currently Memorizing</span>
          <strong class="kpi-value">{{ storageService.stats().learningCount }}</strong>
          <span class="kpi-sub">In-progress &amp; repair</span>
        </div>

        <div
          class="kpi-card queue-kpi clickable-kpi"
          [class.selected-kpi]="activeTab === 'queue'"
          (click)="selectTab('queue')"
          data-testid="kpi-new"
        >
          <span class="kpi-label">Saved to Memorize Next</span>
          <strong class="kpi-value">{{ storageService.stats().queuedCount }}</strong>
          <span class="kpi-sub">Pick any passage</span>
        </div>

        <div
          class="kpi-card due-kpi clickable-kpi"
          [class.selected-kpi]="activeTab === 'due'"
          (click)="selectTab('due')"
          data-testid="kpi-due-today"
        >
          <span class="kpi-label">Due Today</span>
          <strong class="kpi-value">{{ storageService.stats().due }}</strong>
          <span class="kpi-sub">Ready for review</span>
        </div>

        <div
          class="kpi-card review-kpi clickable-kpi"
          [class.selected-kpi]="activeTab === 'active'"
          (click)="selectTab('active')"
          data-testid="kpi-review"
        >
          <span class="kpi-label">Memorized / Known</span>
          <strong class="kpi-value">{{ storageService.stats().reviewCount }}</strong>
          <span class="kpi-sub">Long-term Anki review</span>
        </div>

        <div class="kpi-card total-kpi" data-testid="kpi-total">
          <span class="kpi-label">Total Cards</span>
          <strong class="kpi-value">{{ storageService.stats().total }}</strong>
          <span class="kpi-sub">In ProtoJSON store</span>
        </div>
      </section>

      <!-- ======================================================================= -->
      <!-- TAB 1: HOME PAGE ("Currently Memorizing" + "Saved to Memorize Next")    -->
      <!-- ======================================================================= -->
      @if (activeTab === 'queue') {
        <section class="tab-view-section" data-testid="queue-page-section">
          <div class="hero-card queue-hero">
            <div class="hero-copy">
              <span class="hero-eyebrow">Home • User-Controlled Memorization Workspace</span>
              <h2 class="hero-title">Choose What You're Memorizing</h2>
              <p class="hero-description">
                Move any passage between <strong>Saved to Memorize Next</strong> and
                <strong>Currently Memorizing</strong> in any order. Click any passage card to open
                its <strong>Flashcard</strong> (with accumulative verse stitching, single-verse
                <strong>Memory Repair</strong>, &amp; a dedicated <strong>First-Letter Study Page</strong>).
              </p>
            </div>

            <div class="primary-action-bar">
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
                class="action-btn study-due-btn"
                (click)="selectTab('due')"
                data-testid="btn-go-to-due-page"
              >
                Due Page ({{ storageService.stats().due }})
              </button>

              <button
                type="button"
                class="action-btn proto-sync-btn"
                (click)="openProtoSync.emit()"
                data-testid="btn-open-proto-sync"
              >
                ⇄ ProtoJSON
              </button>
            </div>
          </div>

          <!-- SECTION A: CURRENTLY MEMORIZING (LEARNING / RELEARNING + REPAIR CARDS) -->
          <div class="home-subsection" data-testid="currently-memorizing-section">
            <div class="section-header">
              <div>
                <h3 class="section-title">
                  🔥 Currently Memorizing ({{ currentlyMemorizingItems().length }})
                </h3>
                <p class="section-subtitle">
                  Passages and temporary verse-repair cards you are actively working on right now.
                  Click any card to open its Flashcard.
                </p>
              </div>
            </div>

            <div class="passage-deck-list" data-testid="currently-memorizing-list">
              @for (item of currentlyMemorizingItems(); track item.card.id; let i = $index) {
                <article
                  class="deck-item-card clickable-card memorizing-card"
                  [class.repair-card]="item.card.isRepairCard"
                  (click)="onOpenFlashcard(item)"
                  role="button"
                  tabindex="0"
                  (keydown.enter)="onOpenFlashcard(item)"
                  [attr.data-testid]="'memorizing-item-' + i"
                >
                  <div class="deck-item-main">
                    <div class="deck-item-header">
                      <h4 class="passage-ref" [attr.data-testid]="'memorizing-item-ref-' + i">
                        {{ item.passage.reference }}
                      </h4>

                      @if (item.card.isRepairCard) {
                        <span class="repair-card-badge" data-testid="repair-card-badge">
                          🔧 Memory Repair · v. {{ item.card.repairVerseNumber }}
                        </span>
                        <span class="repair-heal-pill" data-testid="repair-heal-pill">
                          Heal Streak: {{ item.card.repairStreak || 0 }} /
                          {{ item.card.repairTargetStreak || 3 }}
                        </span>
                      } @else {
                        <span class="verse-count-pill">
                          {{ item.passage.verses.length }}
                          {{ item.passage.verses.length === 1 ? 'verse' : 'verses' }}
                        </span>

                        <span class="state-badge badge-learning">
                          MEMORIZING
                        </span>

                        <span class="stitch-progress-pill" [attr.data-testid]="'memorizing-stitch-pill-' + i">
                          🧵 Stitched: {{ getStitchedProgressLabel(item) }}
                        </span>
                      }
                    </div>

                    @if (getSnippetVerse(item); as snippetVerse) {
                      <p class="first-verse-snippet">
                        <span class="verse-num">[{{ snippetVerse.verseNumber }}]</span>
                        {{ snippetVerse.text }}
                        @if (!item.card.isRepairCard && item.passage.verses.length > 1) {
                          <span class="more-verses-hint">
                            (+{{ item.passage.verses.length - 1 }} more
                            {{ item.passage.verses.length - 1 === 1 ? 'verse' : 'verses' }})
                          </span>
                        }
                      </p>
                    }
                  </div>

                  <div class="deck-item-actions" (click)="$event.stopPropagation()">
                    <button
                      type="button"
                      class="study-card-btn"
                      (click)="onOpenFlashcard(item)"
                      [attr.data-testid]="'btn-open-memorizing-card-' + i"
                    >
                      {{ item.card.isRepairCard ? 'Practice Repair Card →' : 'Open Flashcard →' }}
                    </button>
                    @if (!item.card.isRepairCard) {
                      <button
                        type="button"
                        class="phase-action-btn mark-memorized-btn"
                        (click)="markAsMemorized(item, $event)"
                        title="Graduate to Memorized / Known"
                        [attr.data-testid]="'btn-mark-memorized-' + i"
                      >
                        ✓ Mark Memorized
                      </button>
                      <button
                        type="button"
                        class="phase-action-btn move-saved-btn"
                        (click)="moveBackToSaved(item, $event)"
                        title="Move back to Saved to Memorize Next"
                        [attr.data-testid]="'btn-move-to-saved-' + i"
                      >
                        ↩ Move back to Saved
                      </button>
                    } @else {
                      <button
                        type="button"
                        class="delete-card-btn"
                        (click)="deleteItem(item, $event)"
                        title="Dismiss repair card"
                        [attr.data-testid]="'btn-dismiss-repair-' + i"
                      >
                        ✕
                      </button>
                    }
                  </div>
                </article>
              } @empty {
                <div class="empty-deck-box compact-empty" data-testid="empty-memorizing-state">
                  <p>
                    No passages in <strong>Currently Memorizing</strong> right now. Pick any passage
                    from <strong>Saved to Memorize Next</strong> below and click
                    <strong>+ Add to Currently Memorizing</strong>!
                  </p>
                </div>
              }
            </div>
          </div>

          <!-- SECTION B: SAVED TO MEMORIZE NEXT (NEW / BACKLOG — PICK IN ANY ORDER) -->
          <div class="home-subsection" data-testid="saved-backlog-section">
            <div class="section-header">
              <div>
                <h3 class="section-title">
                  📌 Saved to Memorize Next ({{ storageService.queuedDeckItems().length }})
                </h3>
                <p class="section-subtitle">
                  Your saved passages waiting to be learned. Choose <strong>any</strong> passage in
                  any order to add to <strong>Currently Memorizing</strong> or open its Flashcard.
                </p>
              </div>
            </div>

            <div class="passage-deck-list" data-testid="passage-deck-list">
              @for (item of storageService.queuedDeckItems(); track item.card.id; let i = $index) {
                <article
                  class="deck-item-card clickable-card queue-card"
                  (click)="onOpenFlashcard(item)"
                  role="button"
                  tabindex="0"
                  (keydown.enter)="onOpenFlashcard(item)"
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
                        class="state-badge badge-queued"
                        [attr.data-testid]="'deck-item-badge-' + i"
                      >
                        SAVED
                      </span>
                    </div>

                    @if (getSnippetVerse(item); as snippetVerse) {
                      <p class="first-verse-snippet">
                        <span class="verse-num">[{{ snippetVerse.verseNumber }}]</span>
                        {{ snippetVerse.text }}
                        @if (item.passage.verses.length > 1) {
                          <span class="more-verses-hint">
                            (+{{ item.passage.verses.length - 1 }} more
                            {{ item.passage.verses.length - 1 === 1 ? 'verse' : 'verses' }})
                          </span>
                        }
                      </p>
                    }
                  </div>

                  <div class="deck-item-actions" (click)="$event.stopPropagation()">
                    <button
                      type="button"
                      class="start-memorize-btn"
                      (click)="addToCurrentlyMemorizing(item, $event)"
                      [attr.data-testid]="'btn-add-to-memorizing-' + i"
                    >
                      + Add to Currently Memorizing
                    </button>
                    <button
                      type="button"
                      class="study-card-btn"
                      (click)="onOpenFlashcard(item)"
                      [attr.data-testid]="'btn-start-memorizing-' + i"
                    >
                      Open Flashcard →
                    </button>
                    <button
                      type="button"
                      class="study-card-btn subtle-study-btn"
                      (click)="onOpenFlashcard(item)"
                      [attr.data-testid]="'btn-study-card-' + i"
                    >
                      Study Card
                    </button>
                    <button
                      type="button"
                      class="delete-card-btn"
                      (click)="deleteItem(item, $event)"
                      aria-label="Delete passage"
                      title="Delete passage"
                      [attr.data-testid]="'btn-delete-card-' + i"
                    >
                      🗑
                    </button>
                  </div>
                </article>
              } @empty {
                <div class="empty-deck-box" data-testid="empty-queue-state">
                  <h4>No Saved Passages in Your Backlog</h4>
                  <p>
                    Add passages you'd like to memorize via Copy-Paste, or practice your
                    <strong>Currently Memorizing</strong> cards above.
                  </p>
                  <div class="empty-actions">
                    <button
                      type="button"
                      class="action-btn add-passage-btn"
                      (click)="openAddPassage.emit()"
                    >
                      + Add Passage (Copy-Paste)
                    </button>
                  </div>
                </div>
              }
            </div>
          </div>
        </section>
      }

      <!-- ======================================================================= -->
      <!-- TAB 2: DUE PAGE (Remember Me style Due View)                            -->
      <!-- ======================================================================= -->
      @if (activeTab === 'due') {
        <section class="tab-view-section" data-testid="due-page-section">
          <div class="hero-card due-hero">
            <div class="hero-copy">
              <span class="hero-eyebrow">Remember Me Style • Daily SRS Queue</span>
              <h2 class="hero-title">
                Due for Review ({{ storageService.dueDeckItems().length }})
              </h2>
              <p class="hero-description">
                Passages and temporary verse-repair cards whose Anki / SM-2 review interval is due
                right now. Tap any card below to open its Flashcard, or practice all due cards in
                sequence.
              </p>
            </div>

            <div class="primary-action-bar">
              <button
                type="button"
                class="action-btn study-due-btn"
                [disabled]="storageService.dueDeckItems().length === 0"
                (click)="startDueSession.emit()"
                data-testid="btn-study-due"
              >
                ▶ Practice All Due ({{ storageService.dueDeckItems().length }})
              </button>

              <button
                type="button"
                class="action-btn add-passage-btn"
                (click)="openAddPassage.emit()"
                data-testid="btn-open-add-passage"
              >
                + Add Passage
              </button>
            </div>
          </div>

          <div class="passage-deck-list" data-testid="passage-deck-list">
            @for (item of storageService.dueDeckItems(); track item.card.id; let i = $index) {
              <article
                class="deck-item-card is-due clickable-card"
                [class.repair-card]="item.card.isRepairCard"
                (click)="onOpenFlashcard(item)"
                role="button"
                tabindex="0"
                [attr.data-testid]="'deck-item-' + i"
              >
                <div class="deck-item-main">
                  <div class="deck-item-header">
                    <h4 class="passage-ref" [attr.data-testid]="'deck-item-ref-' + i">
                      {{ item.passage.reference }}
                    </h4>

                    @if (item.card.isRepairCard) {
                      <span class="repair-card-badge" data-testid="repair-card-badge">
                        🔧 Memory Repair · v. {{ item.card.repairVerseNumber }}
                      </span>
                      <span class="repair-heal-pill" data-testid="repair-heal-pill">
                        Heal Streak: {{ item.card.repairStreak || 0 }} /
                        {{ item.card.repairTargetStreak || 3 }}
                      </span>
                    } @else {
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
                    }

                    <span class="due-indicator">Due Now</span>
                  </div>

                  @if (getSnippetVerse(item); as snippetVerse) {
                    <p class="first-verse-snippet">
                      <span class="verse-num">[{{ snippetVerse.verseNumber }}]</span>
                      {{ snippetVerse.text }}
                      @if (!item.card.isRepairCard && item.passage.verses.length > 1) {
                        <span class="more-verses-hint">
                          (+{{ item.passage.verses.length - 1 }} more
                          {{ item.passage.verses.length - 1 === 1 ? 'verse' : 'verses' }})
                        </span>
                      }
                    </p>
                  }

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
                  </div>
                </div>

                <div class="deck-item-actions" (click)="$event.stopPropagation()">
                  <button
                    type="button"
                    class="study-card-btn"
                    (click)="onOpenFlashcard(item)"
                    [attr.data-testid]="'btn-study-card-' + i"
                  >
                    {{ item.card.isRepairCard ? 'Repair Verse →' : 'Open Flashcard →' }}
                  </button>
                </div>
              </article>
            } @empty {
              <div class="empty-deck-box" data-testid="empty-due-page-state">
                <h4>All Caught Up for Today! 🎉</h4>
                <p>
                  No passages are due right now. Visit the <strong>Home</strong> tab to work on your
                  <strong>Currently Memorizing</strong> passages!
                </p>
                <div class="empty-actions">
                  <button
                    type="button"
                    class="action-btn add-passage-btn"
                    (click)="selectTab('queue')"
                  >
                    Back to Home ({{ currentlyMemorizingItems().length }} Memorizing)
                  </button>
                </div>
              </div>
            }
          </div>
        </section>
      }

      <!-- ======================================================================= -->
      <!-- TAB 3: MEMORIZED / KNOWN (Graduated Review + Active Rotation)           -->
      <!-- ======================================================================= -->
      @if (activeTab === 'active') {
        <section class="tab-view-section" data-testid="active-page-section">
          <div class="hero-card active-hero">
            <div class="hero-copy">
              <span class="hero-eyebrow">Long-Term Retention • Anki Review Schedule</span>
              <h2 class="hero-title">
                Memorized &amp; Active Passages ({{ storageService.activeDeckItems().length }})
              </h2>
              <p class="hero-description">
                Passages in your long-term spaced repetition rotation (<strong>Memorized / Known</strong>
                in <code>REVIEW</code> state alongside <strong>Currently Memorizing</strong> cards).
              </p>
            </div>

            <div class="primary-action-bar">
              <button
                type="button"
                class="action-btn study-due-btn"
                (click)="startDueSession.emit()"
                data-testid="btn-study-due"
              >
                ▶ Study Due ({{ storageService.stats().due }})
              </button>
              <button
                type="button"
                class="action-btn add-passage-btn"
                (click)="selectTab('queue')"
              >
                Home / Backlog ({{ storageService.stats().queuedCount }})
              </button>
            </div>
          </div>

          <div class="passage-deck-list" data-testid="passage-deck-list">
            @for (item of storageService.activeDeckItems(); track item.card.id; let i = $index) {
              <article
                class="deck-item-card clickable-card"
                [class.is-due]="item.isDue"
                [class.repair-card]="item.card.isRepairCard"
                (click)="onOpenFlashcard(item)"
                role="button"
                tabindex="0"
                [attr.data-testid]="'deck-item-' + i"
              >
                <div class="deck-item-main">
                  <div class="deck-item-header">
                    <h4 class="passage-ref" [attr.data-testid]="'deck-item-ref-' + i">
                      {{ item.passage.reference }}
                    </h4>

                    @if (item.card.isRepairCard) {
                      <span class="repair-card-badge" data-testid="repair-card-badge">
                        🔧 Memory Repair · v. {{ item.card.repairVerseNumber }}
                      </span>
                      <span class="repair-heal-pill" data-testid="repair-heal-pill">
                        Heal Streak: {{ item.card.repairStreak || 0 }} /
                        {{ item.card.repairTargetStreak || 3 }}
                      </span>
                    } @else {
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
                    }

                    @if (item.isDue) {
                      <span class="due-indicator">Due Now</span>
                    } @else {
                      <span class="scheduled-indicator">Scheduled</span>
                    }
                  </div>

                  @if (getSnippetVerse(item); as snippetVerse) {
                    <p class="first-verse-snippet">
                      <span class="verse-num">[{{ snippetVerse.verseNumber }}]</span>
                      {{ snippetVerse.text }}
                      @if (!item.card.isRepairCard && item.passage.verses.length > 1) {
                        <span class="more-verses-hint">
                          (+{{ item.passage.verses.length - 1 }} more
                          {{ item.passage.verses.length - 1 === 1 ? 'verse' : 'verses' }})
                        </span>
                      }
                    </p>
                  }

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
                  </div>
                </div>

                <div class="deck-item-actions" (click)="$event.stopPropagation()">
                  <button
                    type="button"
                    class="study-card-btn"
                    (click)="onOpenFlashcard(item)"
                    [attr.data-testid]="'btn-study-card-' + i"
                  >
                    Open Flashcard →
                  </button>
                  @if (!item.card.isRepairCard) {
                    <button
                      type="button"
                      class="phase-action-btn move-saved-btn"
                      (click)="moveBackToSaved(item, $event)"
                      title="Move back to Saved to Memorize Next"
                    >
                      ↩ Move to Saved
                    </button>
                  }
                  <button
                    type="button"
                    class="delete-card-btn"
                    (click)="deleteItem(item, $event)"
                    aria-label="Delete card"
                    title="Delete card"
                    [attr.data-testid]="'btn-delete-card-' + i"
                  >
                    🗑
                  </button>
                </div>
              </article>
            } @empty {
              <div class="empty-deck-box">
                <h4>No Memorized or Active Passages Yet</h4>
                <p>Pick any passage on the Home tab to start memorizing it!</p>
                <button
                  type="button"
                  class="action-btn add-passage-btn"
                  (click)="selectTab('queue')"
                >
                  Go to Home Tab
                </button>
              </div>
            }
          </div>
        </section>
      }
    </div>
  `,
  styles: [
    `
      :host {
        --bg-surface: #1e293b;
        --bg-surface-elevated: #0f172a;
        --bg-subtle: #0f172a;
        --border-color: #334155;
        --border-hover: #475569;
        --text-primary: #f8fafc;
        --text-secondary: #cbd5e1;
        --text-muted: #94a3b8;
        --card-shadow: 0 4px 12px rgba(0, 0, 0, 0.22);
        --card-hover-shadow: 0 8px 22px rgba(0, 0, 0, 0.32);

        --hero-bg: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
        --due-hero-bg: linear-gradient(135deg, #134e4a 0%, #0f172a 100%);
        --active-hero-bg: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
        --hero-border: #334155;
        --hero-eyebrow: #5eead4;
        --hero-title: #ffffff;
        --hero-desc: #cbd5e1;
        --hero-code-bg: rgba(255, 255, 255, 0.14);
        --hero-code-text: #fde68a;
        --proto-btn-bg: rgba(255, 255, 255, 0.08);
        --proto-btn-text: #f8fafc;
        --proto-btn-border: rgba(255, 255, 255, 0.2);
        --proto-btn-hover: rgba(255, 255, 255, 0.16);

        --tab-hover-bg: rgba(255, 255, 255, 0.05);
        --tab-active-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
        --badge-queue-bg: rgba(59, 130, 246, 0.22);
        --badge-queue-text: #93c5fd;
        --badge-due-bg: rgba(20, 184, 166, 0.22);
        --badge-due-text: #5eead4;
        --badge-active-bg: rgba(34, 197, 94, 0.22);
        --badge-active-text: #86efac;
        --badge-learning-bg: rgba(245, 158, 11, 0.2);
        --badge-learning-text: #fcd34d;

        --kpi-queue-color: #60a5fa;
        --kpi-due-color: #2dd4bf;
        --kpi-learning-color: #fbbf24;
        --kpi-review-color: #4ade80;
        --verse-num-color: #2dd4bf;

        --repair-card-bg: linear-gradient(90deg, rgba(244, 63, 94, 0.08) 0%, #1e293b 35%);
        --repair-badge-bg: rgba(244, 63, 94, 0.22);
        --repair-badge-text: #fda4af;
        --repair-badge-border: rgba(244, 63, 94, 0.45);
        --heal-pill-bg: rgba(16, 185, 129, 0.18);
        --heal-pill-text: #6ee7b7;
        --heal-pill-border: rgba(16, 185, 129, 0.4);
        --stitch-pill-bg: rgba(245, 158, 11, 0.18);
        --stitch-pill-text: #fcd34d;
        --stitch-pill-border: rgba(245, 158, 11, 0.4);

        --start-btn-bg: rgba(245, 158, 11, 0.16);
        --start-btn-text: #fde68a;
        --start-btn-border: rgba(245, 158, 11, 0.5);
        --start-btn-hover: rgba(245, 158, 11, 0.28);
        --mark-mem-bg: rgba(34, 197, 94, 0.18);
        --mark-mem-text: #86efac;
        --mark-mem-border: rgba(34, 197, 94, 0.45);
        --mark-mem-hover: rgba(34, 197, 94, 0.28);

        --data-empty-bg: rgba(120, 53, 15, 0.28);
        --data-empty-border: rgba(245, 158, 11, 0.45);
        --data-conn-bg: rgba(6, 78, 59, 0.32);
        --data-conn-border: rgba(52, 211, 153, 0.45);
        --code-inline-bg: rgba(148, 163, 184, 0.18);
        --code-inline-text: #5eead4;
        display: block;
      }

      :host-context(.light-theme),
      :host-context(html:not(.dark-theme)) {
        --bg-surface: #ffffff;
        --bg-surface-elevated: #faf6ee;
        --bg-subtle: #f1ece1;
        --border-color: #e2dacb;
        --border-hover: #b8afa0;
        --text-primary: #1c1917;
        --text-secondary: #44403c;
        --text-muted: #78716c;
        --card-shadow: 0 2px 8px rgba(28, 25, 23, 0.05);
        --card-hover-shadow: 0 8px 20px rgba(28, 25, 23, 0.09);

        --hero-bg: linear-gradient(135deg, #f5efe4 0%, #ebe2d2 100%);
        --due-hero-bg: linear-gradient(135deg, #e6f7f4 0%, #d5f0ec 100%);
        --active-hero-bg: linear-gradient(135deg, #eef6ee 0%, #e1efe2 100%);
        --hero-border: #d8cebe;
        --hero-eyebrow: #0f766e;
        --hero-title: #1c1917;
        --hero-desc: #44403c;
        --hero-code-bg: rgba(15, 118, 110, 0.1);
        --hero-code-text: #0f766e;
        --proto-btn-bg: #ffffff;
        --proto-btn-text: #292524;
        --proto-btn-border: #cfc6b6;
        --proto-btn-hover: #f7f3eb;

        --tab-hover-bg: rgba(255, 255, 255, 0.65);
        --tab-active-shadow: 0 2px 8px rgba(28, 25, 23, 0.08);
        --badge-queue-bg: #dbeafe;
        --badge-queue-text: #1e40af;
        --badge-due-bg: #ccfbf1;
        --badge-due-text: #0f766e;
        --badge-active-bg: #dcfce7;
        --badge-active-text: #166534;
        --badge-learning-bg: #fef3c7;
        --badge-learning-text: #92400e;

        --kpi-queue-color: #1d4ed8;
        --kpi-due-color: #0f766e;
        --kpi-learning-color: #b45309;
        --kpi-review-color: #15803d;
        --verse-num-color: #0f766e;

        --repair-card-bg: linear-gradient(90deg, #fff1f2 0%, #ffffff 35%);
        --repair-badge-bg: #ffe4e6;
        --repair-badge-text: #be123c;
        --repair-badge-border: #fda4af;
        --heal-pill-bg: #d1fae5;
        --heal-pill-text: #065f46;
        --heal-pill-border: #6ee7b7;
        --stitch-pill-bg: #fffbeb;
        --stitch-pill-text: #92400e;
        --stitch-pill-border: #fde68a;

        --start-btn-bg: #fffbeb;
        --start-btn-text: #92400e;
        --start-btn-border: #d97706;
        --start-btn-hover: #fef3c7;
        --mark-mem-bg: #dcfce7;
        --mark-mem-text: #166534;
        --mark-mem-border: #86efac;
        --mark-mem-hover: #bbf7d0;

        --data-empty-bg: #fffbeb;
        --data-empty-border: #f59e0b;
        --data-conn-bg: #f0fdf4;
        --data-conn-border: #86efac;
        --code-inline-bg: rgba(15, 118, 110, 0.09);
        --code-inline-text: #0f766e;
      }

      .dashboard-container {
        display: flex;
        flex-direction: column;
        gap: 1.25rem;
      }

      .data-file-bar {
        border-radius: 0.85rem;
        overflow: hidden;
      }

      .data-file-empty-row {
        background: var(--data-empty-bg);
        border: 1px solid var(--data-empty-border);
        border-radius: 0.85rem;
        padding: 0.8rem 1.15rem;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
        flex-wrap: wrap;
      }

      .data-file-connected-row {
        background: var(--data-conn-bg);
        border: 1px solid var(--data-conn-border);
        border-radius: 0.85rem;
        padding: 0.75rem 1.15rem;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
        flex-wrap: wrap;
      }

      .data-file-info {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        min-width: 0;
        flex: 1;
      }

      .file-status-dot {
        width: 0.65rem;
        height: 0.65rem;
        border-radius: 999px;
        flex-shrink: 0;
      }

      .file-status-dot.disconnected,
      .file-status-dot.warning {
        background: #f59e0b;
        box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.25);
      }

      .file-status-dot.connected {
        background: #10b981;
        box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.25);
      }

      .file-status-dot.error {
        background: #ef4444;
        box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.25);
      }

      .file-copy {
        display: flex;
        flex-direction: column;
        gap: 0.12rem;
        min-width: 0;
      }

      .file-headline {
        font-size: 0.85rem;
        color: var(--text-primary);
      }

      .file-headline code {
        background: var(--code-inline-bg);
        padding: 0.08rem 0.38rem;
        border-radius: 0.3rem;
        font-size: 0.82rem;
        color: var(--code-inline-text);
      }

      .file-subtext {
        font-size: 0.77rem;
        color: var(--text-secondary);
      }

      .data-file-actions {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        flex-wrap: wrap;
      }

      .file-btn {
        padding: 0.45rem 0.85rem;
        border-radius: 0.55rem;
        font-size: 0.79rem;
        font-weight: 700;
        cursor: pointer;
        transition: all 0.15s ease;
        white-space: nowrap;
      }

      .open-file-btn {
        background: var(--bg-surface);
        border: 1px solid var(--border-color);
        color: var(--text-primary);
      }

      .open-file-btn:hover {
        border-color: var(--border-hover);
      }

      .create-file-btn {
        background: #0d9488;
        border: 1px solid #0d9488;
        color: #ffffff;
      }

      .create-file-btn:hover {
        background: #0f766e;
      }

      .disconnect-file-btn {
        background: transparent;
        border: 1px solid var(--border-color);
        color: var(--text-muted);
      }

      .disconnect-file-btn:hover {
        background: rgba(239, 68, 68, 0.12);
        border-color: #f87171;
        color: #dc2626;
      }

      .dashboard-tabs-bar {
        display: flex;
        align-items: center;
        gap: 0.65rem;
        background: var(--bg-subtle);
        padding: 0.4rem;
        border-radius: 0.85rem;
        border: 1px solid var(--border-color);
        flex-wrap: wrap;
      }

      .tab-pill {
        flex: 1 1 180px;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.55rem;
        padding: 0.68rem 1rem;
        border-radius: 0.65rem;
        border: none;
        background: transparent;
        color: var(--text-muted);
        font-size: 0.9rem;
        font-weight: 700;
        cursor: pointer;
        transition: all 0.15s ease;
      }

      .tab-pill:hover {
        color: var(--text-primary);
        background: var(--tab-hover-bg);
      }

      .tab-pill.active {
        background: var(--bg-surface);
        color: var(--text-primary);
        box-shadow: var(--tab-active-shadow);
      }

      .tab-badge {
        font-size: 0.75rem;
        font-weight: 800;
        padding: 0.14rem 0.52rem;
        border-radius: 999px;
      }

      .queue-badge {
        background: var(--badge-queue-bg);
        color: var(--badge-queue-text);
      }

      .due-badge {
        background: var(--badge-due-bg);
        color: var(--badge-due-text);
      }

      .active-badge {
        background: var(--badge-active-bg);
        color: var(--badge-active-text);
      }

      .tab-view-section {
        display: flex;
        flex-direction: column;
        gap: 1.35rem;
      }

      .home-subsection {
        display: flex;
        flex-direction: column;
        gap: 0.85rem;
      }

      .hero-card {
        background: var(--hero-bg);
        border: 1px solid var(--hero-border);
        color: var(--hero-title);
        border-radius: 1.1rem;
        padding: 1.55rem 1.8rem;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1.4rem;
        flex-wrap: wrap;
        box-shadow: var(--card-shadow);
      }

      .due-hero {
        background: var(--due-hero-bg);
      }

      .active-hero {
        background: var(--active-hero-bg);
      }

      .hero-copy {
        max-width: 560px;
      }

      .hero-eyebrow {
        display: inline-block;
        font-size: 0.72rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--hero-eyebrow);
        margin-bottom: 0.35rem;
      }

      .hero-title {
        margin: 0;
        font-size: 1.48rem;
        font-weight: 800;
        letter-spacing: -0.02em;
        color: var(--hero-title);
      }

      .hero-description {
        margin: 0.45rem 0 0;
        font-size: 0.87rem;
        line-height: 1.5;
        color: var(--hero-desc);
      }

      .hero-description code {
        background: var(--hero-code-bg);
        padding: 0.1rem 0.35rem;
        border-radius: 0.3rem;
        color: var(--hero-code-text);
        font-weight: 600;
      }

      .primary-action-bar {
        display: flex;
        align-items: center;
        gap: 0.65rem;
        flex-wrap: wrap;
      }

      .action-btn {
        padding: 0.68rem 1.05rem;
        border-radius: 0.65rem;
        font-size: 0.85rem;
        font-weight: 700;
        cursor: pointer;
        border: 1px solid transparent;
        transition: all 0.15s ease;
        white-space: nowrap;
      }

      .action-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .study-due-btn {
        background: #0d9488;
        color: #ffffff;
        box-shadow: 0 4px 12px rgba(13, 148, 136, 0.22);
      }

      .study-due-btn:hover:not(:disabled) {
        background: #0f766e;
      }

      .add-passage-btn {
        background: #f59e0b;
        color: #1c1917;
      }

      .add-passage-btn:hover {
        background: #fbbf24;
      }

      .proto-sync-btn {
        background: var(--proto-btn-bg);
        color: var(--proto-btn-text);
        border-color: var(--proto-btn-border);
      }

      .proto-sync-btn:hover {
        background: var(--proto-btn-hover);
      }

      .stats-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(165px, 1fr));
        gap: 0.8rem;
      }

      .kpi-card {
        background: var(--bg-surface);
        border: 1px solid var(--border-color);
        border-radius: 0.85rem;
        padding: 0.95rem 1.1rem;
        display: flex;
        flex-direction: column;
        gap: 0.18rem;
        box-shadow: var(--card-shadow);
      }

      .clickable-kpi {
        cursor: pointer;
        transition: border-color 0.15s ease, transform 0.12s ease;
      }

      .clickable-kpi:hover {
        border-color: var(--border-hover);
        transform: translateY(-1px);
      }

      .selected-kpi {
        border-color: #0d9488;
        box-shadow: 0 0 0 2px rgba(13, 148, 136, 0.18);
      }

      .kpi-label {
        font-size: 0.74rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--text-muted);
      }

      .kpi-value {
        font-size: 1.7rem;
        font-weight: 800;
        line-height: 1.15;
        color: var(--text-primary);
      }

      .queue-kpi .kpi-value {
        color: var(--kpi-queue-color);
      }

      .due-kpi .kpi-value {
        color: var(--kpi-due-color);
      }

      .learning-kpi .kpi-value {
        color: var(--kpi-learning-color);
      }

      .review-kpi .kpi-value {
        color: var(--kpi-review-color);
      }

      .kpi-sub {
        font-size: 0.74rem;
        color: var(--text-muted);
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
        font-size: 1.12rem;
        font-weight: 700;
        color: var(--text-primary);
      }

      .section-subtitle {
        margin: 0.2rem 0 0;
        font-size: 0.82rem;
        color: var(--text-secondary);
      }

      .passage-deck-list {
        display: flex;
        flex-direction: column;
        gap: 0.8rem;
      }

      .deck-item-card {
        background: var(--bg-surface);
        border: 1px solid var(--border-color);
        border-radius: 0.9rem;
        padding: 1.15rem 1.3rem;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1.25rem;
        box-shadow: var(--card-shadow);
        transition: border-color 0.15s ease, box-shadow 0.15s ease, transform 0.12s ease;
      }

      .clickable-card {
        cursor: pointer;
      }

      .clickable-card:hover {
        border-color: #0d9488;
        box-shadow: var(--card-hover-shadow);
      }

      .memorizing-card {
        border-left: 4px solid #f59e0b;
      }

      .repair-card {
        border-left: 4px solid #f43f5e !important;
        background: var(--repair-card-bg);
      }

      .queue-card {
        border-left: 4px solid #3b82f6;
      }

      .deck-item-card.is-due {
        border-left: 4px solid #0d9488;
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
        color: var(--text-primary);
      }

      .verse-count-pill {
        font-size: 0.74rem;
        font-weight: 600;
        padding: 0.15rem 0.55rem;
        border-radius: 999px;
        background: var(--bg-subtle);
        color: var(--text-secondary);
        border: 1px solid var(--border-color);
      }

      .stitch-progress-pill {
        font-size: 0.73rem;
        font-weight: 700;
        padding: 0.15rem 0.58rem;
        border-radius: 999px;
        background: var(--stitch-pill-bg);
        color: var(--stitch-pill-text);
        border: 1px solid var(--stitch-pill-border);
      }

      .repair-card-badge {
        font-size: 0.72rem;
        font-weight: 800;
        padding: 0.18rem 0.6rem;
        border-radius: 999px;
        background: var(--repair-badge-bg);
        color: var(--repair-badge-text);
        border: 1px solid var(--repair-badge-border);
      }

      .repair-heal-pill {
        font-size: 0.72rem;
        font-weight: 700;
        padding: 0.16rem 0.55rem;
        border-radius: 999px;
        background: var(--heal-pill-bg);
        color: var(--heal-pill-text);
        border: 1px solid var(--heal-pill-border);
      }

      .state-badge {
        font-size: 0.7rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        padding: 0.16rem 0.55rem;
        border-radius: 0.35rem;
      }

      .badge-queued,
      .badge-new {
        background: var(--badge-queue-bg);
        color: var(--badge-queue-text);
      }

      .badge-learning {
        background: var(--badge-learning-bg);
        color: var(--badge-learning-text);
      }

      .badge-review {
        background: var(--badge-active-bg);
        color: var(--badge-active-text);
      }

      .due-indicator {
        font-size: 0.72rem;
        font-weight: 700;
        color: var(--badge-due-text);
        background: var(--badge-due-bg);
        padding: 0.14rem 0.5rem;
        border-radius: 999px;
      }

      .scheduled-indicator {
        font-size: 0.72rem;
        font-weight: 600;
        color: var(--text-muted);
        background: var(--bg-subtle);
        padding: 0.14rem 0.5rem;
        border-radius: 999px;
      }

      .first-verse-snippet {
        margin: 0;
        font-size: 0.9rem;
        color: var(--text-secondary);
        line-height: 1.48;
      }

      .verse-num {
        font-weight: 700;
        color: var(--verse-num-color);
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        font-size: 0.8rem;
        margin-right: 0.25rem;
      }

      .more-verses-hint {
        font-size: 0.8rem;
        color: var(--text-muted);
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
        color: var(--text-muted);
      }

      .meta-chip strong {
        color: var(--text-primary);
      }

      .deck-item-actions {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        flex-shrink: 0;
        flex-wrap: wrap;
      }

      .start-memorize-btn {
        padding: 0.56rem 0.95rem;
        border-radius: 0.6rem;
        border: 1px solid var(--start-btn-border);
        background: var(--start-btn-bg);
        color: var(--start-btn-text);
        font-size: 0.81rem;
        font-weight: 700;
        cursor: pointer;
        transition: all 0.15s ease;
        white-space: nowrap;
      }

      .start-memorize-btn:hover {
        background: var(--start-btn-hover);
      }

      .study-card-btn {
        padding: 0.58rem 1rem;
        border-radius: 0.6rem;
        border: 1px solid #0d9488;
        background: #0d9488;
        color: #ffffff;
        font-size: 0.83rem;
        font-weight: 600;
        cursor: pointer;
        transition: background 0.15s ease;
        white-space: nowrap;
      }

      .study-card-btn:hover {
        background: #0f766e;
      }

      .subtle-study-btn {
        background: var(--bg-subtle);
        color: var(--text-primary);
        border-color: var(--border-color);
      }

      .subtle-study-btn:hover {
        border-color: var(--border-hover);
      }

      .phase-action-btn {
        padding: 0.54rem 0.82rem;
        border-radius: 0.55rem;
        font-size: 0.79rem;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.15s ease;
        white-space: nowrap;
      }

      .mark-memorized-btn {
        background: var(--mark-mem-bg);
        border: 1px solid var(--mark-mem-border);
        color: var(--mark-mem-text);
      }

      .mark-memorized-btn:hover {
        background: var(--mark-mem-hover);
      }

      .move-saved-btn {
        background: var(--bg-subtle);
        border: 1px solid var(--border-color);
        color: var(--text-secondary);
      }

      .move-saved-btn:hover {
        border-color: var(--border-hover);
        color: var(--text-primary);
      }

      .delete-card-btn {
        padding: 0.55rem 0.7rem;
        border-radius: 0.55rem;
        border: 1px solid var(--border-color);
        background: var(--bg-subtle);
        color: var(--text-muted);
        font-size: 0.85rem;
        cursor: pointer;
        transition: all 0.15s ease;
      }

      .delete-card-btn:hover {
        background: rgba(239, 68, 68, 0.14);
        border-color: #f87171;
        color: #dc2626;
      }

      .empty-deck-box {
        text-align: center;
        background: var(--bg-surface);
        border: 1px dashed var(--border-color);
        border-radius: 0.9rem;
        padding: 2.2rem 1.5rem;
        color: var(--text-secondary);
      }

      .compact-empty {
        padding: 1.25rem 1.25rem;
      }

      .empty-deck-box h4 {
        margin: 0 0 0.4rem;
        font-size: 1.08rem;
        color: var(--text-primary);
      }

      .empty-deck-box p {
        margin: 0;
        font-size: 0.86rem;
      }

      .empty-actions {
        margin-top: 1rem;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.65rem;
        flex-wrap: wrap;
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

  @Input() activeTab: DashboardTab = 'queue';
  @Output() activeTabChange = new EventEmitter<DashboardTab>();

  @Output() startDueSession = new EventEmitter<void>();
  @Output() practiceSingleItem = new EventEmitter<DeckItem>();
  @Output() startMemorizeFlow = new EventEmitter<DeckItem>();
  @Output() openAddPassage = new EventEmitter<void>();
  @Output() openProtoSync = new EventEmitter<void>();

  /**
   * Passages and temporary repair cards the user is actively working on right now
   * (between "Saved / Not Known Yet" and "Fully Memorized / Review").
   */
  readonly currentlyMemorizingItems = computed<DeckItem[]>(() => {
    return this.storageService
      .deckItems()
      .filter(
        (item) =>
          item.card.state === CardState.CARD_STATE_LEARNING ||
          item.card.state === CardState.CARD_STATE_RELEARNING
      );
  });

  selectTab(tab: DashboardTab): void {
    this.activeTab = tab;
    this.activeTabChange.emit(tab);
  }

  onOpenFlashcard(item: DeckItem): void {
    this.startMemorizeFlow.emit(item);
  }

  getSnippetVerse(item: DeckItem): Verse | null {
    if (!item.passage.verses || item.passage.verses.length === 0) {
      return null;
    }
    if (item.card.isRepairCard && item.card.repairVerseNumber) {
      const target = item.passage.verses.find(
        (v) => v.verseNumber === item.card.repairVerseNumber
      );
      if (target) {
        return target;
      }
    }
    return item.passage.verses[0];
  }

  async onOpenDataFile(): Promise<void> {
    await this.storageService.selectExistingDataFile();
  }

  async onCreateDataFile(): Promise<void> {
    await this.storageService.createNewDataFile();
  }

  async onReconnectDataFile(): Promise<void> {
    await this.storageService.reconnectSavedFileHandle();
  }

  onDisconnectDataFile(): void {
    this.storageService.disconnectDataFile();
  }

  formatSavedTime(iso: string | null): string {
    if (!iso) {
      return 'just now';
    }
    const d = new Date(iso);
    if (isNaN(d.getTime())) {
      return 'just now';
    }
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  addToCurrentlyMemorizing(item: DeckItem, event?: Event): void {
    event?.stopPropagation();
    this.storageService.startMemorizingPassage(item.card.id);
  }

  moveBackToSaved(item: DeckItem, event?: Event): void {
    event?.stopPropagation();
    const isoNow = new Date().toISOString();
    this.storageService.flashcards.update((prev) =>
      prev.map((c) =>
        c.id === item.card.id
          ? {
              ...c,
              state: CardState.CARD_STATE_NEW,
              intervalDays: 0,
              learningStep: 0,
              updatedAt: isoNow,
            }
          : c
      )
    );
    this.storageService.importProtoJson(this.storageService.exportProtoJson(false), false);
  }

  markAsMemorized(item: DeckItem, event?: Event): void {
    event?.stopPropagation();
    this.storageService.recordReview(item.card.id, ReviewRating.REVIEW_RATING_EASY);
  }

  getStitchedProgressLabel(item: DeckItem): string {
    const total = Math.max(1, item.passage.verses.length);
    const stitched = Math.min(total, Math.max(1, item.card.learningStep || 1));
    return `${stitched} of ${total} ${total === 1 ? 'verse' : 'verses'}`;
  }

  getStateLabel(state: CardState): string {
    switch (state) {
      case CardState.CARD_STATE_NEW:
        return 'SAVED';
      case CardState.CARD_STATE_LEARNING:
        return 'MEMORIZING';
      case CardState.CARD_STATE_RELEARNING:
        return 'RELEARNING';
      case CardState.CARD_STATE_REVIEW:
        return 'MEMORIZED';
      default:
        return 'SAVED';
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
      return 'Saved';
    }
    return this.srsService.formatIntervalDays(item.card.intervalDays);
  }

  deleteItem(item: DeckItem, event?: Event): void {
    event?.stopPropagation();
    const svc = this.storageService as unknown as {
      deleteCard?: (cardId: string) => void;
    };
    if (item.card.isRepairCard && typeof svc.deleteCard === 'function') {
      svc.deleteCard(item.card.id);
      return;
    }
    if (item.card.isRepairCard) {
      this.storageService.flashcards.update((prev) => prev.filter((c) => c.id !== item.card.id));
      this.storageService.importProtoJson(this.storageService.exportProtoJson(false), false);
      return;
    }
    this.storageService.deletePassage(item.passage.id);
  }
}
