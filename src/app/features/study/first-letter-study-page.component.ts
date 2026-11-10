import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  OnInit,
  Output,
  SimpleChanges,
  computed,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Passage } from '../../core/proto/bible_memory.pb';
import { DeckItem } from '../../core/services/storage.service';
import {
  FirstLetterStudyService,
  StudyVerseView,
  StudyWordToken,
} from '../../core/services/first-letter-study.service';

@Component({
  selector: 'app-first-letter-study-page',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="study-page-workspace" data-testid="first-letter-study-page" *ngIf="item; else noItemState">
      <!-- Single Compact 52px Top App Bar for First-Letter Study Page -->
      <header class="study-page-topbar">
        <div class="topbar-left">
          <button
            type="button"
            class="btn-exit-to-card"
            data-testid="btn-back-to-card"
            (click)="backToCard.emit()"
            title="Exit to Flashcard"
          >
            <span aria-hidden="true">←</span>
          </button>

          <h1 class="study-page-reference" data-testid="study-page-reference">
            {{ passageTitleWithLabel() }}
          </h1>
        </div>

        <div class="study-page-progress" data-testid="study-progress-indicator">
          <span class="progress-badge">
            {{ activeVerseView()?.verseLabel ?? ('v. ' + (studyService.activeVerseIndex() + 1)) }}
            ({{ studyService.activeVerseIndex() + 1 }}/{{ studyService.totalVersesCount() }})
          </span>
          <span class="completed-pill" *ngIf="studyService.allVersesCompleted()">
            ✓ Done
          </span>
          <button
            type="button"
            class="btn-back-deck-subtle"
            data-testid="btn-back-to-deck"
            (click)="backToDeck.emit()"
          >
            Deck
          </button>
        </div>
      </header>

      <!-- Main Study Page Panel (Full-Screen Scrollable Verses) -->
      <article class="study-page-shell" data-testid="first-letter-study-panel">
        <div class="study-verses-list" data-testid="study-visible-verses">
          <div
            *ngFor="let verse of studyService.visibleVerses(); trackBy: trackByVerseNumber"
            class="study-verse-block"
            [class.verse-completed]="verse.status === 'completed'"
            [class.verse-active]="verse.status === 'active'"
            [attr.data-testid]="'study-verse-' + verse.verseNumber"
          >
            <span class="verse-number-badge">{{ verse.verseLabel }}</span>

            <!-- Completed Verse: Full Revealed Text -->
            <div *ngIf="verse.status === 'completed'" class="verse-tokens-flow completed-flow">
              <span
                *ngFor="let word of verse.words; trackBy: trackByWordIndex"
                class="word-token revealed"
              >{{ word.fullText }}</span>
              <span class="verse-check-badge" title="Verse completed" aria-hidden="true">✓</span>
            </div>

            <!-- Active Verse: Revealed Words + First-Letter Hints -->
            <div *ngIf="verse.status === 'active'" class="verse-tokens-flow active-flow">
              <span
                *ngFor="let word of verse.words; trackBy: trackByWordIndex"
                class="word-token"
                [class.revealed]="word.isRevealed"
                [class.first-letter]="!word.isRevealed"
              >{{ word.isRevealed ? word.fullText : word.firstLetterText }}</span>
            </div>
          </div>
        </div>
      </article>

      <!-- Compact Bottom Study Reveal Controls Bar -->
      <footer class="study-controls-bar" data-testid="study-controls-bar">
        <div class="reveal-buttons-group">
          <button
            type="button"
            class="btn-study-reveal btn-reveal-word"
            data-testid="btn-reveal-1w"
            [disabled]="studyService.allVersesCompleted()"
            (click)="studyService.revealOneWord()"
          >
            <span class="btn-key">+1w</span>
            <span>Word</span>
          </button>

          <button
            type="button"
            class="btn-study-reveal btn-reveal-verse"
            data-testid="btn-reveal-1v"
            [disabled]="studyService.allVersesCompleted()"
            (click)="studyService.revealOneVerse()"
          >
            <span class="btn-key">+1v</span>
            <span>Verse</span>
          </button>
        </div>

        <div class="study-secondary-actions">
          <button
            type="button"
            class="btn-reset-study"
            data-testid="btn-reset-study"
            (click)="resetStudy()"
          >
            Reset
          </button>

          <button
            type="button"
            class="btn-return-card-primary"
            data-testid="btn-exit-study"
            (click)="backToCard.emit()"
          >
            Done ↩
          </button>
        </div>
      </footer>
    </div>

    <ng-template #noItemState>
      <div class="study-empty-state">
        <h2>No passage loaded for study</h2>
        <button type="button" class="btn-exit-to-card" (click)="backToDeck.emit()">
          ← Back to Deck
        </button>
      </div>
    </ng-template>
  `,
  styles: [
    `
      :host {
        display: flex;
        flex-direction: column;
        width: 100%;
        height: 100%;
        flex: 1;
        overflow: hidden;
        color: #f8fafc;
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      }

      .study-page-workspace {
        display: flex;
        flex-direction: column;
        width: 100%;
        height: 100%;
        flex: 1;
        background: #090d16;
        overflow: hidden;
      }

      /* Single 52px Top App Bar */
      .study-page-topbar {
        height: 52px;
        min-height: 52px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: env(safe-area-inset-top, 0px) 10px 0;
        background: #111827;
        color: #f8fafc;
        border-bottom: 1px solid rgba(148, 163, 184, 0.14);
        gap: 8px;
        flex-shrink: 0;
        box-sizing: content-box;
      }

      :host-context(.theme-light) .study-page-topbar {
        background: #ffffff;
        color: #0f172a;
        border-bottom: 1px solid #e2e8f0;
      }

      .topbar-left {
        display: flex;
        align-items: center;
        gap: 6px;
        min-width: 0;
        flex: 1;
      }

      .btn-exit-to-card {
        width: 36px;
        height: 36px;
        border-radius: 50%;
        border: none;
        background: transparent;
        color: #ffffff;
        font-size: 1.15rem;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        flex-shrink: 0;
      }

      .btn-exit-to-card:hover {
        background: rgba(255, 255, 255, 0.14);
      }

      .study-page-reference {
        margin: 0;
        font-size: 1rem;
        font-weight: 600;
        color: #ffffff;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .study-page-progress {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-shrink: 0;
      }

      .progress-badge {
        padding: 3px 8px;
        border-radius: 999px;
        font-size: 0.72rem;
        font-weight: 700;
        background: rgba(0, 0, 0, 0.28);
        color: #fde68a;
        white-space: nowrap;
      }

      .completed-pill {
        padding: 3px 8px;
        border-radius: 999px;
        font-size: 0.72rem;
        font-weight: 700;
        background: rgba(16, 185, 129, 0.3);
        color: #a7f3d0;
      }

      .btn-back-deck-subtle {
        padding: 4px 9px;
        border-radius: 999px;
        border: 1px solid rgba(255, 255, 255, 0.28);
        background: rgba(0, 0, 0, 0.2);
        color: #ffffff;
        font-size: 0.72rem;
        font-weight: 600;
        cursor: pointer;
      }

      /* Full-Height Scrollable Study Panel */
      .study-page-shell {
        margin: 8px 10px;
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        background: #111827;
        border: 1px solid #1e293b;
        border-radius: 12px;
        padding: 10px 12px;
        -webkit-overflow-scrolling: touch;
      }

      .study-verses-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .study-verse-block {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        padding: 8px 10px;
        border-radius: 10px;
        transition: all 0.16s ease;
      }

      .study-verse-block.verse-completed {
        background: rgba(16, 185, 129, 0.08);
        border: 1px solid rgba(52, 211, 153, 0.25);
      }

      .study-verse-block.verse-active {
        background: #1e293b;
        border: 1.5px solid #f59e0b;
      }

      .verse-number-badge {
        flex-shrink: 0;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 2px 6px;
        border-radius: 5px;
        font-family: 'JetBrains Mono', 'Fira Code', monospace;
        font-size: 0.72rem;
        font-weight: 700;
        background: #0f172a;
        color: #cbd5e1;
        margin-top: 2px;
      }

      .verse-completed .verse-number-badge {
        background: rgba(16, 185, 129, 0.2);
        color: #6ee7b7;
      }

      .verse-active .verse-number-badge {
        background: rgba(245, 158, 11, 0.22);
        color: #fde68a;
      }

      .verse-tokens-flow {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        gap: 4px 5px;
        line-height: 1.48;
        flex: 1;
      }

      .word-token {
        display: inline-block;
        transition: all 0.12s ease;
      }

      .word-token.revealed {
        font-family: 'Georgia', 'Cambria', serif;
        font-size: calc(0.94rem * var(--selah-text-scale, 1));
        font-weight: 600;
        color: #f8fafc;
      }

      .verse-completed .word-token.revealed {
        color: #a7f3d0;
      }

      .word-token.first-letter {
        padding: 2px 6px;
        border-radius: 5px;
        background: #0f172a;
        border: 1px solid #334155;
        font-family: 'JetBrains Mono', 'Fira Code', 'Courier New', monospace;
        font-size: calc(0.84rem * var(--selah-text-scale, 1));
        font-weight: 700;
        color: #fbbf24;
        letter-spacing: 0.02em;
      }

      .verse-check-badge {
        margin-left: auto;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 18px;
        height: 18px;
        border-radius: 50%;
        background: #10b981;
        color: #ffffff;
        font-size: 0.68rem;
        font-weight: 700;
      }

      /* Compact Bottom Study Controls Bar */
      .study-controls-bar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 8px 12px calc(8px + env(safe-area-inset-bottom, 0px));
        background: #090d16;
        border-top: 1px solid #1e293b;
        flex-shrink: 0;
      }

      .reveal-buttons-group {
        display: flex;
        align-items: center;
        gap: 6px;
        flex: 1;
      }

      .btn-study-reveal {
        flex: 1;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        padding: 9px 10px;
        border-radius: 8px;
        font-size: 0.84rem;
        font-weight: 700;
        cursor: pointer;
      }

      .btn-study-reveal:disabled {
        opacity: 0.45;
        cursor: not-allowed;
      }

      .btn-reveal-word {
        background: #334155;
        color: #f8fafc;
        border: 1px solid #475569;
      }

      .btn-reveal-verse {
        background: #d97706;
        color: #ffffff;
        border: 1px solid #b45309;
      }

      .btn-key {
        padding: 1px 5px;
        border-radius: 4px;
        background: rgba(0, 0, 0, 0.24);
        font-family: monospace;
        font-size: 0.76rem;
      }

      .study-secondary-actions {
        display: flex;
        align-items: center;
        gap: 6px;
      }

      .btn-reset-study {
        padding: 9px 10px;
        border-radius: 8px;
        border: 1px solid #334155;
        background: #1e293b;
        color: #cbd5e1;
        font-size: 0.8rem;
        font-weight: 600;
        cursor: pointer;
      }

      .btn-return-card-primary {
        padding: 9px 12px;
        border-radius: 8px;
        border: 1px solid #0d9488;
        background: #0f766e;
        color: #ffffff;
        font-size: 0.82rem;
        font-weight: 700;
        cursor: pointer;
      }

      /* Light mode overrides */
      :host-context(html:not(.dark-theme)) .study-page-workspace {
        background: #f3efe6;
        color: #1e293b;
      }
      :host-context(html:not(.dark-theme)) .study-page-shell {
        background: #fffdf9;
        border-color: #ded6c6;
      }
      :host-context(html:not(.dark-theme)) .word-token.revealed {
        color: #0f172a;
      }
      :host-context(html:not(.dark-theme)) .study-verse-block.verse-active {
        background: #ffffff;
        border-color: #d97706;
      }
      :host-context(html:not(.dark-theme)) .word-token.first-letter {
        background: #f1ece1;
        border-color: #d6cebe;
        color: #78350f;
      }
    `,
  ],
})
export class FirstLetterStudyPageComponent implements OnInit, OnChanges {
  readonly studyService = inject(FirstLetterStudyService);

  @Input() item: DeckItem | null = null;
  @Input() stitchedVerseCount: number | null = null;
  @Output() backToCard = new EventEmitter<void>();
  @Output() backToDeck = new EventEmitter<void>();

  readonly passageTitleWithLabel = computed<string>(() => {
    const p = this.item?.passage as (Passage & { label?: string }) | undefined;
    if (!p) {
      return '';
    }
    const cleanLabel = p.label?.trim();
    return cleanLabel ? `${p.reference} (${cleanLabel})` : p.reference;
  });

  readonly activeVerseView = computed<StudyVerseView | null>(() => {
    const visible = this.studyService.visibleVerses();
    if (visible.length === 0) {
      return null;
    }
    return visible.find((v) => v.status === 'active') ?? visible[visible.length - 1];
  });

  ngOnInit(): void {
    this.initStudyMode();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['item'] || changes['stitchedVerseCount']) {
      this.initStudyMode();
    }
  }

  private getEffectivePassage(): Passage | null {
    return this.item?.passage ?? null;
  }

  private initStudyMode(): void {
    const passage = this.getEffectivePassage();
    if (passage) {
      this.studyService.loadPassage(passage);
      this.studyService.enterStudyMode();
    }
  }

  resetStudy(): void {
    const passage = this.getEffectivePassage();
    if (passage) {
      this.studyService.loadPassage(passage);
    }
    this.studyService.enterStudyMode();
  }

  trackByVerseNumber(_index: number, verse: StudyVerseView): number {
    return verse.verseIndex;
  }

  trackByWordIndex(_index: number, word: StudyWordToken): number {
    return word.index;
  }
}
