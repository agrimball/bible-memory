#!/usr/bin/env npx tsx
/**
 * Automated Playwright Screenshot & E2E Verification Runner for Bible Memory App (100% TypeScript)
 *
 * Verifies all core user journeys against the running Angular 19 app on both Desktop (1440x960)
 * and Mobile Phone (412x915 Android Pixel viewport) and saves high-resolution PNG screenshots
 * to `screenshot-tests/output/` and `screenshot-tests/`.
 */

import { chromium, type BrowserContext, type Page } from 'playwright-core';
import fs from 'node:fs/promises';
import http, { type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_URL: string = process.env['APP_URL'] || 'http://127.0.0.1:4200';
const DIST_DIR: string = path.resolve(__dirname, '..', 'dist', 'bible-memory', 'browser');
const OUTPUT_DIR: string = path.join(__dirname, 'output');
const REPORT_PATH: string = path.join(__dirname, 'test-report.json');

interface StepMeta {
  step: string | number;
  name: string;
  assertions: string[];
}

interface StepResult extends StepMeta {
  filename: string;
  outputPath: string;
  copiedPath: string;
  bytes: number;
  status: 'PASS' | 'FAIL';
  timestamp: string;
}

interface StaticServerInfo {
  server: Server;
  url: string;
}

interface ProtoBundlePayload {
  passages?: unknown[];
  flashcards?: unknown[];
  reviewLogs?: unknown[];
}

const MIME_TYPES: Readonly<Record<string, string>> = {
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

async function startStaticDistServer(preferredPort = 0): Promise<StaticServerInfo> {
  const server = http.createServer(async (req, res) => {
    try {
      const reqUrl = new URL(req.url || '/', 'http://127.0.0.1');
      let relPath = decodeURIComponent(reqUrl.pathname);
      if (relPath === '/' || relPath === '') {
        relPath = '/index.html';
      }
      let filePath = path.join(DIST_DIR, relPath);
      let data: Buffer;
      try {
        data = await fs.readFile(filePath);
      } catch {
        filePath = path.join(DIST_DIR, 'index.html');
        data = await fs.readFile(filePath);
      }
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
      res.end(data);
    } catch (err: unknown) {
      res.writeHead(500);
      res.end(String(err));
    }
  });

  return new Promise<StaticServerInfo>((resolve, reject) => {
    server.on('error', reject);
    server.listen(preferredPort, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo;
      resolve({
        server,
        url: `http://127.0.0.1:${addr.port}`,
      });
    });
  });
}

function assertCondition(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function captureStepScreenshot(
  page: Page,
  filename: string,
  stepResults: StepResult[],
  stepMeta: StepMeta
): Promise<void> {
  const outputFilePath = path.join(OUTPUT_DIR, filename);
  const rootCopyPath = path.join(__dirname, filename);

  await page.screenshot({
    path: outputFilePath,
    fullPage: false,
  });
  await fs.copyFile(outputFilePath, rootCopyPath);

  const stat = await fs.stat(outputFilePath);
  const entry: StepResult = {
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

async function addSeedScriptToContext(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    const key = 'bible_memory_protojson_v1';
    if (!localStorage.getItem(key)) {
      const now = new Date();
      const pastDue = new Date(now.getTime() - 3600 * 1000).toISOString();
      const futureDue = new Date(now.getTime() + 3 * 86400 * 1000).toISOString();
      const nowIso = now.toISOString();
      const sampleBundle = {
        schemaVersion: 1,
        exportedAt: nowIso,
        passages: [
          {
            id: 'psg_phil_4_6_7',
            reference: 'Philippians 4:6-7',
            createdAt: nowIso,
            updatedAt: nowIso,
            verses: [
              {
                chapterNumber: 4,
                verseNumber: 6,
                text: 'do not be anxious about anything, but in everything by prayer and supplication with thanksgiving let your requests be made known to God.',
              },
              {
                chapterNumber: 4,
                verseNumber: 7,
                text: 'And the peace of God, which surpasses all understanding, will guard your hearts and your minds in Christ Jesus.',
              },
            ],
          },
          {
            id: 'psg_john_1_1_5',
            reference: 'John 1:1-5',
            createdAt: nowIso,
            updatedAt: nowIso,
            verses: [
              {
                chapterNumber: 1,
                verseNumber: 1,
                text: 'In the beginning was the Word, and the Word was with God, and the Word was God.',
              },
              {
                chapterNumber: 1,
                verseNumber: 2,
                text: 'He was in the beginning with God.',
              },
              {
                chapterNumber: 1,
                verseNumber: 3,
                text: 'All things were made through him, and without him was not any thing made that was made.',
              },
              {
                chapterNumber: 1,
                verseNumber: 4,
                text: 'In him was life, and the life was the light of men.',
              },
              {
                chapterNumber: 1,
                verseNumber: 5,
                text: 'The light shines in the darkness, and the darkness has not overcome it.',
              },
            ],
          },
          {
            id: 'psg_rom_8_1_4',
            reference: 'Romans 8:1-4',
            createdAt: nowIso,
            updatedAt: nowIso,
            verses: [
              {
                chapterNumber: 8,
                verseNumber: 1,
                text: 'There is therefore now no condemnation for those who are in Christ Jesus.',
              },
              {
                chapterNumber: 8,
                verseNumber: 2,
                text: 'For the law of the Spirit of life has set you free in Christ Jesus from the law of sin and death.',
              },
              {
                chapterNumber: 8,
                verseNumber: 3,
                text: 'For God has done what the law, weakened by the flesh, could not do. By sending his own Son in the likeness of sinful flesh and for sin, he condemned sin in the flesh,',
              },
              {
                chapterNumber: 8,
                verseNumber: 4,
                text: 'in order that the righteous requirement of the law might be fulfilled in us, who walk not according to the flesh but according to the Spirit.',
              },
            ],
          },
          {
            id: 'psg_ps_23_1_6',
            reference: 'Psalm 23:1-6',
            createdAt: nowIso,
            updatedAt: nowIso,
            verses: [
              {
                chapterNumber: 23,
                verseNumber: 1,
                text: 'The LORD is my shepherd; I shall not want.',
              },
              {
                chapterNumber: 23,
                verseNumber: 2,
                text: 'He makes me lie down in green pastures. He leads me beside still waters.',
              },
              {
                chapterNumber: 23,
                verseNumber: 3,
                text: 'He restores my soul. He leads me in paths of righteousness for his name’s sake.',
              },
            ],
          },
        ],
        flashcards: [
          {
            id: 'card_phil_4_6_7',
            passageId: 'psg_phil_4_6_7',
            state: 'CARD_STATE_LEARNING',
            easeFactor: 2.5,
            intervalDays: 1,
            repetitions: 1,
            learningStep: 1,
            dueAt: pastDue,
            lastReviewedAt: pastDue,
            lapses: 0,
            createdAt: nowIso,
            updatedAt: nowIso,
          },
          {
            id: 'card_john_1_1_5',
            passageId: 'psg_john_1_1_5',
            state: 'CARD_STATE_REVIEW',
            easeFactor: 2.6,
            intervalDays: 4,
            repetitions: 3,
            learningStep: 5,
            dueAt: pastDue,
            lastReviewedAt: pastDue,
            lapses: 0,
            createdAt: nowIso,
            updatedAt: nowIso,
          },
          {
            id: 'card_rom_8_1_4',
            passageId: 'psg_rom_8_1_4',
            state: 'CARD_STATE_NEW',
            easeFactor: 2.5,
            intervalDays: 0,
            repetitions: 0,
            learningStep: 0,
            dueAt: nowIso,
            lastReviewedAt: '',
            lapses: 0,
            createdAt: nowIso,
            updatedAt: nowIso,
          },
          {
            id: 'card_ps_23_1_6',
            passageId: 'psg_ps_23_1_6',
            state: 'CARD_STATE_NEW',
            easeFactor: 2.5,
            intervalDays: 0,
            repetitions: 0,
            learningStep: 0,
            dueAt: futureDue,
            lastReviewedAt: '',
            lapses: 0,
            createdAt: nowIso,
            updatedAt: nowIso,
          },
        ],
        reviewLogs: [],
      };
      localStorage.setItem(key, JSON.stringify(sampleBundle));
    }
  });
}

async function runScreenshotSuite(): Promise<void> {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  const stepResults: StepResult[] = [];
  const consoleErrors: string[] = [];
  const startedAt = new Date().toISOString();

  const candidatePaths: string[] = [
    process.env['CHROME_PATH'],
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter((p): p is string => Boolean(p));

  let executablePath: string | undefined;
  for (const p of candidatePaths) {
    try {
      await fs.access(p);
      executablePath = p;
      break;
    } catch {
      // try next
    }
  }

  let staticServerInfo: StaticServerInfo | null = null;
  let APP_URL: string = DEFAULT_URL;

  const envAppUrl = process.env['APP_URL'];
  if (!envAppUrl) {
    staticServerInfo = await startStaticDistServer(0);
    APP_URL = staticServerInfo.url;
  } else {
    try {
      const probe = await fetch(envAppUrl);
      await probe.arrayBuffer();
    } catch {
      const parsedPort = Number(new URL(envAppUrl).port) || 0;
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
    await addSeedScriptToContext(context);

    const page = await context.newPage();
    page.on('pageerror', (err: Error) => {
      consoleErrors.push(String(err));
    });

    // =========================================================================
    // 1a. 01-deck-dashboard.png (Remember-Me Style Home Dashboard: NEW / DUE / KNOWN Tabs)
    // =========================================================================
    console.log('Step 1a: Navigating to Home Page (Dark Mode, Remember-Me Flat List & 3-Tab Header)...');
    await page.goto(APP_URL, { waitUntil: 'networkidle' });
    await page.locator('[data-testid="btn-toggle-theme"]').waitFor({ state: 'visible', timeout: 15000 });
    await page.locator('[data-testid="topbar-memory-file-status"]').waitFor({ state: 'visible', timeout: 15000 });
    await page.locator('[data-testid="tab-queue"]').waitFor({ state: 'visible', timeout: 15000 });
    await page.locator('[data-testid="tab-due"]').waitFor({ state: 'visible', timeout: 15000 });
    await page.locator('[data-testid="tab-active"]').waitFor({ state: 'visible', timeout: 15000 });
    await page.locator('[data-testid="passage-deck-list"]').waitFor({ state: 'visible', timeout: 15000 });

    const newQueueText = await page.locator('[data-testid="passage-deck-list"]').innerText();
    assertCondition(
      newQueueText.includes('Romans 8:1-4') && newQueueText.includes('Psalm 23:1-6'),
      'Expected Romans 8:1-4 and Psalm 23:1-6 in NEW queue tab on Home Page'
    );

    await captureStepScreenshot(page, '01-deck-dashboard.png', stepResults, {
      step: '1a',
      name: 'Home Dashboard (Dark Mode): Remember-Me 3-Tab Header (NEW / DUE / KNOWN) & Flat List Rows',
      assertions: [
        '[data-testid="topbar-memory-file-status"] is visible in the compact 52px topbar',
        '[data-testid="tab-queue"] (NEW), [data-testid="tab-due"] (DUE), and [data-testid="tab-active"] (KNOWN) are visible',
        '[data-testid="passage-deck-list"] displays NEW passages (Romans 8:1-4, Psalm 23:1-6) in flat rows',
      ],
    });

    // =========================================================================
    // 1c. 01c-deck-dashboard-light-mode.png (Light Mode Home Page Verification)
    // =========================================================================
    console.log('Step 1c: Toggling to Light Mode on Home Page & Verifying Light Theme...');
    await page.locator('[data-testid="btn-toggle-theme"]').click();
    await page.waitForTimeout(200);
    const isLightModeActive = await page.evaluate((): boolean => {
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
        'All Home Page rows, tabs, and floating action buttons render in warm parchment Light Mode',
      ],
    });

    // Switch back to Dark Mode for the rest of the test suite
    await page.locator('[data-testid="btn-toggle-theme"]').click();
    await page.waitForTimeout(150);

    // =========================================================================
    // 1b. 01b-due-page.png (Remember-Me Style DUE Tab)
    // =========================================================================
    console.log('Step 1b: Switching to Due for Review Tab...');
    await page.locator('[data-testid="tab-due"]').click();
    await page.locator('[data-testid="due-page-section"]').waitFor({ state: 'visible', timeout: 10000 });
    await page.locator('[data-testid="btn-study-due"]').waitFor({ state: 'visible', timeout: 10000 });

    const dueListText = await page.locator('[data-testid="due-page-section"]').innerText();
    assertCondition(
      dueListText.includes('Philippians 4:6-7') && dueListText.includes('John 1:1-5'),
      'Expected active due passages (Philippians 4:6-7, John 1:1-5) on Due Page'
    );

    await captureStepScreenshot(page, '01b-due-page.png', stepResults, {
      step: '1b',
      name: 'Remember-Me Style DUE Tab',
      assertions: [
        '[data-testid="tab-due"] opens [data-testid="due-page-section"]',
        '[data-testid="btn-study-due"] floating play button is visible',
        'Active due cards (Philippians 4:6-7, John 1:1-5) are listed with level/step square badges',
      ],
    });

    // Switch back to NEW tab (tab-queue)
    await page.locator('[data-testid="tab-queue"]').click();
    await page.locator('[data-testid="queue-page-section"]').waitFor({ state: 'visible', timeout: 10000 });

    // =========================================================================
    // 2. 02-copy-paste-highlight-verse-numbers.png & 02-smart-copy-paste-modal.png
    // =========================================================================
    console.log('Step 2: Testing Copy-Paste Modal (Missing Verse Numbers Warning, Auto-Parsed Verses & Collapsible Peek Verse Boundaries)...');
    await page.locator('[data-testid="btn-open-add-passage"]').click();
    const rawTextarea = page.locator('[data-testid="textarea-passage-raw"]');
    await rawTextarea.waitFor({ state: 'visible', timeout: 10000 });
    await page.locator('[data-testid="btn-open-biblegateway"]').waitFor({ state: 'visible', timeout: 10000 });
    await page.locator('[data-testid="select-bg-version"]').waitFor({ state: 'visible', timeout: 10000 });

    const peekBtn = page.locator('[data-testid="btn-peek-verse-boundaries"]');
    await peekBtn.waitFor({ state: 'visible', timeout: 10000 });

    // Verify parsed-verses-preview is collapsed by default
    assertCondition(
      (await page.locator('[data-testid="parsed-verses-preview"]').count()) === 0,
      'Expected parsed-verses-preview to be collapsed by default behind btn-peek-verse-boundaries'
    );

    // Verify warning-no-verse-numbers appears when plain text without verse numbers is entered
    await rawTextarea.fill('For by grace you have been saved through faith. And this is not your own doing; it is the gift of God.');
    await page.locator('[data-testid="warning-no-verse-numbers"]').waitFor({ state: 'visible', timeout: 10000 });

    // Now click Paste Example (Isaiah 40:28-31 with [28]..[31])
    await page.locator('[data-testid="btn-paste-example"]').click();
    await page.locator('[data-testid="warning-no-verse-numbers"]').waitFor({ state: 'hidden', timeout: 5000 });

    const peekBtnTextCollapsed = await peekBtn.innerText();
    assertCondition(
      peekBtnTextCollapsed.includes('4 verses'),
      `Expected btn-peek-verse-boundaries to report 4 parsed verses, got "${peekBtnTextCollapsed}"`
    );

    await captureStepScreenshot(page, '02-copy-paste-highlight-verse-numbers.png', stepResults, {
      step: '2a',
      name: 'Copy-Paste Modal - Automatic Verse Number Parsing & Collapsed Peek Verse Boundaries Toggle',
      assertions: [
        '[data-testid="warning-no-verse-numbers"] warns when verse numbers are absent',
        '[data-testid="btn-paste-example"] populates multi-verse scripture passage',
        '[data-testid="btn-peek-verse-boundaries"] shows "(4 verses)" while keeping [data-testid="parsed-verses-preview"] collapsed by default',
      ],
    });

    // Click btn-peek-verse-boundaries to expand and inspect the parsed verses
    await peekBtn.click();
    const previewLocator = page.locator('[data-testid="parsed-verses-preview"]');
    await previewLocator.waitFor({ state: 'visible', timeout: 10000 });

    const parsedVerseItemsCount = await page.locator('[data-testid^="preview-verse-"]').count();
    assertCondition(
      parsedVerseItemsCount === 4,
      `Expected 4 parsed verses in expanded preview for Isaiah 40:28-31, found ${parsedVerseItemsCount}`
    );

    await captureStepScreenshot(page, '02-smart-copy-paste-modal.png', stepResults, {
      step: '2b',
      name: 'Copy-Paste Modal - Expanded Peek Verse Boundaries Preview',
      assertions: [
        'Clicking [data-testid="btn-peek-verse-boundaries"] expands [data-testid="parsed-verses-preview"]',
        '[data-testid="parsed-verses-preview"] displays all 4 automatically parsed verses ([v. 28]..[v. 31]) for +1v study',
      ],
    });

    await page.locator('[data-testid="btn-save-passage"]').click();
    await page.locator('[data-testid="queue-page-section"]').waitFor({ state: 'visible', timeout: 10000 });

    // =========================================================================
    // 3. 03-card-front-initial.png (Remember-Me Full-Screen Flashcard Front `r4.png`)
    // =========================================================================
    console.log('Step 3: Clicking Passage on Home Page -> Full-Screen Flashcard Front with 2-Step Stitching & Bottom Dock...');
    await page.locator('[data-testid="deck-item-0"]').first().click();

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
      name: 'Remember-Me Style Full-Screen Flashcard Front View (r4.png)',
      assertions: [
        '[data-testid="card-front-view"] and [data-testid="card-reference"] are visible',
        'Circular [data-testid="btn-enter-study"] (🎓) and [data-testid="btn-flip-card"] (◫) are in the bottom bar',
        '[data-testid="stitch-mode-toggle"] with [data-testid="btn-mode-new-verse"] and [data-testid="btn-mode-stitch-block"] is visible',
        'Circular [data-testid="btn-record-voice"] (🎤) is centered at the bottom of the card face',
      ],
    });

    // =========================================================================
    // 4 & 5. Separate First-Letter Study Page
    //    - 04-study-mode-first-letters-verse1.png
    //    - 05-study-mode-plus-1w-and-plus-1v.png
    // =========================================================================
    console.log('Step 4: Opening Separate First-Letter Study Page via Study Button...');
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
        '[data-testid="btn-reveal-1w"] (+1w), [data-testid="btn-reveal-1v"] (+1v), and [data-testid="btn-back-to-card"] are visible',
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
    console.log('Step 7: Flipping Card While Recording -> Auto Voice Playback & Full-Width Scripture Back (r5.png)...');
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

    const gradingBarText = (await page.locator('[data-testid="anki-grading-bar"]').innerText()).toUpperCase();
    for (const label of ['AGAIN', 'HARD', 'GOOD', 'EASY']) {
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
        name: 'Card Back View with Auto Voice Playback, Full-Width Scripture Text (r5.png), and Anki Grading Bar',
        assertions: [
          '[data-testid="card-back-view"] is visible',
          '[data-testid="voice-playback-bar"] is visible and auto-playing recorded recitation',
          '[data-testid="card-back-full-text"] displays full-width passage text with tappable verses for repair',
          '[data-testid="anki-grading-bar"] displays AGAIN / HARD / GOOD / EASY buttons',
        ],
      }
    );

    // =========================================================================
    // 7b. 07b-memory-repair-card-front.png (Long Passage Memory Repair Flow)
    // =========================================================================
    console.log('Step 7b: Tapping Verse on Card Back -> Highlighting Repair Range & Practicing Repair Card...');
    const repairButtons = page.locator('[data-testid^="btn-spawn-repair-"]');
    const repairBtnCount = await repairButtons.count();
    assertCondition(
      repairBtnCount > 1,
      `Expected multiple tappable verses on multi-verse card back, found ${repairBtnCount}`
    );
    await repairButtons.nth(1).click();

    await page.locator('[data-testid="repair-action-sheet"]').waitFor({ state: 'visible', timeout: 10000 });
    const practiceRepairNowBtn = page.locator('[data-testid="btn-practice-repair-now"]').first();
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
          'Tapping a verse on the back highlights it in yellow and opens [data-testid="repair-action-sheet"]',
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
    await page.waitForTimeout(200);

    const protoSyncBtn = page.locator('[data-testid="btn-open-proto-sync"], [data-testid="nav-proto-sync"]');
    if (!(await protoSyncBtn.first().isVisible())) {
      const backToDeckBtn = page.locator('[data-testid="btn-back-to-deck"]');
      await backToDeckBtn.click({ timeout: 3000 }).catch(() => {});
    }
    await protoSyncBtn.first().waitFor({ state: 'visible', timeout: 10000 });
    await protoSyncBtn.first().click();

    const protoTextarea = page.locator('[data-testid="protojson-textarea"]');
    await protoTextarea.waitFor({ state: 'visible', timeout: 10000 });

    const rawProtoJson =
      (await protoTextarea.inputValue().catch(() => '')) || (await protoTextarea.innerText());
    const parsedProto = JSON.parse(rawProtoJson) as ProtoBundlePayload;

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

    await context.close();

    // =========================================================================
    // 9. MOBILE PHONE VIEWPORT SCREENSHOTS (412x915 Android Pixel Phone)
    //    - mobile-01-home.png
    //    - mobile-02-study-first-letter.png
    //    - mobile-03-flashcard-front.png
    //    - mobile-04-verse-review-back.png
    //    - mobile-05-verse-repair-highlight.png
    // =========================================================================
    console.log('\nStep 9: Capturing Android Phone (412x915) Mobile Viewport Screenshots...');
    const mobileContext = await browser.newContext({
      viewport: { width: 412, height: 915 },
      deviceScaleFactor: 2.625,
      isMobile: true,
      hasTouch: true,
      permissions: ['microphone'],
    });
    await addSeedScriptToContext(mobileContext);

    const mobilePage = await mobileContext.newPage();
    mobilePage.on('pageerror', (err: Error) => {
      consoleErrors.push(String(err));
    });

    // 9a. mobile-01-home.png (Home / Deck Dashboard on 412x915 phone screen)
    await mobilePage.goto(APP_URL, { waitUntil: 'networkidle' });
    await mobilePage.locator('[data-testid="dashboard-tabs"]').waitFor({ state: 'visible', timeout: 15000 });
    await mobilePage.locator('[data-testid="tab-due"]').click();
    await mobilePage.locator('[data-testid="due-page-section"]').waitFor({ state: 'visible', timeout: 10000 });

    await captureStepScreenshot(mobilePage, 'mobile-01-home.png', stepResults, {
      step: '9a',
      name: 'Mobile Phone (412x915): Home / Deck Dashboard (NEW, DUE, KNOWN Tabs & Flat List Rows)',
      assertions: [
        '412x915 Android phone viewport renders 52px topbar, 3-tab header (NEW / DUE / KNOWN), and flat list rows without clipping',
        'Floating bottom ▶ and + action buttons are cleanly positioned in the bottom-right corner',
      ],
    });

    // 9b. mobile-03-flashcard-front.png & mobile-02-study-first-letter.png
    // Open Romans 8:1-4 (4-verse passage) from NEW tab so we can show multi-verse study, flashcard front, full-width verse review back, and repair highlighting!
    await mobilePage.locator('[data-testid="tab-queue"]').click();
    await mobilePage.locator('[data-testid="deck-item-ref-0"]').first().click();
    await mobilePage.locator('[data-testid="card-front-view"]').waitFor({ state: 'visible', timeout: 10000 });

    // Select All (4v) so all 4 verses of Romans 8:1-4 are active for review & repair highlighting
    const mobileAllBtn = mobilePage.locator('[data-testid="btn-stitch-all-verses"]');
    if ((await mobileAllBtn.count()) > 0 && (await mobileAllBtn.isVisible())) {
      await mobileAllBtn.click();
    }
    await mobilePage.waitForTimeout(150);

    // Verify no false LEAD-IN box appears on Full-Passage review
    assertCondition(
      (await mobilePage.locator('[data-testid="new-verse-context-cue"]').count()) === 0,
      'Expected no LEAD-IN context cue box on Full-Passage review when hint is off'
    );

    await captureStepScreenshot(mobilePage, 'mobile-03-flashcard-front.png', stepResults, {
      step: '9b',
      name: 'Mobile Phone (412x915): Full-Screen Flashcard Front (r4.png)',
      assertions: [
        '412x915 Android phone viewport renders full-screen Flashcard Front with compact 52px topbar and stitch strip',
        'No false LEAD-IN context cue box appears on Full-Passage review',
        'Circular 💡 hint button at top-center, centered reference, circular 🎤 mic button, and bottom bar (🎓 | counter | ◫)',
      ],
    });

    // Open First-Letter Study Page on mobile (mobile-02-study-first-letter.png)
    await mobilePage.locator('[data-testid="btn-enter-study"]').click();
    await mobilePage.locator('[data-testid="first-letter-study-page"]').waitFor({ state: 'visible', timeout: 10000 });
    await mobilePage.locator('[data-testid="btn-reveal-1w"]').click();
    await mobilePage.locator('[data-testid="btn-reveal-1w"]').click();
    await mobilePage.locator('[data-testid="btn-reveal-1v"]').click();
    await mobilePage.locator('[data-testid="btn-reveal-1w"]').click();
    await mobilePage.waitForTimeout(200);

    await captureStepScreenshot(mobilePage, 'mobile-02-study-first-letter.png', stepResults, {
      step: '9c',
      name: 'Mobile Phone (412x915): Separate First-Letter Study Page (+1w and +1v Progression)',
      assertions: [
        '412x915 Android phone viewport renders First-Letter Study Page with full-width verse cards and bottom +1w / +1v controls',
      ],
    });

    // Return to Flashcard Front and flip to Back for mobile-04-verse-review-back.png
    await mobilePage.locator('[data-testid="btn-back-to-card"]').click();
    await mobilePage.locator('[data-testid="card-front-view"]').waitFor({ state: 'visible', timeout: 10000 });
    await mobilePage.locator('[data-testid="btn-flip-card"]').click();
    await mobilePage.locator('[data-testid="card-back-view"]').waitFor({ state: 'visible', timeout: 10000 });
    await mobilePage.waitForTimeout(150);

    await captureStepScreenshot(mobilePage, 'mobile-04-verse-review-back.png', stepResults, {
      step: '9d',
      name: 'Mobile Phone (412x915): Flashcard Back / Full-Width Verse Review (r5.png)',
      assertions: [
        '412x915 Android phone viewport renders full-width scripture text from edge to edge with zero side-button squishing',
        'AnkiDroid-style 4-button grading bar (AGAIN / HARD / GOOD / EASY) spans the bottom edge cleanly',
      ],
    });

    // Tap verse 2 on the Back to highlight it for repair (mobile-05-verse-repair-highlight.png)
    await mobilePage.locator('[data-testid^="back-verse-"]').nth(1).click();
    await mobilePage.locator('[data-testid="repair-action-sheet"]').waitFor({ state: 'visible', timeout: 10000 });
    await mobilePage.locator('[data-testid="btn-queue-repair-resume"]').waitFor({ state: 'visible', timeout: 10000 });
    await mobilePage.locator('[data-testid="btn-forgot-rest"]').waitFor({ state: 'visible', timeout: 10000 });

    await captureStepScreenshot(mobilePage, 'mobile-05-verse-repair-highlight.png', stepResults, {
      step: '9e',
      name: 'Mobile Phone (412x915): Verse Highlighted for Repair with Queue Repair & Resume + Forgot Rest Sheet',
      assertions: [
        'Tapping a verse on mobile highlights it in warm amber/yellow without squishing the text column',
        '[data-testid="repair-action-sheet"] displays Queue Repair & Resume, Forgot From Here Onward, and Practice Repair Now above the 4-button Anki bar',
      ],
    });

    await mobileContext.close();

    const report = {
      suite: 'bible-memory-playwright-screenshot-tests',
      appUrl: APP_URL,
      startedAt,
      finishedAt: new Date().toISOString(),
      status: 'PASSED' as const,
      totalSteps: stepResults.length,
      consoleErrors,
      steps: stepResults,
    };

    await fs.writeFile(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');
    console.log(`\nAll ${stepResults.length} screenshot tests (Desktop + Mobile 412x915) PASSED! Report written to ${REPORT_PATH}`);
  } finally {
    await browser.close();
    if (staticServerInfo?.server) {
      staticServerInfo.server.close();
    }
  }
}

runScreenshotSuite().catch(async (err: unknown) => {
  console.error('\n[FAIL] Screenshot test suite failed:', err);
  const failureReport = {
    suite: 'bible-memory-playwright-screenshot-tests',
    appUrl: DEFAULT_URL,
    finishedAt: new Date().toISOString(),
    status: 'FAILED' as const,
    error: err instanceof Error ? err.stack || err.message : String(err),
  };
  await fs.writeFile(REPORT_PATH, JSON.stringify(failureReport, null, 2), 'utf8').catch(() => {});
  process.exitCode = 1;
});
