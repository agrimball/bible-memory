import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { StorageService, DeckItem } from './core/services/storage.service';
import { CardState, ReviewRating, isMultiChapterPassage } from './core/proto/bible_memory.pb';
import { DeckDashboardComponent } from './features/deck/deck-dashboard.component';
import { StudyCardComponent } from './features/study/study-card.component';
import { FirstLetterStudyPageComponent } from './features/study/first-letter-study-page.component';
import { AddPassageModalComponent } from './features/add-passage/add-passage-modal.component';
import { ProtoSyncModalComponent } from './features/sync/proto-sync-modal.component';

const THEME_STORAGE_KEY = 'bible_memory_theme';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    DeckDashboardComponent,
    StudyCardComponent,
    FirstLetterStudyPageComponent,
    AddPassageModalComponent,
    ProtoSyncModalComponent,
  ],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
})
export class AppComponent implements OnInit {
  readonly title = 'bible-memory';
  readonly storageService = inject(StorageService);

  readonly isDarkMode = signal<boolean>(true);
  readonly activeView = signal<'dashboard' | 'study' | 'first-letter-page'>('dashboard');
  readonly dashboardTab = signal<'queue' | 'due' | 'active'>('queue');
  readonly studyQueueIds = signal<string[]>([]);
  readonly currentQueueIndex = signal<number>(0);
  readonly stitchedCountByPassageId = signal<Record<string, number>>({});
  readonly repairHealedBanner = signal<string | null>(null);

  readonly showAddPassageModal = signal<boolean>(false);
  readonly showProtoSyncModal = signal<boolean>(false);

  readonly currentStudyItem = computed<DeckItem | null>(() => {
    const queue = this.studyQueueIds();
    const index = this.currentQueueIndex();
    if (queue.length === 0 || index < 0 || index >= queue.length) {
      return null;
    }
    const targetCardId = queue[index];
    return (
      this.storageService.deckItems().find((item) => item.card.id === targetCardId) ?? null
    );
  });

  readonly currentStitchedVerseCount = computed<number>(() => {
    const item = this.currentStudyItem();
    if (!item) {
      return 0;
    }
    const total = item.passage.verses.length;
    if (item.card.state === CardState.CARD_STATE_REVIEW) {
      return total;
    }
    const map = this.stitchedCountByPassageId();
    const fromMap = map[item.passage.id];
    if (fromMap && fromMap >= 1 && fromMap <= total) {
      return fromMap;
    }
    const savedStep = item.card.learningStep;
    if (savedStep >= 1 && savedStep <= total) {
      return savedStep;
    }
    return 1;
  });

  ngOnInit(): void {
    let initialDark = true;
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem(THEME_STORAGE_KEY);
      if (saved === 'light') {
        initialDark = false;
      } else if (saved === 'dark') {
        initialDark = true;
      }
    }
    this.applyTheme(initialDark);
  }

  toggleTheme(): void {
    this.applyTheme(!this.isDarkMode());
  }

  private applyTheme(isDark: boolean): void {
    this.isDarkMode.set(isDark);
    if (typeof document !== 'undefined') {
      document.documentElement.classList.toggle('dark-theme', isDark);
      document.documentElement.classList.toggle('light-theme', !isDark);
      document.body?.classList.toggle('dark-theme', isDark);
      document.body?.classList.toggle('light-theme', !isDark);
    }
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(THEME_STORAGE_KEY, isDark ? 'dark' : 'light');
      } catch {
        // Ignore storage errors
      }
    }
  }

  openDashboardTab(tab: 'queue' | 'due' | 'active'): void {
    this.repairHealedBanner.set(null);
    this.dashboardTab.set(tab);
    this.activeView.set('dashboard');
  }

  startDueSession(): void {
    this.repairHealedBanner.set(null);
    const dueIds = this.storageService.dueDeckItems().map((item) => item.card.id);
    const activeIds = this.storageService.activeDeckItems().map((item) => item.card.id);
    const allIds = this.storageService.deckItems().map((item) => item.card.id);
    const queue = dueIds.length > 0 ? dueIds : activeIds.length > 0 ? activeIds : allIds;
    if (queue.length === 0) {
      return;
    }
    this.studyQueueIds.set(queue);
    this.currentQueueIndex.set(0);
    this.activeView.set('study');
  }

  practiceSingleItem(item: DeckItem): void {
    this.repairHealedBanner.set(null);
    this.studyQueueIds.set([item.card.id]);
    this.currentQueueIndex.set(0);
    this.activeView.set('study');
  }

  onStartMemorizeFlow(item: DeckItem): void {
    this.repairHealedBanner.set(null);
    this.studyQueueIds.set([item.card.id]);
    this.currentQueueIndex.set(0);
    this.activeView.set('study');
  }

  onStitchedVerseCountChange(count: number): void {
    const item = this.currentStudyItem();
    if (!item) {
      return;
    }
    this.stitchedCountByPassageId.update((prev) => ({
      ...prev,
      [item.passage.id]: count,
    }));
    const svc = this.storageService as StorageService & {
      updateStitchedVerseStep?: (cardId: string, step: number) => void;
    };
    svc.updateStitchedVerseStep?.(item.card.id, count);
  }

  openFirstLetterStudyPage(item: DeckItem): void {
    const current = this.currentStudyItem();
    if (!current || current.card.id !== item.card.id) {
      this.studyQueueIds.set([item.card.id]);
      this.currentQueueIndex.set(0);
    }
    this.activeView.set('first-letter-page');
  }

  onCardRated(event: { cardId: string; rating: ReviewRating }): void {
    const result = this.storageService.recordReview(event.cardId, event.rating);
    if (result && (result as DeckItem & { healed?: boolean }).healed) {
      const multiChap = isMultiChapterPassage(result.passage.verses);
      const verseLabel =
        multiChap && result.card.repairChapterNumber
          ? `${result.card.repairChapterNumber}:${result.card.repairVerseNumber}`
          : `v. ${result.card.repairVerseNumber}`;
      this.repairHealedBanner.set(
        `✓ Memory Repair Complete! ${result.passage.reference} (${verseLabel}) has been healed and retired.`
      );
    }
    const nextIndex = this.currentQueueIndex() + 1;
    if (nextIndex < this.studyQueueIds().length) {
      this.currentQueueIndex.set(nextIndex);
      this.activeView.set('study');
    } else {
      this.activeView.set('dashboard');
    }
  }

  returnToDashboard(): void {
    this.activeView.set('dashboard');
  }

  onPassageAdded(_item: DeckItem): void {
    this.showAddPassageModal.set(false);
    this.dashboardTab.set('queue');
    this.activeView.set('dashboard');
  }
}
