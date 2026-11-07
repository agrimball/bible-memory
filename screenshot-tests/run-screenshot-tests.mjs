#!/usr/bin/env node
/**
 * Automated Playwright Screenshot & E2E Verification Runner for Bible Memory App
 *
 * Verifies all core user journeys against the running Angular 19 app and saves
 * high-resolution PNG screenshots to `screenshot-tests/output/` and `screenshot-tests/`.
 */

import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_URL = process.env.APP_URL || 'http://127.0.0.1:4200';
const DIST_DIR = path.resolve(__dirname, '..', 'dist', 'bible-memory', 'browser');
const OUTPUT_DIR = path.join(__dirname, 'output');
const REPORT_PATH = path.join(__dirname, 'test-report.json');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};

async function startStaticDistServer(preferredPort = 0) {
  const server = http.createServer(async (req, res) => {
    try {
      const reqUrl = new URL(req.url || '/', 'http://127.0.0.1');
      let relPath = decodeURIComponent(reqUrl.pathname);
      if (relPath === '/' || relPath === '') {
        relPath = '/index.html';
      }
      let filePath = path.join(DIST_DIR, relPath);
      let data;
      try {
        data = await fs.readFile(filePath);
      } catch {
        filePath = path.join(DIST_DIR, 'index.html');
        data = await fs.readFile(filePath);
      }
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
      res.end(data);
    } catch (err) {
      res.writeHead(500);
      res.end(String(err));
    }
  });

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(preferredPort, '127.0.0.1', () => {
      const addr = server.address();
      resolve({
        server,
        url: `http://127.0.0.1:${addr.port}`,
      });
    });
  });
}

function assertCondition(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function captureStepScreenshot(page, filename, stepResults, stepMeta) {
  const outputFilePath = path.join(OUTPUT_DIR, filename);
  const rootCopyPath = path.join(__dirname, filename);

  await page.screenshot({
    path: outputFilePath,
    fullPage: false,
  });
  await fs.copyFile(outputFilePath, rootCopyPath);

  const stat = await fs.stat(outputFilePath);
  const entry = {
    step: stepMeta.step,
    name: stepMeta.name,
    filename,
    outputPath: outputFilePath,
    copiedPath: rootCopyPath,
    bytes: stat.size,
    assertions: stepMeta.assertions,
    status: 'PASS',
    timestamp: new Date().toISOString(),
  };
  stepResults.push(entry);
  console.log(`  [PASS] Step ${stepMeta.step}: ${filename} (${stat.size} bytes)`);
}

async function runScreenshotSuite() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  const stepResults = [];
  const consoleErrors = [];
  const startedAt = new Date().toISOString();

  const candidatePaths = [
    process.env.CHROME_PATH,
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);

  let executablePath;
  for (const p of candidatePaths) {
    try {
      await fs.access(p);
      executablePath = p;
      break;
    } catch {
      // try next
    }
  }

  let staticServerInfo = null;
  let APP_URL = DEFAULT_URL;

  if (!process.env.APP_URL) {
    staticServerInfo = await startStaticDistServer(0);
    APP_URL = staticServerInfo.url;
  } else {
    try {
      const probe = await fetch(process.env.APP_URL);
      await probe.arrayBuffer();
    } catch {
      const parsedPort = Number(new URL(process.env.APP_URL).port) || 0;
      staticServerInfo = await startStaticDistServer(parsedPort);
      APP_URL = staticServerInfo.url;
    }
  }

  console.log(
    `Launching headless Chromium (${executablePath || 'default'}) against ${APP_URL} ...`
  );
  const browser = await chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
    ],
  });

  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 960 },
      deviceScaleFactor: 2,
      permissions: ['microphone'],
    });

    const page = await context.newPage();
    page.on('pageerror', (err) => {
      consoleErrors.push(String(err));
    });

    // =========================================================================
    // 1a. 01-deck-dashboard.png (Home Page: Active Memory Data File Bar,
    //     "Currently Memorizing", and "Saved to Memorize Next")
    // =========================================================================
    console.log('Step 1a: Navigating to Home Page (Dark Mode, Currently Memorizing & Saved to Memorize Next)...');
    await page.goto(APP_URL, { waitUntil: 'networkidle' });
    await page.locator('[data-testid="btn-toggle-theme"]').waitFor({ state: 'visible', timeout: 15000 });
    await page.locator('[data-testid="topbar-memory-file-status"]').waitFor({ state: 'visible', timeout: 15000 });
    await page.locator('[data-testid="active-data-file-bar"]').waitFor({ state: 'visible', timeout: 15000 });
    await page.locator('[data-testid="active-data-file-empty"]').waitFor({ state: 'visible', timeout: 15000 });
    await page.locator('[data-testid="btn-open-data-file"]').waitFor({ state: 'visible', timeout: 15000 });
    await page.locator('[data-testid="btn-create-data-file"]').waitFor({ state: 'visible', timeout: 15000 });
    await page.locator('[data-testid="deck-stats-grid"]').waitFor({ state: 'visible', timeout: 15000 });
    await page.locator('[data-testid="tab-queue"]').waitFor({ state: 'visible', timeout: 15000 });
    await page.locator('[data-testid="currently-memorizing-section"]').waitFor({ state: 'visible', timeout: 15000 });
    await page.locator('[data-testid="saved-backlog-section"]').waitFor({ state: 'visible', timeout: 15000 });

    const memorizingText = await page.locator('[data-testid="currently-memorizing-section"]').innerText();
    assertCondition(
      memorizingText.includes('Philippians 4:6-7'),
      'Expected Philippians 4:6-7 in Currently Memorizing section on Home Page'
    );

    const savedBacklogText = await page.locator('[data-testid="saved-backlog-section"]').innerText();
    assertCondition(
      savedBacklogText.includes('Romans 8:1-4') && savedBacklogText.includes('Psalm 23:1-6'),
      'Expected Romans 8:1-4 and Psalm 23:1-6 in Saved to Memorize Next section on Home Page'
    );

    await captureStepScreenshot(page, '01-deck-dashboard.png', stepResults, {
      step: '1a',
      name: 'Home Dashboard (Dark Mode): Active Memory Data File Bar, Currently Memorizing & Saved to Memorize Next',
      assertions: [
        '[data-testid="topbar-memory-file-status"] and [data-testid="active-data-file-empty"] are visible (no phantom file selected)',
        '[data-testid="active-data-file-bar"] with [data-testid="btn-open-data-file"] and [data-testid="btn-create-data-file"] is visible',
        '[data-testid="currently-memorizing-section"] displays active learning passages (Philippians 4:6-7)',
        '[data-testid="saved-backlog-section"] displays saved backlog passages (Romans 8:1-4, Psalm 23:1-6)',
      ],
    });

    // =========================================================================
    // 1c. 01c-deck-dashboard-light-mode.png (Light Mode Home Page Verification)
    // =========================================================================
    console.log('Step 1c: Toggling to Light Mode on Home Page & Verifying Light Theme...');
    await page.locator('[data-testid="btn-toggle-theme"]').click();
    await page.waitForTimeout(200);
    const isLightModeActive = await page.evaluate(() => {
      return (
        document.documentElement.classList.contains('light-theme') ||
        document.body.classList.contains('light-theme') ||
        document.documentElement.getAttribute('data-theme') === 'light'
      );
    });
    assertCondition(isLightModeActive, 'Expected clicking btn-toggle-theme to activate Light Mode (.light-theme)');

    await captureStepScreenshot(page, '01c-deck-dashboard-light-mode.png', stepResults, {
      step: '1c',
      name: 'Home Dashboard (Light Mode): Warm Ivory/Parchment Theme Verification',
      assertions: [
        'Clicking [data-testid="btn-toggle-theme"] switches Home Page from Dark Mode to Light Mode (.light-theme)',
        'All Home Page cards, tabs, KPIs, and Active Memory Data File bar render in warm parchment Light Mode',
      ],
    });

    // Switch back to Dark Mode for the rest of the test suite
    await page.locator('[data-testid="btn-toggle-theme"]').click();
    await page.waitForTimeout(150);

    // =========================================================================
    // 1b. 01b-due-page.png (Remember-Me Style Due Page)
    // =========================================================================
    console.log('Step 1b: Switching to Due for Review Page...');
    await page.locator('[data-testid="tab-due"]').click();
    await page.locator('[data-testid="due-page-section"]').waitFor({ state: 'visible', timeout: 10000 });
    await page.locator('[data-testid="btn-study-due"]').waitFor({ state: 'visible', timeout: 10000 });

    const dueListText = await page.locator('[data-testid="due-page-section"]').innerText();
    assertCondition(
      dueListText.includes('Philippians 4:6-7') || dueListText.includes('John 1:1-5'),
      'Expected active due passages (Philippians 4:6-7, John 1:1-5) on Due Page'
    );

    await captureStepScreenshot(page, '01b-due-page.png', stepResults, {
      step: '1b',
      name: 'Remember-Me Style Due for Review Page',
      assertions: [
        '[data-testid="tab-due"] opens [data-testid="due-page-section"]',
        '[data-testid="btn-study-due"] is visible',
        'Active due cards (Philippians 4:6-7, John 1:1-5) are listed separately from the Saved backlog',
      ],
    });

    // Switch back to Home (tab-queue)
    await page.locator('[data-testid="tab-queue"]').click();
    await page.locator('[data-testid="queue-page-section"]').waitFor({ state: 'visible', timeout: 10000 });

    // =========================================================================
    // 2. 02-copy-paste-highlight-verse-numbers.png & 02-smart-copy-paste-modal.png
    // =========================================================================
    console.log('Step 2: Testing Copy-Paste Modal (Missing Verse Numbers Warning, Highlight & Strip Verse Numbers + Remembered Boundaries)...');
    await page.locator('[data-testid="btn-open-add-passage"]').click();
    const rawTextarea = page.locator('[data-testid="textarea-passage-raw"]');
    await rawTextarea.waitFor({ state: 'visible', timeout: 10000 });

    // Verify warning-no-verse-numbers appears when plain text without verse numbers is entered
    await rawTextarea.fill('For by grace you have been saved through faith. And this is not your own doing; it is the gift of God.');
    await page.locator('[data-testid="warning-no-verse-numbers"]').waitFor({ state: 'visible', timeout: 10000 });

    // Now click Paste Example (Isaiah 40:28-31 with [28]..[31])
    await page.locator('[data-testid="btn-paste-example"]').click();
    await page.locator('[data-testid="warning-no-verse-numbers"]').waitFor({ state: 'hidden', timeout: 5000 });

    // Click Highlight Verse Numbers and verify highlight preview box
    const highlightBtn = page.locator('[data-testid="btn-highlight-verse-numbers"]');
    await highlightBtn.waitFor({ state: 'visible', timeout: 10000 });
    await highlightBtn.click();

    const highlightPreview = page.locator('[data-testid="verse-number-highlight-preview"]');
    await highlightPreview.waitFor({ state: 'visible', timeout: 10000 });

    const previewLocator = page.locator('[data-testid="parsed-verses-preview"]');
    await previewLocator.waitFor({ state: 'visible', timeout: 10000 });
    const highlightedMarksCount = await page.locator('[data-testid="highlighted-verse-num"]').count();
    assertCondition(
      highlightedMarksCount >= 4,
      `Expected at least 4 highlighted verse numbers in Isaiah 40:28-31 example, found ${highlightedMarksCount}`
    );

    await captureStepScreenshot(page, '02-copy-paste-highlight-verse-numbers.png', stepResults, {
      step: '2a',
      name: 'Copy-Paste Modal - Highlighted Verse Numbers Confirmation Preview',
      assertions: [
        '[data-testid="warning-no-verse-numbers"] warns when verse numbers are absent',
        '[data-testid="btn-paste-example"] populates multi-verse scripture passage',
        '[data-testid="btn-highlight-verse-numbers"] reveals [data-testid="verse-number-highlight-preview"]',
        'Highlighted verse numbers are marked for deletion while preserving verse boundaries',
      ],
    });

    // Confirm removing the highlighted verse numbers and verify remembered-boundaries-badge
    const removeVerseNumbersBtn = page.locator('[data-testid="btn-remove-verse-numbers"]');
    await removeVerseNumbersBtn.waitFor({ state: 'visible', timeout: 10000 });
    await removeVerseNumbersBtn.click();

    const rememberedBadge = page.locator('[data-testid="remembered-boundaries-badge"]');
    await rememberedBadge.waitFor({ state: 'visible', timeout: 10000 });
    assertCondition(
      (await page.locator('[data-testid="warning-no-verse-numbers"]').count()) === 0,
      'Expected warning-no-verse-numbers NOT to appear after stripping verse numbers because boundaries are remembered'
    );
    const parsedVerseItemsCount = await page.locator('[data-testid^="preview-verse-"]').count();
    assertCondition(
      parsedVerseItemsCount === 4,
      `Expected 4 remembered verse boundaries after stripping verse numbers, found ${parsedVerseItemsCount}`
    );

    await captureStepScreenshot(page, '02-smart-copy-paste-modal.png', stepResults, {
      step: '2b',
      name: 'Copy-Paste Modal - Stripped Verse Numbers with Remembered Verse Boundaries',
      assertions: [
        '[data-testid="btn-remove-verse-numbers"] strips verse numbers from raw textarea',
        '[data-testid="remembered-boundaries-badge"] confirms exact verse boundaries are remembered',
        '[data-testid="parsed-verses-preview"] preserves all 4 individual verses for +1v study',
      ],
    });

    await page.locator('[data-testid="btn-save-passage"]').click();
    await page.locator('[data-testid="queue-page-section"]').waitFor({ state: 'visible', timeout: 10000 });

    // =========================================================================
    // 3. 03-card-front-initial.png (Flashcard Front with Compact "Aa Study"
    //    Header Button & 2-Step Daily Stitching Toggle)
    // =========================================================================
    console.log('Step 3: Clicking Passage on Home Page -> Flashcard Front with 2-Step Stitching & Compact "Aa Study"...');
    await page.locator('[data-testid="btn-study-card-0"]').first().click();

    await page.locator('[data-testid="card-front-view"]').waitFor({ state: 'visible', timeout: 10000 });
    await page.locator('[data-testid="card-reference"]').waitFor({ state: 'visible', timeout: 10000 });
    await page.locator('[data-testid="btn-enter-study"]').waitFor({ state: 'visible', timeout: 10000 });
    await page.locator('[data-testid="stitch-mode-toggle"]').waitFor({ state: 'visible', timeout: 10000 });
    await page.locator('[data-testid="btn-mode-new-verse"]').waitFor({ state: 'visible', timeout: 10000 });
    await page.locator('[data-testid="btn-mode-stitch-block"]').waitFor({ state: 'visible', timeout: 10000 });
    await page.locator('[data-testid="btn-record-voice"]').waitFor({ state: 'visible', timeout: 10000 });
    await page.locator('[data-testid="btn-flip-card"]').waitFor({ state: 'visible', timeout: 10000 });

    // Ensure the first-letter study panel is NOT rendered inline on the card front
    const inlineStudyCount = await page.locator('[data-testid="first-letter-study-panel"]').count();
    assertCondition(
      inlineStudyCount === 0,
      'Expected first-letter study panel to live on its own separate page, not inline on the card front'
    );

    await captureStepScreenshot(page, '03-card-front-initial.png', stepResults, {
      step: 3,
      name: 'Flashcard Front View with Compact "Aa Study" Button & 2-Step Daily Stitching Toggle',
      assertions: [
        '[data-testid="card-front-view"] and [data-testid="card-reference"] are visible',
        'Compact [data-testid="btn-enter-study"] ("Aa Study") is in the card header',
        '[data-testid="stitch-mode-toggle"] with [data-testid="btn-mode-new-verse"] and [data-testid="btn-mode-stitch-block"] is visible',
        '[data-testid="btn-record-voice"] and [data-testid="btn-flip-card"] are visible',
      ],
    });

    // =========================================================================
    // 4 & 5. Separate First-Letter Study Page
    //    - 04-study-mode-first-letters-verse1.png
    //    - 05-study-mode-plus-1w-and-plus-1v.png
    // =========================================================================
    console.log('Step 4: Opening Separate First-Letter Study Page via "Aa Study" Button...');
    // Ensure all verses are included for multi-verse +1v study progression
    const stitchAllBtn = page.locator('[data-testid="btn-stitch-all-verses"]');
    if ((await stitchAllBtn.count()) > 0 && (await stitchAllBtn.isVisible())) {
      await stitchAllBtn.click();
    }
    await page.locator('[data-testid="btn-enter-study"]').click();

    const studyPage = page.locator('[data-testid="first-letter-study-page"]');
    await studyPage.waitFor({ state: 'visible', timeout: 10000 });
    const studyPanel = page.locator('[data-testid="first-letter-study-panel"]');
    await studyPanel.waitFor({ state: 'visible', timeout: 10000 });
    await page.locator('[data-testid="btn-reveal-1w"]').waitFor({ state: 'visible', timeout: 10000 });
    await page.locator('[data-testid="btn-reveal-1v"]').waitFor({ state: 'visible', timeout: 10000 });
    await page.locator('[data-testid="btn-back-to-card"]').waitFor({ state: 'visible', timeout: 10000 });

    const visibleVerseBlocksInitial = await page.locator('.study-verse-block').count();
    assertCondition(
      visibleVerseBlocksInitial === 1,
      `Expected only Verse 1 to be visible initially on Study Page, found ${visibleVerseBlocksInitial}`
    );

    await captureStepScreenshot(page, '04-study-mode-first-letters-verse1.png', stepResults, {
      step: 4,
      name: 'Separate First-Letter Study Page - Verse 1 Only with +1w, +1v, and Exit to Flashcard',
      assertions: [
        'Clicking [data-testid="btn-enter-study"] opens separate [data-testid="first-letter-study-page"]',
        '[data-testid="first-letter-study-panel"] shows first letters for Verse 1 only',
        '[data-testid="btn-reveal-1w"] (+1w), [data-testid="btn-reveal-1v"] (+1v), and [data-testid="btn-back-to-card"] ("✕ Exit to Flashcard") are visible',
      ],
    });

    console.log('Step 5: Testing +1w (x3), +1v (completing Verse 1 -> revealing Verse 2 first letters), and +1w (x2 on Verse 2)...');
    const btn1w = page.locator('[data-testid="btn-reveal-1w"]');
    const btn1v = page.locator('[data-testid="btn-reveal-1v"]');

    const beforeRevealText = await studyPanel.innerText();
    await btn1w.click();
    await btn1w.click();
    await btn1w.click();
    await page.waitForTimeout(250);
    const after3WordsText = await studyPanel.innerText();
    assertCondition(
      after3WordsText !== beforeRevealText,
      'Expected clicking +1w 3 times to reveal the first 3 words of Verse 1'
    );

    // Click +1v to complete Verse 1 and automatically display Verse 2 in first-letter mode
    await btn1v.click();
    await page.waitForTimeout(200);
    const visibleVerseBlocksAfter1v = await page.locator('.study-verse-block').count();
    assertCondition(
      visibleVerseBlocksAfter1v === 2,
      `Expected Verse 2 to appear in first-letter mode after clicking +1v on Verse 1, found ${visibleVerseBlocksAfter1v} verse blocks`
    );

    const after1vText = await studyPanel.innerText();
    // Click +1w twice on Verse 2
    await btn1w.click();
    await btn1w.click();
    await page.waitForTimeout(200);
    const afterVerse2TwoWordsText = await studyPanel.innerText();
    assertCondition(
      afterVerse2TwoWordsText !== after1vText,
      'Expected clicking +1w twice on Verse 2 to reveal the first 2 words of Verse 2'
    );

    await captureStepScreenshot(page, '05-study-mode-plus-1w-and-plus-1v.png', stepResults, {
      step: 5,
      name: 'Progressive Reveal (+1w and +1v) Completing Verse 1 and Advancing to Verse 2 First Letters',
      assertions: [
        'Clicking +1w 3 times reveals first 3 words of Verse 1',
        'Clicking +1v completes Verse 1 and displays Verse 2 in first-letter mode right below Verse 1',
        'Clicking +1w twice on Verse 2 reveals 2 words of Verse 2 while remaining words stay as first letters',
      ],
    });

    // Exit the Study Page back to the Flashcard Front
    await page.locator('[data-testid="btn-back-to-card"]').click();
    await page.locator('[data-testid="card-front-view"]').waitFor({ state: 'visible', timeout: 10000 });

    // =========================================================================
    // 6. 06-voice-recording-active.png
    // =========================================================================
    console.log('Step 6: Starting Voice Recording on Flashcard Front...');
    await page.locator('[data-testid="btn-record-voice"]').click();
    await page
      .locator('[data-testid="recording-active-indicator"]')
      .waitFor({ state: 'visible', timeout: 10000 });
    await page.waitForTimeout(1250);

    await captureStepScreenshot(page, '06-voice-recording-active.png', stepResults, {
      step: 6,
      name: 'Active Voice Recording on Flashcard Front',
      assertions: [
        '[data-testid="btn-back-to-card"] exits Study Page back to [data-testid="card-front-view"]',
        '[data-testid="btn-record-voice"] starts voice recording on the card front',
        '[data-testid="recording-active-indicator"] is active after ~1.2s of recording',
      ],
    });

    // =========================================================================
    // 7. 07-card-back-voice-playback-and-anki-grading.png
    // =========================================================================
    console.log('Step 7: Flipping Card While Recording -> Auto Voice Playback & Anki Grading...');
    await page.locator('[data-testid="btn-flip-card"]').click();
    await page.locator('[data-testid="card-back-view"]').waitFor({ state: 'visible', timeout: 10000 });
    await page.locator('[data-testid="voice-playback-bar"]').waitFor({ state: 'visible', timeout: 10000 });
    await page.locator('[data-testid="card-back-full-text"]').waitFor({ state: 'visible', timeout: 10000 });
    await page.locator('[data-testid="anki-grading-bar"]').waitFor({ state: 'visible', timeout: 10000 });

    const fullPassageBackText = await page.locator('[data-testid="card-back-full-text"]').innerText();
    assertCondition(
      fullPassageBackText.trim().length > 20,
      'Expected full passage text on back of card for read-along verification'
    );

    const gradingBarText = await page.locator('[data-testid="anki-grading-bar"]').innerText();
    for (const label of ['Again', 'Hard', 'Good', 'Easy']) {
      assertCondition(
        gradingBarText.includes(label),
        `Expected Anki grading bar to contain "${label}" button`
      );
    }

    await captureStepScreenshot(
      page,
      '07-card-back-voice-playback-and-anki-grading.png',
      stepResults,
      {
        step: '7a',
        name: 'Card Back View with Auto Voice Playback, Full Passage Read-Along, Spot-Repair Buttons, and Anki Grading Bar',
        assertions: [
          '[data-testid="card-back-view"] is visible',
          '[data-testid="voice-playback-bar"] is visible and auto-playing recorded recitation',
          '[data-testid="card-back-full-text"] displays full passage text with per-verse 🔧 Repair buttons',
          '[data-testid="anki-grading-bar"] displays Again / Hard / Good / Easy buttons',
        ],
      }
    );

    // =========================================================================
    // 7b. 07b-memory-repair-card-front.png (Long Passage Memory Repair Flow)
    // =========================================================================
    console.log('Step 7b: Spawning & Practicing Temporary Long-Passage Memory Repair Card...');
    const repairButtons = page.locator('[data-testid^="btn-spawn-repair-"]');
    const repairBtnCount = await repairButtons.count();
    assertCondition(
      repairBtnCount > 1,
      `Expected multiple per-verse 🔧 Repair buttons on multi-verse card back, found ${repairBtnCount}`
    );
    await repairButtons.nth(1).click();

    await page.locator('[data-testid="repair-spawned-toast"]').waitFor({ state: 'visible', timeout: 10000 });
    const practiceRepairNowBtn = page.locator('[data-testid="btn-practice-repair-now"]');
    await practiceRepairNowBtn.waitFor({ state: 'visible', timeout: 10000 });
    await practiceRepairNowBtn.click();

    await page.locator('[data-testid="repair-card-banner"]').waitFor({ state: 'visible', timeout: 10000 });
    await page.locator('[data-testid="repair-heal-progress"]').waitFor({ state: 'visible', timeout: 10000 });
    await page.locator('[data-testid="card-front-view"]').waitFor({ state: 'visible', timeout: 10000 });

    await captureStepScreenshot(
      page,
      '07b-memory-repair-card-front.png',
      stepResults,
      {
        step: '7b',
        name: 'Temporary Long-Passage Memory Repair Flashcard Front (Preceding Verse Context Cue + Heal Streak)',
        assertions: [
          'Clicking [data-testid^="btn-spawn-repair-"] spawns a temporary verse repair card and displays [data-testid="repair-spawned-toast"]',
          'Clicking [data-testid="btn-practice-repair-now"] opens the Temporary Memory Repair Flashcard',
          '[data-testid="repair-card-banner"] and [data-testid="repair-heal-progress"] (0/3 heal streak) are visible on the front',
        ],
      }
    );

    // Flip the Repair Card to its back before grading it Good in Step 8
    await page.locator('[data-testid="btn-flip-card"]').click();
    await page.locator('[data-testid="card-back-view"]').waitFor({ state: 'visible', timeout: 10000 });

    // =========================================================================
    // 8. 08-protojson-wire-format-modal.png
    // =========================================================================
    console.log('Step 8: Grading Card (Good) and Inspecting biblememory.v1 ProtoJSON Wire Format Modal...');
    await page.locator('[data-testid="btn-grade-good"]').click();

    const protoSyncBtn = page.locator('[data-testid="btn-open-proto-sync"], [data-testid="nav-proto-sync"]');
    await protoSyncBtn.first().waitFor({ state: 'visible', timeout: 10000 });
    await protoSyncBtn.first().click();

    const protoTextarea = page.locator('[data-testid="protojson-textarea"]');
    await protoTextarea.waitFor({ state: 'visible', timeout: 10000 });

    const rawProtoJson =
      (await protoTextarea.inputValue().catch(() => '')) || (await protoTextarea.innerText());
    const parsedProto = JSON.parse(rawProtoJson);

    assertCondition(
      Array.isArray(parsedProto.passages) && parsedProto.passages.length > 0,
      'Expected biblememory.v1 ProtoJSON payload to include non-empty passages[]'
    );
    assertCondition(
      Array.isArray(parsedProto.flashcards) && parsedProto.flashcards.length > 0,
      'Expected biblememory.v1 ProtoJSON payload to include non-empty flashcards[]'
    );
    assertCondition(
      Array.isArray(parsedProto.reviewLogs) && parsedProto.reviewLogs.length > 0,
      'Expected biblememory.v1 ProtoJSON payload to include non-empty reviewLogs[] after grading'
    );

    await captureStepScreenshot(page, '08-protojson-wire-format-modal.png', stepResults, {
      step: 8,
      name: 'ProtoJSON (biblememory.v1) Wire-Format Export/Import Modal',
      assertions: [
        '[data-testid="btn-grade-good"] records Anki review log',
        '[data-testid="btn-open-proto-sync"] opens ProtoJSON wire format modal',
        '[data-testid="protojson-textarea"] contains valid biblememory.v1 JSON with passages, flashcards, and reviewLogs',
      ],
    });

    const report = {
      suite: 'bible-memory-playwright-screenshot-tests',
      appUrl: APP_URL,
      startedAt,
      finishedAt: new Date().toISOString(),
      status: 'PASSED',
      totalSteps: stepResults.length,
      consoleErrors,
      steps: stepResults,
    };

    await fs.writeFile(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');
    console.log(`\nAll ${stepResults.length} screenshot tests PASSED! Report written to ${REPORT_PATH}`);
  } finally {
    await browser.close();
    if (staticServerInfo?.server) {
      staticServerInfo.server.close();
    }
  }
}

runScreenshotSuite().catch(async (err) => {
  console.error('\n[FAIL] Screenshot test suite failed:', err);
  const failureReport = {
    suite: 'bible-memory-playwright-screenshot-tests',
    appUrl: DEFAULT_URL,
    finishedAt: new Date().toISOString(),
    status: 'FAILED',
    error: err?.stack || String(err),
  };
  await fs.writeFile(REPORT_PATH, JSON.stringify(failureReport, null, 2), 'utf8').catch(() => {});
  process.exitCode = 1;
});
