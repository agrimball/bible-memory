# Playwright Screenshot & End-to-End Verification Suite

This directory contains the automated headless Chromium screenshot and end-to-end verification harness for the **Bible Memory** Angular 19 application.

## Prerequisites

1. Build and serve the Angular application on `http://127.0.0.1:4200` (or set `APP_URL`):
   ```bash
   npx ng serve --host 127.0.0.1 --port 4200
   ```
2. Run the screenshot test runner:
   ```bash
   node screenshot-tests/run-screenshot-tests.mjs
   ```

## Captured User Journeys & Screenshots

All screenshots are rendered at `1440x960` (`deviceScaleFactor: 2`) and saved into `screenshot-tests/output/` (with top-level copies in `screenshot-tests/`):

| # | Screenshot File | Verified User Journey & Assertions |
|---|---|---|
| 1 | `01-deck-dashboard.png` | Navigates to the Deck Dashboard, verifies `[data-testid="deck-stats-grid"]` and `[data-testid="passage-deck-list"]`, and asserts starter passages (`Romans 8:1-4`, `Psalm 23:1-6`) and Anki due counts are rendered. |
| 2 | `02-copy-paste-highlight-verse-numbers.png` / `02-smart-copy-paste-modal.png` | Opens `[data-testid="btn-open-add-passage"]`, populates multi-verse scripture via `[data-testid="btn-paste-example"]`, clicks `[data-testid="btn-highlight-verse-numbers"]`, verifies `[data-testid="verse-number-highlight-preview"]` and `[data-testid="parsed-verses-preview"]`, confirms removal via `[data-testid="btn-remove-verse-numbers"]`, and saves via `[data-testid="btn-save-passage"]`. |
| 3 | `03-card-front-initial.png` | Enters card review (`[data-testid="btn-study-card-0"]` or `[data-testid="btn-study-due"]`) and verifies `[data-testid="card-reference"]`, `[data-testid="btn-enter-study"]`, `[data-testid="btn-record-voice"]`, and `[data-testid="btn-flip-card"]`. |
| 4 | `04-study-mode-first-letters-verse1.png` | Clicks `[data-testid="btn-enter-study"]` and verifies `[data-testid="first-letter-study-panel"]` displays the first letters for **Verse 1 only** alongside `[data-testid="btn-reveal-1w"]` (`+1w`) and `[data-testid="btn-reveal-1v"]` (`+1v`). |
| 5 | `05-study-mode-plus-1w-and-plus-1v.png` | Clicks `+1w` 3 times on Verse 1, clicks `+1v` to reveal the remainder of Verse 1 and automatically surface **Verse 2 in first-letter mode**, then clicks `+1w` twice on Verse 2. |
| 6 | `06-voice-recording-active.png` | Clicks `[data-testid="btn-record-voice"]` on the card front (using Chromium fake media stream flags), waits ~1.2s, and verifies `[data-testid="recording-active-indicator"]`. |
| 7 | `07-card-back-voice-playback-and-anki-grading.png` | Flips the card via `[data-testid="btn-flip-card"]` while recording and verifies `[data-testid="card-back-view"]`, automatic audio playback in `[data-testid="voice-playback-bar"]`, full text read-along in `[data-testid="card-back-full-text"]`, and `[data-testid="anki-grading-bar"]` (`Again` / `Hard` / `Good` / `Easy`). |
| 8 | `08-protojson-wire-format-modal.png` | Grades the card with `[data-testid="btn-grade-good"]`, opens `[data-testid="btn-open-proto-sync"]`, and verifies `[data-testid="protojson-textarea"]` contains valid `biblememory.v1` JSON (`passages`, `flashcards`, `reviewLogs`). |

## Test Report Output

After execution, a structured JSON report with assertion results, byte sizes, and timestamps is written to:
- `screenshot-tests/test-report.json`
