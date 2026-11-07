import { Component, EventEmitter, Input, Output, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CardState, ReviewRating } from '../../core/proto/bible_memory.pb';
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
          <span class="kpi-sub">In-progress stitching</span>
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
          <span class="kpi-label">Total Passages</span>
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
                its <strong>Flashcard</strong> (with accumulative verse stitching &amp; a dedicated
                <strong>First-Letter Study Page</strong>).
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

          <!-- SECTION A: CURRENTLY MEMORIZING (LEARNING / RELEARNING) -->
          <div class="home-subsection" data-testid="currently-memorizing-section">
            <div class="section-header">
              <div>
                <h3 class="section-title">
                  🔥 Currently Memorizing ({{ currentlyMemorizingItems().length }})
                </h3>
                <p class="section-subtitle">
                  Passages you are actively working on memorizing and stitching together right now.
                  Click any card to open its Flashcard.
                </p>
              </div>
            </div>

            <div class="passage-deck-list" data-testid="currently-memorizing-list">
              @for (item of currentlyMemorizingItems(); track item.passage.id; let i = $index) {
                <article
                  class="deck-item-card clickable-card memorizing-card"
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
                  </div>

                  <div class="deck-item-actions" (click)="$event.stopPropagation()">
                    <button
                      type="button"
                      class="study-card-btn"
                      (click)="onOpenFlashcard(item)"
                      [attr.data-testid]="'btn-open-memorizing-card-' + i"
                    >
                      Open Flashcard →
                    </button>
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
              @for (item of storageService.queuedDeckItems(); track item.passage.id; let i = $index) {
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
                      (click)="deletePassage(item.passage.id, $event)"
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
                Passages in your active rotation whose Anki / SM-2 review interval is due right now.
                Tap any passage below to open its Flashcard, or practice all due cards in sequence.
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
            @for (item of storageService.dueDeckItems(); track item.passage.id; let i = $index) {
              <article
                class="deck-item-card is-due clickable-card"
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

                    <span class="due-indicator">Due Now</span>
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
            @for (item of storageService.activeDeckItems(); track item.passage.id; let i = $index) {
              <article
                class="deck-item-card clickable-card"
                [class.is-due]="item.isDue"
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
                    } @else {
                      <span class="scheduled-indicator">Scheduled</span>
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
                  <button
                    type="button"
                    class="phase-action-btn move-saved-btn"
                    (click)="moveBackToSaved(item, $event)"
                    title="Move back to Saved to Memorize Next"
                  >
                    ↩ Move to Saved
                  </button>
                  <button
                    type="button"
                    class="delete-card-btn"
                    (click)="deletePassage(item.passage.id, $event)"
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
        background: #fffbeb;
        border: 1px solid #f59e0b;
        border-radius: 0.85rem;
        padding: 0.8rem 1.15rem;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
        flex-wrap: wrap;
      }

      .data-file-connected-row {
        background: #f0fdf4;
        border: 1px solid #86efac;
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
        background: #d97706;
        box-shadow: 0 0 0 3px rgba(217, 119, 6, 0.2);
      }

      .file-status-dot.connected {
        background: #16a34a;
        box-shadow: 0 0 0 3px rgba(22, 163, 74, 0.2);
      }

      .file-status-dot.error {
        background: #dc2626;
        box-shadow: 0 0 0 3px rgba(220, 38, 38, 0.2);
      }

      .file-copy {
        display: flex;
        flex-direction: column;
        gap: 0.12rem;
        min-width: 0;
      }

      .file-headline {
        font-size: 0.85rem;
        color: #1c1917;
      }

      .file-headline code {
        background: rgba(28, 25, 23, 0.08);
        padding: 0.08rem 0.38rem;
        border-radius: 0.3rem;
        font-size: 0.82rem;
      }

      .file-subtext {
        font-size: 0.77rem;
        color: #57534e;
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
        background: #ffffff;
        border: 1px solid #d6cfc2;
        color: #292524;
      }

      .open-file-btn:hover {
        background: #f5f0e6;
      }

      .create-file-btn {
        background: #0f766e;
        border: 1px solid #0f766e;
        color: #ffffff;
      }

      .create-file-btn:hover {
        background: #115e59;
      }

      .disconnect-file-btn {
        background: transparent;
        border: 1px solid #d6cfc2;
        color: #78716c;
      }

      .disconnect-file-btn:hover {
        background: #fee2e2;
        border-color: #fecaca;
        color: #991b1b;
      }

      .dashboard-tabs-bar {
        display: flex;
        align-items: center;
        gap: 0.65rem;
        background: #efe9dc;
        padding: 0.4rem;
        border-radius: 0.85rem;
        border: 1px solid #e2dac9;
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
        color: #57534e;
        font-size: 0.9rem;
        font-weight: 700;
        cursor: pointer;
        transition: all 0.15s ease;
      }

      .tab-pill:hover {
        color: #1c1917;
        background: rgba(255, 255, 255, 0.55);
      }

      .tab-pill.active {
        background: #fffdf9;
        color: #1c1917;
        box-shadow: 0 2px 8px rgba(28, 25, 23, 0.08);
      }

      .tab-badge {
        font-size: 0.75rem;
        font-weight: 800;
        padding: 0.14rem 0.52rem;
        border-radius: 999px;
      }

      .queue-badge {
        background: #dbeafe;
        color: #1e40af;
      }

      .due-badge {
        background: #ccfbf1;
        color: #0f766e;
      }

      .active-badge {
        background: #dcfce7;
        color: #166534;
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
        background: linear-gradient(135deg, #292524 0%, #1c1917 100%);
        color: #fafaf9;
        border-radius: 1.1rem;
        padding: 1.55rem 1.8rem;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1.4rem;
        flex-wrap: wrap;
        box-shadow: 0 12px 28px rgba(28, 25, 23, 0.14);
      }

      .due-hero {
        background: linear-gradient(135deg, #134e4a 0%, #0f766e 100%);
      }

      .active-hero {
        background: linear-gradient(135deg, #3f3a34 0%, #292524 100%);
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
        color: #5eead4;
        margin-bottom: 0.35rem;
      }

      .hero-title {
        margin: 0;
        font-size: 1.48rem;
        font-weight: 800;
        letter-spacing: -0.02em;
        color: #ffffff;
      }

      .hero-description {
        margin: 0.45rem 0 0;
        font-size: 0.87rem;
        line-height: 1.5;
        color: #e7e5e4;
      }

      .hero-description code {
        background: rgba(255, 255, 255, 0.14);
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
        box-shadow: 0 4px 12px rgba(13, 148, 136, 0.28);
      }

      .study-due-btn:hover:not(:disabled) {
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
        grid-template-columns: repeat(auto-fit, minmax(165px, 1fr));
        gap: 0.8rem;
      }

      .kpi-card {
        background: #fffdf9;
        border: 1px solid #e7e0d3;
        border-radius: 0.85rem;
        padding: 0.95rem 1.1rem;
        display: flex;
        flex-direction: column;
        gap: 0.18rem;
        box-shadow: 0 2px 6px rgba(28, 25, 23, 0.04);
      }

      .clickable-kpi {
        cursor: pointer;
        transition: border-color 0.15s ease, transform 0.12s ease;
      }

      .clickable-kpi:hover {
        border-color: #b8afa0;
        transform: translateY(-1px);
      }

      .selected-kpi {
        border-color: #0f766e;
        box-shadow: 0 0 0 2px rgba(15, 118, 110, 0.14);
      }

      .kpi-label {
        font-size: 0.74rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: #78716c;
      }

      .kpi-value {
        font-size: 1.7rem;
        font-weight: 800;
        line-height: 1.15;
        color: #1c1917;
      }

      .queue-kpi .kpi-value {
        color: #2563eb;
      }

      .due-kpi .kpi-value {
        color: #0f766e;
      }

      .learning-kpi .kpi-value {
        color: #d97706;
      }

      .review-kpi .kpi-value {
        color: #15803d;
      }

      .kpi-sub {
        font-size: 0.74rem;
        color: #a8a29e;
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
        transition: border-color 0.15s ease, box-shadow 0.15s ease, transform 0.12s ease;
      }

      .clickable-card {
        cursor: pointer;
      }

      .clickable-card:hover {
        border-color: #0f766e;
        box-shadow: 0 6px 18px rgba(28, 25, 23, 0.08);
      }

      .memorizing-card {
        border-left: 4px solid #d97706;
      }

      .queue-card {
        border-left: 4px solid #2563eb;
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

      .stitch-progress-pill {
        font-size: 0.73rem;
        font-weight: 700;
        padding: 0.15rem 0.58rem;
        border-radius: 999px;
        background: #fffbeb;
        color: #92400e;
        border: 1px solid #fde68a;
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

      .scheduled-indicator {
        font-size: 0.72rem;
        font-weight: 600;
        color: #78716c;
        background: #f5f0e6;
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
        flex-wrap: wrap;
      }

      .start-memorize-btn {
        padding: 0.56rem 0.95rem;
        border-radius: 0.6rem;
        border: 1px solid #d97706;
        background: #fffbeb;
        color: #92400e;
        font-size: 0.81rem;
        font-weight: 700;
        cursor: pointer;
        transition: all 0.15s ease;
        white-space: nowrap;
      }

      .start-memorize-btn:hover {
        background: #fef3c7;
      }

      .study-card-btn {
        padding: 0.58rem 1rem;
        border-radius: 0.6rem;
        border: 1px solid #0f766e;
        background: #0f766e;
        color: #ffffff;
        font-size: 0.83rem;
        font-weight: 600;
        cursor: pointer;
        transition: background 0.15s ease;
        white-space: nowrap;
      }

      .study-card-btn:hover {
        background: #115e59;
      }

      .subtle-study-btn {
        background: #f5f0e6;
        color: #292524;
        border-color: #d6cfc2;
      }

      .subtle-study-btn:hover {
        background: #e7e0d3;
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
        background: #dcfce7;
        border: 1px solid #86efac;
        color: #166534;
      }

      .mark-memorized-btn:hover {
        background: #bbf7d0;
      }

      .move-saved-btn {
        background: #faf6ee;
        border: 1px solid #d6cfc2;
        color: #57534e;
      }

      .move-saved-btn:hover {
        background: #efe9dc;
        color: #1c1917;
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
        padding: 2.2rem 1.5rem;
        color: #57534e;
      }

      .compact-empty {
        padding: 1.25rem 1.25rem;
      }

      .empty-deck-box h4 {
        margin: 0 0 0.4rem;
        font-size: 1.08rem;
        color: #1c1917;
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
   * Passages the user has chosen to actively work on memorizing right now
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

  deletePassage(passageId: string, event?: Event): void {
    event?.stopPropagation();
    this.storageService.deletePassage(passageId);
  }
}
