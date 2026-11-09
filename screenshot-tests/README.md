# Playwright Screenshot & End-to-End Verification Suite

This directory contains the automated headless Chromium screenshot and end-to-end verification harness for the **Bible Memory** Angular 19 application.

## Prerequisites

1. Build the Angular application:
   ```bash
   npm run build
   ```
2. Run the TypeScript screenshot test runner (automatically serves `dist/bible-memory/browser` if `APP_URL` is not provided, or connects to `APP_URL`):
   ```bash
   npx tsx screenshot-tests/run-screenshot-tests.ts
   ```

## Captured User Journeys & Screenshots

All screenshots are rendered at `1440x960` (`deviceScaleFactor: 2`) and saved into `screenshot-tests/output/` (with top-level copies in `screenshot-tests/`):

| # | Screenshot File | Verified User Journey & Assertions |
|---|---|---|
| 1a | `01-deck-dashboard.png` | Navigates to the Home page (`[data-testid="tab-queue"]`), verifies the **Active Memory Data File** bar (`[data-testid="active-data-file-bar"]`, `[data-testid="btn-open-data-file"]`, `[data-testid="btn-create-data-file"]`), **Currently Memorizing** section (`[data-testid="currently-memorizing-section"]`), and **Saved to Memorize Next** backlog (`[data-testid="saved-backlog-section"]`). |
| 1b | `01b-due-page.png` | Clicks `[data-testid="tab-due"]` to open the Remember-Me style **Due for Review** page (`[data-testid="due-page-section"]`), verifying active due passages (`Philippians 4:6-7`, `John 1:1-5`) and `[data-testid="btn-study-due"]`. |
| 2a | `02-copy-paste-highlight-verse-numbers.png` | Opens `[data-testid="btn-open-add-passage"]`, verifies `[data-testid="warning-no-verse-numbers"]` appears when plain text without verse numbers is entered, populates multi-verse scripture via `[data-testid="btn-paste-example"]`, clicks `[data-testid="btn-highlight-verse-numbers"]`, and verifies `[data-testid="verse-number-highlight-preview"]`. |
| 2b | `02-smart-copy-paste-modal.png` | Clicks `[data-testid="btn-remove-verse-numbers"]` to strip verse numbers while preserving exact verse boundaries (`[data-testid="remembered-boundaries-badge"]`) in `[data-testid="parsed-verses-preview"]`, then saves via `[data-testid="btn-save-passage"]`. |
| 3 | `03-card-front-initial.png` | Opens the Flashcard Front (`[data-testid="card-front-view"]`) from the Home page and verifies `[data-testid="card-reference"]`, the compact `"Aa Study"` header button (`[data-testid="btn-enter-study"]`), the **2-Step Daily Stitching** toggle (`[data-testid="stitch-mode-toggle"]`, `[data-testid="btn-mode-new-verse"]`, `[data-testid="btn-mode-stitch-block"]`), `[data-testid="btn-record-voice"]`, and `[data-testid="btn-flip-card"]`. |
| 4 | `04-study-mode-first-letters-verse1.png` | Clicks `[data-testid="btn-enter-study"]` to open the **separate First-Letter Study Page** (`[data-testid="first-letter-study-page"]`) and verifies `[data-testid="first-letter-study-panel"]` displays the first letters for **Verse 1 only** alongside `[data-testid="btn-reveal-1w"]` (`+1w`), `[data-testid="btn-reveal-1v"]` (`+1v`), and `[data-testid="btn-back-to-card"]` (`✕ Exit to Flashcard`). |
| 5 | `05-study-mode-plus-1w-and-plus-1v.png` | Clicks `+1w` 3 times on Verse 1, clicks `+1v` to reveal the remainder of Verse 1 and automatically surface **Verse 2 in first-letter mode**, clicks `+1w` twice on Verse 2, and exits back to the Flashcard Front via `[data-testid="btn-back-to-card"]`. |
| 6 | `06-voice-recording-active.png` | Clicks `[data-testid="btn-record-voice"]` on the card front (using Chromium fake media stream flags), waits ~1.25s, and verifies `[data-testid="recording-active-indicator"]`. |
| 7 | `07-card-back-voice-playback-and-anki-grading.png` | Flips the card via `[data-testid="btn-flip-card"]` while recording and verifies `[data-testid="card-back-view"]`, automatic audio playback in `[data-testid="voice-playback-bar"]`, full text read-along in `[data-testid="card-back-full-text"]`, and `[data-testid="anki-grading-bar"]` (`Again` / `Hard` / `Good` / `Easy`). |
| 8 | `08-protojson-wire-format-modal.png` | Grades the card with `[data-testid="btn-grade-good"]`, opens `[data-testid="btn-open-proto-sync"]`, and verifies `[data-testid="protojson-textarea"]` contains valid `biblememory.v1` JSON (`passages`, `flashcards`, `reviewLogs`). |

## Test Report Output

After execution, a structured JSON report with assertion results, byte sizes, and timestamps is written to:
- `screenshot-tests/test-report.json`
