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
      <!-- Top Navigation Bar for Standalone Remember-Me Style Study Page -->
      <div class="study-page-topbar">
        <div class="topbar-nav-buttons">
          <button
            type="button"
            class="btn-exit-to-card"
            data-testid="btn-back-to-card"
            (click)="backToCard.emit()"
          >
            <span aria-hidden="true">✕</span>
            <span>Exit to Flashcard</span>
          </button>

          <button
            type="button"
            class="btn-back-deck-subtle"
            data-testid="btn-back-to-deck"
            (click)="backToDeck.emit()"
          >
            <span>Deck</span>
          </button>
        </div>

        <div class="study-page-progress" data-testid="study-progress-indicator">
          <span class="progress-badge">
            v. {{ activeVerseView()?.verseNumber ?? (studyService.activeVerseIndex() + 1) }} ({{ studyService.activeVerseIndex() + 1 }} of {{ studyService.totalVersesCount() }})
          </span>
          <span class="progress-words" *ngIf="activeVerseView() as activeVerse">
            {{ activeVerse.revealedWordCount }} / {{ activeVerse.totalWordCount }} words revealed
          </span>
          <span class="completed-pill" *ngIf="studyService.allVersesCompleted()">
            All verses revealed
          </span>
        </div>
      </div>

      <!-- Main Study Page Panel -->
      <article class="study-page-shell" data-testid="first-letter-study-panel">
        <header class="study-page-header">
          <div class="header-titles">
            <span class="study-mode-eyebrow">
              <span class="study-dot" aria-hidden="true"></span>
              First-Letter Study Page
              <ng-container *ngIf="stitchedVerseCount && stitchedVerseCount < item.passage.verses.length">
                · Stitching {{ stitchedVerseCount }} of {{ item.passage.verses.length }} Verses
              </ng-container>
            </span>
            <h1 class="study-page-reference" data-testid="study-page-reference">
              {{ item.passage.reference }}
            </h1>
          </div>

          <div class="header-hint">
            Tap <strong>+1w</strong> to reveal the next word or <strong>+1v</strong> to complete the current verse and reveal the next verse's first letters.
          </div>
        </header>

        <!-- Visible Verses Scaffold (Completed Verses + Active Verse) -->
        <div class="study-verses-list" data-testid="study-visible-verses">
          <div
            *ngFor="let verse of studyService.visibleVerses(); trackBy: trackByVerseNumber"
            class="study-verse-block"
            [class.verse-completed]="verse.status === 'completed'"
            [class.verse-active]="verse.status === 'active'"
            [attr.data-testid]="'study-verse-' + verse.verseNumber"
          >
            <span class="verse-number-badge">[{{ verse.verseNumber }}]</span>

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

        <!-- Study Reveal Controls Bar -->
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
              <span>+1w (Reveal Word)</span>
            </button>

            <button
              type="button"
              class="btn-study-reveal btn-reveal-verse"
              data-testid="btn-reveal-1v"
              [disabled]="studyService.allVersesCompleted()"
              (click)="studyService.revealOneVerse()"
            >
              <span class="btn-key">+1v</span>
              <span>+1v (Reveal Verse)</span>
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
              ✕ Exit to Flashcard
            </button>
          </div>
        </footer>
      </article>
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
        display: block;
        width: 100%;
        max-width: 860px;
        margin: 0 auto;
        color: #f8fafc;
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      }

      .study-page-workspace {
        display: flex;
        flex-direction: column;
        gap: 1.15rem;
        padding: 0.5rem 0 2.5rem;
      }

      .study-page-topbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 0.75rem;
      }

      .topbar-nav-buttons {
        display: flex;
        align-items: center;
        gap: 0.55rem;
      }

      .btn-exit-to-card {
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.55rem 1.05rem;
        border-radius: 999px;
        border: 1px solid rgba(251, 191, 36, 0.35);
        background: rgba(245, 158, 11, 0.14);
        color: #fbbf24;
        font-size: 0.875rem;
        font-weight: 700;
        cursor: pointer;
        transition: all 0.16s ease;
      }

      .btn-exit-to-card:hover {
        background: rgba(245, 158, 11, 0.24);
      }

      .btn-back-deck-subtle {
        padding: 0.52rem 0.9rem;
        border-radius: 999px;
        border: 1px solid #334155;
        background: #1e293b;
        color: #cbd5e1;
        font-size: 0.84rem;
        font-weight: 600;
        cursor: pointer;
      }

      .btn-back-deck-subtle:hover {
        background: #334155;
        color: #f8fafc;
      }

      .study-page-progress {
        display: flex;
        align-items: center;
        gap: 0.55rem;
        flex-wrap: wrap;
      }

      .progress-badge {
        padding: 0.32rem 0.78rem;
        border-radius: 999px;
        font-size: 0.8rem;
        font-weight: 700;
        background: #1e293b;
        border: 1px solid #334155;
        color: #f8fafc;
      }

      .progress-words {
        font-size: 0.82rem;
        font-weight: 600;
        color: #94a3b8;
      }

      .completed-pill {
        padding: 0.3rem 0.75rem;
        border-radius: 999px;
        font-size: 0.78rem;
        font-weight: 700;
        background: rgba(16, 185, 129, 0.2);
        color: #6ee7b7;
        border: 1px solid rgba(52, 211, 153, 0.35);
      }

      .study-page-shell {
        background: linear-gradient(180deg, #162032 0%, #0f172a 100%);
        border: 1px solid #334155;
        border-radius: 20px;
        box-shadow:
          0 16px 38px -10px rgba(0, 0, 0, 0.55),
          0 4px 12px -2px rgba(0, 0, 0, 0.35);
        padding: 1.65rem 1.85rem;
        display: flex;
        flex-direction: column;
        gap: 1.35rem;
      }

      .study-page-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 1rem;
        padding-bottom: 1.1rem;
        border-bottom: 1px solid #1e293b;
      }

      .header-titles {
        display: flex;
        flex-direction: column;
        gap: 0.3rem;
      }

      .study-mode-eyebrow {
        display: inline-flex;
        align-items: center;
        gap: 0.45rem;
        font-size: 0.76rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.07em;
        color: #fbbf24;
      }

      .study-dot {
        width: 9px;
        height: 9px;
        border-radius: 50%;
        background: #f59e0b;
      }

      .study-page-reference {
        margin: 0;
        font-family: 'Georgia', 'Cambria', 'Times New Roman', serif;
        font-size: 1.85rem;
        font-weight: 700;
        color: #f8fafc;
      }

      .header-hint {
        max-width: 340px;
        font-size: 0.83rem;
        line-height: 1.45;
        color: #cbd5e1;
        background: #1e293b;
        padding: 0.65rem 0.9rem;
        border-radius: 10px;
        border: 1px solid #334155;
      }

      .study-verses-list {
        display: flex;
        flex-direction: column;
        gap: 0.95rem;
      }

      .study-verse-block {
        display: flex;
        align-items: flex-start;
        gap: 0.8rem;
        padding: 1.1rem 1.25rem;
        border-radius: 14px;
        transition: all 0.2s ease;
      }

      .study-verse-block.verse-completed {
        background: rgba(16, 185, 129, 0.1);
        border: 1px solid rgba(52, 211, 153, 0.3);
      }

      .study-verse-block.verse-active {
        background: #1e293b;
        border: 2px solid #f59e0b;
        box-shadow: 0 4px 16px rgba(245, 158, 11, 0.12);
      }

      .verse-number-badge {
        flex-shrink: 0;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 2.15rem;
        padding: 0.22rem 0.48rem;
        border-radius: 6px;
        font-family: 'JetBrains Mono', 'Fira Code', monospace;
        font-size: 0.82rem;
        font-weight: 700;
        background: #0f172a;
        color: #cbd5e1;
        margin-top: 0.12rem;
      }

      .verse-completed .verse-number-badge {
        background: rgba(16, 185, 129, 0.2);
        color: #6ee7b7;
      }

      .verse-active .verse-number-badge {
        background: rgba(245, 158, 11, 0.2);
        color: #fde68a;
      }

      .verse-tokens-flow {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        gap: 0.45rem 0.5rem;
        line-height: 1.8;
        flex: 1;
      }

      .word-token {
        display: inline-block;
        transition: all 0.14s ease;
      }

      .word-token.revealed {
        font-family: 'Georgia', 'Cambria', serif;
        font-size: 1.16rem;
        font-weight: 700;
        color: #f8fafc;
      }

      .verse-completed .word-token.revealed {
        color: #a7f3d0;
        font-weight: 600;
      }

      .word-token.first-letter {
        padding: 0.14rem 0.48rem;
        border-radius: 6px;
        background: #0f172a;
        border: 1px solid #334155;
        font-family: 'JetBrains Mono', 'Fira Code', 'Courier New', monospace;
        font-size: 0.98rem;
        font-weight: 700;
        color: #fbbf24;
        letter-spacing: 0.04em;
      }

      .verse-check-badge {
        margin-left: auto;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 22px;
        height: 22px;
        border-radius: 50%;
        background: #10b981;
        color: #ffffff;
        font-size: 0.75rem;
        font-weight: 700;
      }

      .study-controls-bar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 0.85rem;
        padding-top: 1rem;
        border-top: 1px solid #1e293b;
      }

      .reveal-buttons-group {
        display: flex;
        align-items: center;
        gap: 0.65rem;
        flex-wrap: wrap;
      }

      .btn-study-reveal {
        display: inline-flex;
        align-items: center;
        gap: 0.55rem;
        padding: 0.72rem 1.2rem;
        border-radius: 10px;
        font-size: 0.92rem;
        font-weight: 700;
        cursor: pointer;
        transition: all 0.14s ease;
      }

      .btn-study-reveal:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .btn-reveal-word {
        background: #334155;
        color: #f8fafc;
        border: 1px solid #475569;
      }

      .btn-reveal-word:hover:not(:disabled) {
        background: #475569;
      }

      .btn-reveal-verse {
        background: #d97706;
        color: #ffffff;
        border: 1px solid #b45309;
      }

      .btn-reveal-verse:hover:not(:disabled) {
        background: #b45309;
      }

      .btn-key {
        padding: 0.15rem 0.45rem;
        border-radius: 5px;
        background: rgba(255, 255, 255, 0.2);
        font-family: monospace;
        font-size: 0.82rem;
      }

      .study-secondary-actions {
        display: flex;
        align-items: center;
        gap: 0.55rem;
        flex-wrap: wrap;
      }

      .btn-reset-study {
        padding: 0.6rem 0.95rem;
        border-radius: 8px;
        border: 1px solid #334155;
        background: #1e293b;
        color: #cbd5e1;
        font-size: 0.84rem;
        font-weight: 600;
        cursor: pointer;
      }

      .btn-reset-study:hover {
        background: #334155;
        color: #f8fafc;
      }

      .btn-return-card-primary {
        padding: 0.62rem 1.05rem;
        border-radius: 8px;
        border: 1px solid #0d9488;
        background: #0f766e;
        color: #ffffff;
        font-size: 0.85rem;
        font-weight: 700;
        cursor: pointer;
      }

      .btn-return-card-primary:hover {
        background: #115e59;
      }

      /* Light mode overrides when html is not .dark-theme */
      :host-context(html:not(.dark-theme)) {
        color: #1e293b;
      }
      :host-context(html:not(.dark-theme)) .study-page-shell {
        background: linear-gradient(180deg, #fffdf9 0%, #f8f4ea 100%);
        border-color: #ded6c6;
        box-shadow: 0 14px 34px -10px rgba(30, 41, 59, 0.12);
      }
      :host-context(html:not(.dark-theme)) .study-page-reference,
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
      :host-context(html:not(.dark-theme)) .header-hint {
        background: #f3efe6;
        border-color: #e4decb;
        color: #57534e;
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
