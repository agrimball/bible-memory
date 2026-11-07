# Bible Memory (`Selah Memory`)

An Angular 19 scripture memorization web application (PWA-ready for Android) combining **Remember Me**'s voice recitation & progressive first-letter scaffolding with **Anki**'s spaced repetition scheduling and **Protobuf v3 (`ProtoJSON`)** wire/storage serialization.

---

## Core Features

1. **Front-of-Card First-Letter Study Mode (`+1w` & `+1v`)**
   - Click **Study (First Letters)** on the front of any flashcard to reveal the first letters of **one verse at a time**.
   - **`+1w` (Reveal Word)**: Reveals the next unrevealed word in the current verse.
   - **`+1v` (Reveal Verse)**: Completes the current verse and **automatically displays the first letters for the next verse** right below it (also triggered automatically when `+1w` reaches the end of a verse).
2. **Voice Recitation Recording & Automatic Flip Playback**
   - Tap **Record Voice** on the front of the card while reciting from memory.
   - Tap **Flip Card** to flip to the back—recording stops automatically and **immediately plays back your voice** while displaying the full passage text so you can read along and audit your accuracy.
3. **Anki Spaced Repetition Scheduling (`Again`, `Hard`, `Good`, `Easy`)**
   - Grades cards using an SM-2 / FSRS-inspired scheduler with live next-interval previews (`<10m`, `1d`, `3d`, `7d`) and immutable `ReviewLog` tracking.
4. **Simple Copy-Paste Editor with 2-Step Verse Number Highlight & Removal**
   - Plain, predictable text box for pasting passages from any Bible app.
   - Click **Highlight Verse Numbers** to preview the exact verse number tokens (`[28]`, `(28)`, superscripts `²⁸`, or inline numbers) highlighted in red strikethrough before clicking **Remove Highlighted Verse Numbers**.
5. **Protobuf v3 (`ProtoJSON`) Schema (`proto/bible_memory.proto`)**
   - Strongly typed `Passage`, `Verse`, `Flashcard`, `ReviewLog`, and `UserDataBundle` messages serialized via canonical Protobuf v3 JSON for local-first storage and 1-click export/import for cloud sync.

---

## Screenshot Tests (`screenshot-tests/`)

Run the automated headless Chromium screenshot test suite:

```bash
npm run build
npm run test:screenshots
```

### Captured Test Screenshots
- [`screenshot-tests/01-deck-dashboard.png`](screenshot-tests/01-deck-dashboard.png) — Deck Dashboard & Anki KPI stats
- [`screenshot-tests/02-copy-paste-highlight-verse-numbers.png`](screenshot-tests/02-copy-paste-highlight-verse-numbers.png) — Copy-Paste Editor with 2-step **Highlight Verse Numbers** confirmation preview
- [`screenshot-tests/03-card-front-initial.png`](screenshot-tests/03-card-front-initial.png) — Flashcard Front initial view
- [`screenshot-tests/04-study-mode-first-letters-verse1.png`](screenshot-tests/04-study-mode-first-letters-verse1.png) — First-Letter Study Mode showing Verse 1 first letters (`+1w` / `+1v`)
- [`screenshot-tests/05-study-mode-plus-1w-and-plus-1v.png`](screenshot-tests/05-study-mode-plus-1w-and-plus-1v.png) — Progressive `+1w` & `+1v` reveal completing Verse 1 and automatically surfacing Verse 2's first letters
- [`screenshot-tests/06-voice-recording-active.png`](screenshot-tests/06-voice-recording-active.png) — Active Voice Recitation recording on card front
- [`screenshot-tests/07-card-back-voice-playback-and-anki-grading.png`](screenshot-tests/07-card-back-voice-playback-and-anki-grading.png) — Card Back auto-playing recorded voice alongside full passage text and Anki grading buttons
- [`screenshot-tests/08-protojson-wire-format-modal.png`](screenshot-tests/08-protojson-wire-format-modal.png) — Live `biblememory.v1.UserDataBundle` ProtoJSON wire-format modal
- [`screenshot-tests/test-report.json`](screenshot-tests/test-report.json) — Structured assertion & verification report
