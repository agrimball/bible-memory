# Bible Memory (`Selah Memory`)

An Angular 19 scripture memorization web application (PWA & Android-ready) combining **Remember Me**'s voice recitation & progressive first-letter scaffolding with **Anki**'s spaced repetition scheduling, **2-Step Daily Verse Stitching**, **Long Passage Memory Repair**, **Dark Mode**, and **Protobuf v3 (`ProtoJSON`)** background file auto-saving.

🌐 **Live Web App (GitHub Pages):** **[https://agrimball.github.io/bible-memory/](https://agrimball.github.io/bible-memory/)**

---

## Core Features

1. **User-Controlled Memorization Workspace (Home vs. Due vs. Memorized)**
   - **Home (`Memorizing & Backlog`)**: Displays **Currently Memorizing** passages alongside **Saved to Memorize Next** backlog items—move any passage into or out of active memorization in any order.
   - **Due Page**: Dedicated Remember-Me style daily SRS review queue showing only active passages that are currently due.
   - **Memorized / Known**: Long-term graduated Anki review rotation.
2. **2-Step Daily Accumulative Verse Stitching**
   - **Step 1 (`New Verse Only`)**: Practice today's target verse (`v. N`) with the preceding verse (`v. N-1`) shown as a lead-in cue.
   - **Step 2 (`Stitch Block v. 1–N`)**: Grading the new verse **Good** or **Easy** automatically transitions the card to **Step 2**, prompting you to recite the entire stitched block (`v. 1..N`) together to lock in the stitch.
3. **Standalone First-Letter Study Page (`+1w` & `+1v`)**
   - Click the compact **`Aa Study`** button on any flashcard header to open the dedicated First-Letter Study Page showing **one verse at a time**.
   - **`+1w` (Reveal Word)**: Reveals the next unrevealed word in the current verse.
   - **`+1v` (Reveal Verse)**: Completes the current verse and **automatically displays the first letters for the next verse** right below it (also triggered automatically when `+1w` reaches the end of a verse).
   - Click **`✕ Exit to Flashcard`** to return to your flashcard at any time.
4. **Voice Recitation Recording & Automatic Flip Playback**
   - Tap **Record Voice** on the front of the card while reciting from memory.
   - Tap **Flip Card** to flip to the back—recording stops automatically and **immediately plays back your voice** while displaying the passage text so you can read along and audit your accuracy.
5. **Simple Copy-Paste Editor with Verse Number Highlight, Stripping & Remembered Boundaries**
   - Plain, predictable text box for pasting passages from any Bible app, with an automatic warning if verse numbers are missing.
   - Click **Highlight Verse Numbers** to preview the exact verse number tokens (`[28]`, `(28)`, superscripts `²⁸`, or inline numbers) highlighted in red strikethrough, then click **Remove Highlighted Verse Numbers** to strip the numbers while **automatically remembering exact verse boundaries** for `+1v` study and stitching.
6. **Long Passage Memory Repair (`🔧 Repair v. X`) & Dark Mode**
   - Stumbled on a specific verse inside a long passage? Click **`🔧 Repair v. X`** on the back of any multi-verse card to spawn a temporary **Spot-Repair Flashcard** that shows the preceding verse (`v. X-1`) as a lead-in cue and prompts you to recite `v. X` until it reaches a **3/3 Good/Easy heal streak** and auto-retires!
   - Full **Dark Mode** by default with a 1-click **☀️ Light / 🌙 Dark** theme toggle in the top bar.
7. **Active Memory Data File (`.proto.json`) & Protobuf v3 (`proto/bible_memory.proto`)**
   - Select or create a `.proto.json` file on your device via **Open Memory File...** or **Create New Memory File...** so every change auto-saves to disk in the background using canonical `biblememory.v1.UserDataBundle` ProtoJSON.

---

## 📱 Installing on Your Android Phone

You can install **Selah Memory** on your Android phone either as a **Standalone Progressive Web App (PWA)** (fastest, no Android Studio required) or as a **Native Android `.apk` via Capacitor**.

### Method 1: Install as a Standalone PWA on Android (Fastest — No Android Studio Needed)

The app includes a preconfigured [`public/manifest.webmanifest`](public/manifest.webmanifest) (`"display": "standalone"`, portrait orientation, theme colors) so Chrome on Android installs it to your home screen as a full-screen standalone app with no browser address bar.

#### Option A: Install Directly from GitHub Pages (Recommended)
1. Open **[https://agrimball.github.io/bible-memory/](https://agrimball.github.io/bible-memory/)** in **Google Chrome** on your Android phone (or from any user account on your computer!).
2. Tap the **three-dot menu (`⋮`)** in the top-right corner of Chrome and select **Add to Home screen** → **Install app**.
3. Launch **Selah Memory** from your Android home screen! (Every push to `main` automatically deploys to GitHub Pages via [`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml)).

#### Option B: Run Locally over USB (`adb reverse`) or Tailscale
If you want to run the app directly from your computer onto your Android phone with full microphone & PWA support:
1. Connect your Android phone via USB with **USB Debugging** enabled and forward port `4200`:
   ```bash
   adb reverse tcp:4200 tcp:4200
   npm start
   ```
2. Open `http://localhost:4200` in Chrome on your Android phone (because `localhost` is treated as a secure origin by Android Chrome, both **Record Voice** and **Install App** work out of the box!).
3. Tap **`⋮` → Add to Home screen → Install app**.

#### Syncing Your `.proto.json` Memory File on Android
- On the Home dashboard (or inside the **ProtoJSON** modal), tap **📂 Open Memory File...** to load your existing `.proto.json` file (e.g., from Google Drive, Syncthing, or local Downloads), or tap **Download `.proto.json`** in the **ProtoJSON** modal to back up your deck at any time.

---

### Method 2: Build & Install a Native Android `.apk` via Capacitor

If you prefer a native installable `.apk` package:

1. **Install Capacitor Core, CLI, and Android platform**:
   ```bash
   npm install @capacitor/core @capacitor/android
   npm install -D @capacitor/cli
   npx cap init "Selah Memory" com.agrimball.biblememory --web-dir dist/bible-memory/browser
   ```
2. **Build the Angular app and add the Android project**:
   ```bash
   npm run build
   npx cap add android
   npx cap sync android
   ```
3. **Enable Microphone Permission for Voice Recitation**:
   In `android/app/src/main/AndroidManifest.xml`, add the `RECORD_AUDIO` permission inside `<manifest>`:
   ```xml
   <uses-permission android:name="android.permission.RECORD_AUDIO" />
   <uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />
   ```
4. **Build and install the `.apk` onto your connected Android phone**:
   ```bash
   cd android
   ./gradlew assembleDebug
   adb install app/build/outputs/apk/debug/app-debug.apk
   ```
   *(Or run `npx cap open android` to open the project in Android Studio and click **Run ▶**).*

---

## Screenshot Tests (`screenshot-tests/`)

Run the automated headless Chromium screenshot test suite:

```bash
npm run build
npm run test:screenshots
```

### Captured Test Screenshots
- [`screenshot-tests/01-deck-dashboard.png`](screenshot-tests/01-deck-dashboard.png) — Home Dashboard with Active Memory Data File bar, **Currently Memorizing**, and **Saved to Memorize Next**
- [`screenshot-tests/01b-due-page.png`](screenshot-tests/01b-due-page.png) — Dedicated Remember-Me style **Due for Review** page
- [`screenshot-tests/02-copy-paste-highlight-verse-numbers.png`](screenshot-tests/02-copy-paste-highlight-verse-numbers.png) — Copy-Paste Editor with **Highlight Verse Numbers** confirmation preview
- [`screenshot-tests/02-smart-copy-paste-modal.png`](screenshot-tests/02-smart-copy-paste-modal.png) — Copy-Paste Editor after stripping verse numbers with **Remembered Verse Boundaries** badge
- [`screenshot-tests/03-card-front-initial.png`](screenshot-tests/03-card-front-initial.png) — Flashcard Front with compact **`Aa Study`** button & **2-Step Daily Stitching** toggle
- [`screenshot-tests/04-study-mode-first-letters-verse1.png`](screenshot-tests/04-study-mode-first-letters-verse1.png) — Separate **First-Letter Study Page** showing Verse 1 first letters (`+1w` / `+1v`)
- [`screenshot-tests/05-study-mode-plus-1w-and-plus-1v.png`](screenshot-tests/05-study-mode-plus-1w-and-plus-1v.png) — Progressive `+1w` & `+1v` reveal completing Verse 1 and automatically surfacing Verse 2's first letters
- [`screenshot-tests/06-voice-recording-active.png`](screenshot-tests/06-voice-recording-active.png) — Active Voice Recitation recording on card front
- [`screenshot-tests/07-card-back-voice-playback-and-anki-grading.png`](screenshot-tests/07-card-back-voice-playback-and-anki-grading.png) — Card Back auto-playing recorded voice alongside passage text, per-verse `🔧 Repair` buttons, and Anki grading buttons
- [`screenshot-tests/07b-memory-repair-card-front.png`](screenshot-tests/07b-memory-repair-card-front.png) — Temporary Long-Passage Memory Repair Flashcard (`0/3` Heal Streak + preceding verse context cue)
- [`screenshot-tests/08-protojson-wire-format-modal.png`](screenshot-tests/08-protojson-wire-format-modal.png) — Live `biblememory.v1.UserDataBundle` ProtoJSON wire-format & auto-save file modal
- [`screenshot-tests/test-report.json`](screenshot-tests/test-report.json) — Structured assertion & verification report
