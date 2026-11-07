import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { StorageService, DeckItem } from './core/services/storage.service';
import { ReviewRating } from './core/proto/bible_memory.pb';
import { DeckDashboardComponent } from './features/deck/deck-dashboard.component';
import { StudyCardComponent } from './features/study/study-card.component';
import { AddPassageModalComponent } from './features/add-passage/add-passage-modal.component';
import { ProtoSyncModalComponent } from './features/sync/proto-sync-modal.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    DeckDashboardComponent,
    StudyCardComponent,
    AddPassageModalComponent,
    ProtoSyncModalComponent,
  ],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
})
export class AppComponent {
  readonly storageService = inject(StorageService);

  readonly activeView = signal<'dashboard' | 'study'>('dashboard');
  readonly studyQueueIds = signal<string[]>([]);
  readonly currentQueueIndex = signal<number>(0);

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

  startDueSession(): void {
    const dueIds = this.storageService.dueDeckItems().map((item) => item.card.id);
    const allIds = this.storageService.deckItems().map((item) => item.card.id);
    const queue = dueIds.length > 0 ? dueIds : allIds;
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

  onCardRated(event: { cardId: string; rating: ReviewRating }): void {
    this.storageService.recordReview(event.cardId, event.rating);
    const nextIndex = this.currentQueueIndex() + 1;
    if (nextIndex < this.studyQueueIds().length) {
      this.currentQueueIndex.set(nextIndex);
    } else {
      this.activeView.set('dashboard');
    }
  }

  returnToDashboard(): void {
    this.activeView.set('dashboard');
  }

  onPassageAdded(_item: DeckItem): void {
    this.showAddPassageModal.set(false);
  }
}
