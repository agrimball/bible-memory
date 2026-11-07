import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { StorageService, DeckItem } from './core/services/storage.service';
import { ReviewRating } from './core/proto/bible_memory.pb';
import { DeckDashboardComponent } from './features/deck/deck-dashboard.component';
import { StudyCardComponent } from './features/study/study-card.component';
import { FirstLetterStudyPageComponent } from './features/study/first-letter-study-page.component';
import { AddPassageModalComponent } from './features/add-passage/add-passage-modal.component';
import { ProtoSyncModalComponent } from './features/sync/proto-sync-modal.component';

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
export class AppComponent {
  readonly storageService = inject(StorageService);

  readonly activeView = signal<'dashboard' | 'study' | 'first-letter-page'>('dashboard');
  readonly dashboardTab = signal<'queue' | 'due' | 'active'>('queue');
  readonly studyQueueIds = signal<string[]>([]);
  readonly currentQueueIndex = signal<number>(0);
  readonly stitchedCountByPassageId = signal<Record<string, number>>({});

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
    const map = this.stitchedCountByPassageId();
    return map[item.passage.id] ?? item.passage.verses.length;
  });

  openDashboardTab(tab: 'queue' | 'due' | 'active'): void {
    this.dashboardTab.set(tab);
    this.activeView.set('dashboard');
  }

  startDueSession(): void {
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
    this.studyQueueIds.set([item.card.id]);
    this.currentQueueIndex.set(0);
    this.activeView.set('study');
  }

  onStartMemorizeFlow(item: DeckItem): void {
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
    this.storageService.recordReview(event.cardId, event.rating);
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
