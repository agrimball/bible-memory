import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { App } from '@capacitor/app';
import { StatusBar, Style } from '@capacitor/status-bar';
import { StorageService, DeckItem } from './core/services/storage.service';
import { CardState, ReviewRating, isMultiChapterPassage } from './core/proto/bible_memory.pb';
import { DeckDashboardComponent } from './features/deck/deck-dashboard.component';
import { StudyCardComponent } from './features/study/study-card.component';
import { FirstLetterStudyPageComponent } from './features/study/first-letter-study-page.component';
import { AddPassageModalComponent } from './features/add-passage/add-passage-modal.component';
import { ProtoSyncModalComponent } from './features/sync/proto-sync-modal.component';

const THEME_STORAGE_KEY = 'bible_memory_theme';
const UI_SESSION_STORAGE_KEY = 'selah_ui_session_v1';

export interface SelahUiSessionV1 {
  viewMode: 'deck' | 'study';
  activeCardId: string | null;
  studyPageOpen: boolean;
  activeDeckTab: 'queue' | 'due' | 'active';
  studyQueueIds?: string[];
  currentQueueIndex?: number;
}

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
export class AppComponent implements OnInit, OnDestroy {
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

  /** Computed aliases matching the selah_ui_session_v1 schema */
  readonly viewMode = computed<'deck' | 'study'>(() =>
    this.activeView() === 'dashboard' ? 'deck' : 'study'
  );
  readonly studyPageOpen = computed<boolean>(() => this.activeView() === 'first-letter-page');
  readonly activeDeckTab = computed<'queue' | 'due' | 'active'>(() => this.dashboardTab());

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

  readonly activeCardId = computed<string | null>(() => {
    return (
      this.currentStudyItem()?.card.id ??
      this.studyQueueIds()[this.currentQueueIndex()] ??
      null
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

  private isHandlingPopState = false;
  private readonly boundPopState = () => {
    this.isHandlingPopState = true;
    try {
      this.handleBackNavigation();
    } finally {
      this.isHandlingPopState = false;
    }
  };
  private readonly boundVisibilityChange = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
      this.restoreUiSessionIfNeeded();
    }
  };

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
    this.restoreUiSession();
    this.registerNativeAndBrowserListeners();
  }

  ngOnDestroy(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('popstate', this.boundPopState);
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.boundVisibilityChange);
    }
  }

  private registerNativeAndBrowserListeners(): void {
    if (typeof window !== 'undefined') {
      window.addEventListener('popstate', this.boundPopState);
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.boundVisibilityChange);
    }

    try {
      App.addListener('backButton', () => {
        const handled = this.handleBackNavigation();
        if (!handled) {
          App.minimizeApp().catch(() => {
            App.exitApp().catch(() => {});
          });
        }
      });

      App.addListener('appStateChange', ({ isActive }) => {
        if (isActive) {
          this.restoreUiSessionIfNeeded();
        } else {
          this.saveUiSession();
        }
      });
    } catch {
      // Ignore if running in non-Capacitor test environment
    }
  }

  private pushHistoryEntry(step: string): void {
    if (this.isHandlingPopState || typeof window === 'undefined' || !window.history) {
      return;
    }
    try {
      window.history.pushState({ selahStep: step, ts: Date.now() }, '');
    } catch {
      // Ignore history errors
    }
  }

  /**
   * Handles hardware/browser back navigation from innermost to outermost layer:
   * 1. Close Add Passage / ProtoSync modal if open
   * 2. Exit First-Letter Study Page back to the Flashcard
   * 3. Exit Flashcard Study view back to the Deck Dashboard
   * 4. Returns false only when already at the root Deck Dashboard with no modals open
   */
  handleBackNavigation(): boolean {
    if (this.showAddPassageModal()) {
      this.showAddPassageModal.set(false);
      return true;
    }
    if (this.showProtoSyncModal()) {
      this.showProtoSyncModal.set(false);
      return true;
    }
    if (this.activeView() === 'first-letter-page') {
      this.activeView.set('study');
      this.saveUiSession();
      return true;
    }
    if (this.activeView() === 'study') {
      this.activeView.set('dashboard');
      this.saveUiSession();
      return true;
    }
    return false;
  }

  saveUiSession(): void {
    if (typeof localStorage === 'undefined') {
      return;
    }
    try {
      const session: SelahUiSessionV1 = {
        viewMode: this.activeView() === 'dashboard' ? 'deck' : 'study',
        activeCardId: this.activeCardId(),
        studyPageOpen: this.activeView() === 'first-letter-page',
        activeDeckTab: this.dashboardTab(),
        studyQueueIds: this.studyQueueIds(),
        currentQueueIndex: this.currentQueueIndex(),
      };
      localStorage.setItem(UI_SESSION_STORAGE_KEY, JSON.stringify(session));
    } catch {
      // Ignore storage errors
    }
  }

  restoreUiSession(): void {
    if (typeof localStorage === 'undefined') {
      return;
    }
    try {
      const raw = localStorage.getItem(UI_SESSION_STORAGE_KEY);
      if (!raw) {
        return;
      }
      const parsed = JSON.parse(raw) as Partial<SelahUiSessionV1>;
      if (
        parsed.activeDeckTab === 'queue' ||
        parsed.activeDeckTab === 'due' ||
        parsed.activeDeckTab === 'active'
      ) {
        this.dashboardTab.set(parsed.activeDeckTab);
      }

      if (parsed.viewMode === 'study' && parsed.activeCardId) {
        const allCards = this.storageService.deckItems();
        const cardExists = allCards.some((item) => item.card.id === parsed.activeCardId);
        if (cardExists) {
          const validQueue = Array.isArray(parsed.studyQueueIds)
            ? parsed.studyQueueIds.filter((id) =>
                allCards.some((item) => item.card.id === id)
              )
            : [];
          const queueToUse =
            validQueue.length > 0 && validQueue.includes(parsed.activeCardId)
              ? validQueue
              : [parsed.activeCardId];
          const idx = Math.max(0, queueToUse.indexOf(parsed.activeCardId));

          this.studyQueueIds.set(queueToUse);
          this.currentQueueIndex.set(idx);
          this.activeView.set(parsed.studyPageOpen ? 'first-letter-page' : 'study');
          this.pushHistoryEntry('study-restored');
          if (parsed.studyPageOpen) {
            this.pushHistoryEntry('first-letter-restored');
          }
          return;
        }
      }
    } catch {
      // Ignore malformed session JSON
    }
  }

  private restoreUiSessionIfNeeded(): void {
    if (this.activeView() === 'dashboard') {
      this.restoreUiSession();
    }
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
    try {
      StatusBar.setStyle({ style: isDark ? Style.Dark : Style.Light }).catch(() => {});
      StatusBar.setBackgroundColor({ color: isDark ? '#0f172a' : '#faf7f2' }).catch(() => {});
    } catch {
      // Ignore in browser environment
    }
  }

  openAddModal(): void {
    this.showAddPassageModal.set(true);
    this.pushHistoryEntry('add-modal');
  }

  openSyncModal(): void {
    this.showProtoSyncModal.set(true);
    this.pushHistoryEntry('sync-modal');
  }

  onDeckTabChange(tab: 'queue' | 'due' | 'active'): void {
    this.dashboardTab.set(tab);
    this.saveUiSession();
  }

  openDashboardTab(tab: 'queue' | 'due' | 'active'): void {
    this.repairHealedBanner.set(null);
    this.dashboardTab.set(tab);
    this.activeView.set('dashboard');
    this.saveUiSession();
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
    this.pushHistoryEntry('study');
    this.saveUiSession();
  }

  practiceSingleItem(item: DeckItem): void {
    this.repairHealedBanner.set(null);
    this.studyQueueIds.set([item.card.id]);
    this.currentQueueIndex.set(0);
    this.activeView.set('study');
    this.pushHistoryEntry('study');
    this.saveUiSession();
  }

  onStartMemorizeFlow(item: DeckItem): void {
    this.repairHealedBanner.set(null);
    this.studyQueueIds.set([item.card.id]);
    this.currentQueueIndex.set(0);
    this.activeView.set('study');
    this.pushHistoryEntry('study');
    this.saveUiSession();
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
    this.pushHistoryEntry('first-letter-page');
    this.saveUiSession();
  }

  returnFromStudyPageToCard(): void {
    this.activeView.set('study');
    this.saveUiSession();
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
    this.saveUiSession();
  }

  returnToDashboard(): void {
    this.activeView.set('dashboard');
    this.saveUiSession();
  }

  onPassageAdded(_item: DeckItem): void {
    this.showAddPassageModal.set(false);
    this.dashboardTab.set('queue');
    this.activeView.set('dashboard');
    this.saveUiSession();
  }
}
