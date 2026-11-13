import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SwUpdate } from '@angular/service-worker';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { StatusBar, Style } from '@capacitor/status-bar';
import { StorageService, DeckItem } from './core/services/storage.service';
import { CardState, Passage, ReviewRating, isMultiChapterPassage } from './core/proto/bible_memory.pb';
import { DeckDashboardComponent } from './features/deck/deck-dashboard.component';
import { StudyCardComponent } from './features/study/study-card.component';
import { FirstLetterStudyPageComponent } from './features/study/first-letter-study-page.component';
import { AddPassageModalComponent } from './features/add-passage/add-passage-modal.component';
import { ProtoSyncModalComponent } from './features/sync/proto-sync-modal.component';

const THEME_STORAGE_KEY = 'bible_memory_theme';
const UI_SESSION_STORAGE_KEY = 'selah_ui_session_v1';
const TEXT_SCALE_STORAGE_KEY = 'selah_text_scale_v1';
const DAILY_REMINDER_STORAGE_KEY = 'selah_daily_reminder_v1';

export interface SelahDailyReminderV1 {
  enabled: boolean;
  time: string;
  onlyWhenDue: boolean;
  lastTriggeredDate?: string;
}

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
  readonly swUpdate = inject(SwUpdate, { optional: true });

  readonly isDarkMode = signal<boolean>(true);
  readonly textScale = signal<number>(1.0);
  readonly isDrawerOpen = signal<boolean>(false);
  readonly activeView = signal<'dashboard' | 'study' | 'first-letter-page'>('dashboard');
  readonly dashboardTab = signal<'queue' | 'due' | 'active'>('queue');
  readonly studyQueueIds = signal<string[]>([]);
  readonly currentQueueIndex = signal<number>(0);
  readonly stitchedCountByPassageId = signal<Record<string, number>>({});
  readonly currentStudyScope = signal<'new-verse' | 'stitched' | 'full'>('new-verse');
  readonly repairHealedBanner = signal<string | null>(null);

  readonly showAddPassageModal = signal<boolean>(false);
  readonly editingPassage = signal<Passage | null>(null);
  readonly appendingToPassage = signal<Passage | null>(null);
  readonly showProtoSyncModal = signal<boolean>(false);
  readonly showReminderModal = signal<boolean>(false);
  readonly testReminderFeedback = signal<string | null>(null);
  readonly isMobileView = signal<boolean>(true);
  readonly reminderSettings = signal<SelahDailyReminderV1>({
    enabled: false,
    time: '08:00',
    onlyWhenDue: true,
  });
  private reminderIntervalId: ReturnType<typeof setInterval> | null = null;
  private readonly boundResize = () => {
    this.updateIsMobileView();
  };

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
    const savedStep = item.card.learningStep || 1;
    if (item.card.state === CardState.CARD_STATE_REVIEW && savedStep >= total) {
      return total;
    }
    const map = this.stitchedCountByPassageId();
    const fromMap = map[item.passage.id];
    if (fromMap && fromMap >= 1 && fromMap <= total) {
      return fromMap;
    }
    if (item.card.state === CardState.CARD_STATE_NEW) {
      return total;
    }
    if (savedStep >= 1 && savedStep <= total) {
      return savedStep;
    }
    return 1;
  });

  hasActiveFileHandle(): boolean {
    const svc = this.storageService as StorageService & {
      hasActiveFileHandle?: () => boolean;
    };
    if (typeof svc.hasActiveFileHandle === 'function') {
      return svc.hasActiveFileHandle();
    }
    return Boolean(this.storageService.activeFileName());
  }

  filePermissionState(): string {
    const svc = this.storageService as StorageService & {
      filePermissionState?: () => string;
    };
    if (typeof svc.filePermissionState === 'function') {
      return svc.filePermissionState();
    }
    const status = this.storageService.activeFileStatus();
    if (status === 'saved' || status === 'saving') {
      return 'granted';
    }
    if (status === 'needs-permission' || status === 'error') {
      return 'denied';
    }
    return this.storageService.activeFileName() ? 'granted' : 'prompt';
  }

  cloudStatusTitle(): string {
    const status = this.storageService.fileConnectionStatus();
    if (status === 'connected') {
      return 'Memory File connected & auto-saving';
    }
    if (status === 'unsaved-disconnected') {
      return 'Unsaved changes — tap to reconnect & save to file';
    }
    return 'Select or create a .selahmemory file';
  }

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
      if (this.swUpdate?.isEnabled) {
        this.swUpdate.checkForUpdate().catch(() => {});
      }
    }
  };

  ngOnInit(): void {
    let initialDark = true;
    let initialScale = 1.0;
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem(THEME_STORAGE_KEY);
      if (saved === 'light') {
        initialDark = false;
      } else if (saved === 'dark') {
        initialDark = true;
      }
      const savedScale = Number(localStorage.getItem(TEXT_SCALE_STORAGE_KEY));
      if (!Number.isNaN(savedScale) && savedScale >= 0.8 && savedScale <= 1.35) {
        initialScale = Number(savedScale.toFixed(2));
      }
    }
    this.applyTheme(initialDark);
    this.applyTextScale(initialScale);
    this.updateIsMobileView();
    this.loadReminderSettings();
    this.restoreUiSession();
    this.registerNativeAndBrowserListeners();
    if (this.swUpdate?.isEnabled) {
      this.swUpdate.checkForUpdate().catch(() => {});
    }
    this.checkDailyReminderSchedule();
    this.reminderIntervalId = setInterval(() => {
      this.checkDailyReminderSchedule();
    }, 30000);
  }

  ngOnDestroy(): void {
    if (this.reminderIntervalId !== null) {
      clearInterval(this.reminderIntervalId);
      this.reminderIntervalId = null;
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('popstate', this.boundPopState);
      window.removeEventListener('resize', this.boundResize);
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.boundVisibilityChange);
    }
  }

  private registerNativeAndBrowserListeners(): void {
    if (typeof window !== 'undefined') {
      window.addEventListener('popstate', this.boundPopState);
      window.addEventListener('resize', this.boundResize);
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

  toggleDrawer(): void {
    const next = !this.isDrawerOpen();
    this.isDrawerOpen.set(next);
    if (next) {
      this.pushHistoryEntry('drawer');
    }
  }

  closeDrawer(): void {
    this.isDrawerOpen.set(false);
  }

  /**
   * Handles hardware/browser back navigation from innermost to outermost layer:
   * 1. Close Add Passage / ProtoSync modal or Navigation Drawer if open
   * 2. Exit First-Letter Study Page back to the Flashcard
   * 3. Exit Flashcard Study view back to the Deck Dashboard
   * 4. Returns false only when already at the root Deck Dashboard with no modals open
   */
  handleBackNavigation(): boolean {
    if (this.showAddPassageModal()) {
      this.closeAddPassageModal();
      return true;
    }
    if (this.showProtoSyncModal()) {
      this.showProtoSyncModal.set(false);
      return true;
    }
    if (this.showReminderModal()) {
      this.closeReminderModal();
      return true;
    }
    if (this.isDrawerOpen()) {
      this.isDrawerOpen.set(false);
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

  onTextScaleInput(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    if (!input) {
      return;
    }
    const raw = Number(input.value);
    if (!Number.isNaN(raw)) {
      this.applyTextScale(raw);
    }
  }

  applyTextScale(scale: number): void {
    const clamped = Number(Math.max(0.8, Math.min(1.35, scale)).toFixed(2));
    this.textScale.set(clamped);
    if (typeof document !== 'undefined') {
      document.documentElement.style.setProperty('--selah-text-scale', String(clamped));
    }
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(TEXT_SCALE_STORAGE_KEY, String(clamped));
      } catch {
        // Ignore storage errors
      }
    }
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
    this.editingPassage.set(null);
    this.appendingToPassage.set(null);
    this.isDrawerOpen.set(false);
    this.showAddPassageModal.set(true);
    this.pushHistoryEntry('add-modal');
  }

  openEditPassageModal(itemOrPassage?: DeckItem | Passage | null): void {
    const target = itemOrPassage ?? this.currentStudyItem();
    if (!target) {
      return;
    }
    const passage = 'passage' in target ? target.passage : target;
    this.appendingToPassage.set(null);
    this.editingPassage.set(passage);
    this.isDrawerOpen.set(false);
    this.showAddPassageModal.set(true);
    this.pushHistoryEntry('edit-modal');
  }

  openAppendPassageModal(itemOrPassage?: DeckItem | Passage | null): void {
    const target = itemOrPassage ?? this.currentStudyItem();
    if (!target) {
      return;
    }
    const passage = 'passage' in target ? target.passage : target;
    this.editingPassage.set(null);
    this.appendingToPassage.set(passage);
    this.isDrawerOpen.set(false);
    this.showAddPassageModal.set(true);
    this.pushHistoryEntry('append-modal');
  }

  closeAddPassageModal(): void {
    this.showAddPassageModal.set(false);
    this.editingPassage.set(null);
    this.appendingToPassage.set(null);
  }

  openSyncModal(): void {
    this.isDrawerOpen.set(false);
    this.showProtoSyncModal.set(true);
    this.pushHistoryEntry('sync-modal');
  }

  openProtoModalFromDrawer(): void {
    this.openSyncModal();
  }

  openReminderModalFromDrawer(): void {
    this.closeDrawer();
    this.testReminderFeedback.set(null);
    this.showReminderModal.set(true);
    this.pushHistoryEntry('reminder-modal');
  }

  closeReminderModal(): void {
    this.showReminderModal.set(false);
    this.testReminderFeedback.set(null);
  }

  private loadReminderSettings(): void {
    if (typeof localStorage === 'undefined') {
      return;
    }
    try {
      const raw = localStorage.getItem(DAILY_REMINDER_STORAGE_KEY);
      if (!raw) {
        return;
      }
      const parsed = JSON.parse(raw) as Partial<SelahDailyReminderV1>;
      this.reminderSettings.set({
        enabled: Boolean(parsed.enabled),
        time: typeof parsed.time === 'string' && /^\d{2}:\d{2}$/.test(parsed.time) ? parsed.time : '08:00',
        onlyWhenDue: parsed.onlyWhenDue !== undefined ? Boolean(parsed.onlyWhenDue) : true,
        lastTriggeredDate: parsed.lastTriggeredDate,
      });
    } catch {
      // Ignore malformed JSON
    }
  }

  private saveReminderSettings(next: SelahDailyReminderV1): void {
    this.reminderSettings.set(next);
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(DAILY_REMINDER_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Ignore storage errors
      }
    }
  }

  toggleDailyReminder(): void {
    const curr = this.reminderSettings();
    const nextEnabled = !curr.enabled;
    this.saveReminderSettings({
      ...curr,
      enabled: nextEnabled,
    });
    if (
      nextEnabled &&
      typeof window !== 'undefined' &&
      'Notification' in window &&
      Notification.permission === 'default'
    ) {
      Notification.requestPermission().catch(() => {});
    }
  }

  onReminderTimeChange(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    const val = input?.value?.trim();
    if (!val) {
      return;
    }
    const curr = this.reminderSettings();
    this.saveReminderSettings({
      ...curr,
      time: val,
    });
  }

  onReminderOnlyWhenDueChange(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    if (!input) {
      return;
    }
    const curr = this.reminderSettings();
    this.saveReminderSettings({
      ...curr,
      onlyWhenDue: Boolean(input.checked),
    });
  }

  formatReminderTimeDisplay(timeStr: string): string {
    const match = (timeStr || '08:00').match(/^(\d{1,2}):(\d{2})$/);
    if (!match) {
      return timeStr || '08:00';
    }
    const hours24 = Number(match[1]);
    const mins = match[2];
    const period = hours24 >= 12 ? 'PM' : 'AM';
    const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
    return `${hours12}:${mins} ${period}`;
  }

  private updateIsMobileView(): void {
    try {
      if (Capacitor.isNativePlatform()) {
        this.isMobileView.set(true);
        return;
      }
    } catch {
      // Ignore outside Capacitor
    }
    if (typeof window !== 'undefined') {
      this.isMobileView.set(window.innerWidth <= 768);
    }
  }

  checkDailyReminderSchedule(): void {
    if (!this.isMobileView()) {
      return;
    }
    const settings = this.reminderSettings();
    if (!settings.enabled) {
      return;
    }
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const todayDateStr = `${yyyy}-${mm}-${dd}`;
    if (settings.lastTriggeredDate === todayDateStr) {
      return;
    }

    const hh = String(now.getHours()).padStart(2, '0');
    const min = String(now.getMinutes()).padStart(2, '0');
    const currentHHMM = `${hh}:${min}`;
    if (currentHHMM < settings.time) {
      return;
    }

    this.saveReminderSettings({
      ...settings,
      lastTriggeredDate: todayDateStr,
    });

    const dueCount = this.storageService.dueDeckItems().length;
    if (!settings.onlyWhenDue || dueCount > 0) {
      void this.fireReminderNotification();
    }
  }

  buildReminderNotificationPayload(): {
    title: string;
    options: NotificationOptions & { renotify?: boolean; badge?: string };
  } {
    const dueItems = this.storageService.dueDeckItems();
    let message = 'Time for your daily Scripture meditation!';
    if (dueItems.length > 0) {
      const totalWords = dueItems.reduce(
        (sum, item) =>
          sum +
          item.passage.verses.reduce(
            (vSum, v) => vSum + (v.text.trim() ? v.text.trim().split(/\s+/).length : 0),
            0
          ),
        0
      );
      const estMin = Math.max(1, Math.round(totalWords / 130));
      message = `You have ${dueItems.length} ${dueItems.length === 1 ? 'passage' : 'passages'} due today (~${estMin}m).`;
    }

    const baseHref =
      typeof document !== 'undefined' && document.baseURI
        ? document.baseURI
        : 'http://localhost/';

    return {
      title: 'Selah Memory',
      options: {
        body: message,
        icon: new URL('icon-192.png', baseHref).href,
        badge: new URL('notification-badge-96.png', baseHref).href,
        tag: 'selah-daily-reminder',
        renotify: true,
        data: {
          onActionClick: {
            default: {
              operation: 'navigateLastFocusedOrOpen',
              url: './',
            },
          },
        },
      },
    };
  }

  async fireReminderNotification(): Promise<void> {
    if (
      typeof window === 'undefined' ||
      !('Notification' in window) ||
      Notification.permission !== 'granted'
    ) {
      return;
    }

    const { title, options } = this.buildReminderNotificationPayload();

    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      if (reg?.showNotification) {
        await reg.showNotification(title, options);
        return;
      }
    } catch {
      // Fall back to window Notification constructor below
    }

    try {
      new Notification(title, options);
    } catch {
      // Ignore notification errors in headless/restricted environments
    }
  }

  async sendTestReminderNotification(): Promise<void> {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      this.testReminderFeedback.set('Notifications are blocked in browser settings');
      return;
    }

    let permission = Notification.permission;
    if (permission === 'default') {
      try {
        permission = await Notification.requestPermission();
      } catch {
        permission = Notification.permission;
      }
    }

    if (permission !== 'granted') {
      this.testReminderFeedback.set('Notifications are blocked in browser settings');
      return;
    }

    await this.fireReminderNotification();
    this.testReminderFeedback.set('✓ Test notification sent');
  }

  async onDrawerOpenFile(): Promise<void> {
    const ok = await this.storageService.selectExistingDataFile();
    if (ok) {
      this.closeDrawer();
    }
  }

  async onDrawerCreateFile(): Promise<void> {
    const ok = await this.storageService.createNewDataFile();
    if (ok) {
      this.closeDrawer();
    }
  }

  onDeckTabChange(tab: 'queue' | 'due' | 'active'): void {
    this.dashboardTab.set(tab);
    this.saveUiSession();
  }

  openDashboardTab(tab: 'queue' | 'due' | 'active'): void {
    this.isDrawerOpen.set(false);
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
    if (item.card.state !== CardState.CARD_STATE_NEW) {
      const svc = this.storageService as StorageService & {
        updateStitchedVerseStep?: (cardId: string, step: number) => void;
      };
      svc.updateStitchedVerseStep?.(item.card.id, count);
    }
  }

  onChunkCarved(remainingItem: DeckItem): void {
    this.stitchedCountByPassageId.update((prev) => {
      const next = { ...prev };
      delete next[remainingItem.passage.id];
      return next;
    });
    const queue = [...this.studyQueueIds()];
    const idx = this.currentQueueIndex();
    if (idx >= 0 && idx < queue.length) {
      queue[idx] = remainingItem.card.id;
      this.studyQueueIds.set(queue);
    } else {
      this.studyQueueIds.set([remainingItem.card.id]);
      this.currentQueueIndex.set(0);
    }
    this.saveUiSession();
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

  onSkipCard(): void {
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
    const wasEditingOrAppendingInStudy =
      (this.editingPassage() !== null || this.appendingToPassage() !== null) &&
      this.activeView() !== 'dashboard';
    this.closeAddPassageModal();
    if (!wasEditingOrAppendingInStudy) {
      this.dashboardTab.set('queue');
      this.activeView.set('dashboard');
    }
    this.saveUiSession();
  }
}
