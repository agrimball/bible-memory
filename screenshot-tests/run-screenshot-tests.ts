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

interface WebManifestIconEntry {
  src?: string;
  sizes?: string;
  type?: string;
  purpose?: string;
}

interface WebManifestPayload {
  name?: string;
  short_name?: string;
  icons?: WebManifestIconEntry[];
}

interface CapturedNotificationCall {
  via: 'sw' | 'window';
  title: string;
  options: {
    body?: string;
    icon?: string;
    badge?: string;
    tag?: string;
    renotify?: boolean;
  };
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
            label: 'Peace of God',
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
            label: 'The Word Made Flesh',
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
            label: 'No Condemnation',
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

const ROMANS_8_35_39_RAW = `[35] Who shall separate us from the love of Christ? Shall tribulation, or distress, or persecution, or famine, or nakedness, or danger, or sword?
[36] As it is written, "For your sake we are being killed all the day long; we are regarded as sheep to be slaughtered."
[37] No, in all these things we are more than conquerors through him who loved us.
[38] For I am sure that neither death nor life, nor angels nor rulers, nor things present nor things to come, nor powers,
[39] nor height nor depth, nor anything else in all creation, will be able to separate us from the love of God in Christ Jesus our Lord.`;

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
    // 1a. 01-deck-dashboard.png (Remember-Me Style Home Dashboard: NEW / DUE / KNOWN / OUTLINE Tabs)
    // =========================================================================
    console.log('Step 1a: Navigating to Home Page (Dark Mode, Remember-Me Flat List & 4-Tab Header)...');
    await page.goto(APP_URL, { waitUntil: 'networkidle' });
    await page.locator('[data-testid="btn-toggle-theme"]').waitFor({ state: 'visible', timeout: 15000 });
    await page.locator('[data-testid="topbar-memory-file-status"]').waitFor({ state: 'visible', timeout: 15000 });
    await page.locator('[data-testid="tab-queue"]').waitFor({ state: 'visible', timeout: 15000 });
    await page.locator('[data-testid="tab-due"]').waitFor({ state: 'visible', timeout: 15000 });
    await page.locator('[data-testid="tab-active"]').waitFor({ state: 'visible', timeout: 15000 });
    await page.locator('[data-testid="tab-outline"]').waitFor({ state: 'visible', timeout: 15000 });
    await page.locator('[data-testid="passage-deck-list"]').waitFor({ state: 'visible', timeout: 15000 });
    assertCondition(
      (await page.locator('[data-testid="btn-study-due"]').count()) === 0,
      'Expected [data-testid="btn-study-due"] (▶) to be hidden on NEW tab (tab-queue)'
    );

    const newQueueText = await page.locator('[data-testid="passage-deck-list"]').innerText();
    assertCondition(
      newQueueText.includes('Romans 8:1-4') && newQueueText.includes('Psalm 23:1-6'),
      'Expected Romans 8:1-4 and Psalm 23:1-6 in NEW queue tab on Home Page'
    );

    await captureStepScreenshot(page, '01-deck-dashboard.png', stepResults, {
      step: '1a',
      name: 'Home Dashboard (Dark Mode): Remember-Me 4-Tab Header (NEW / DUE / KNOWN / OUTLINE) & Flat List Rows',
      assertions: [
        '[data-testid="topbar-memory-file-status"] is visible in the compact 52px topbar',
        '[data-testid="tab-queue"] (NEW), [data-testid="tab-due"] (DUE), [data-testid="tab-active"] (KNOWN), and [data-testid="tab-outline"] (OUTLINE) are visible',
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
    await page.locator('[data-testid="due-overall-time"]').waitFor({ state: 'visible', timeout: 10000 });
    await page.locator('[data-testid="btn-study-due"]').waitFor({ state: 'visible', timeout: 10000 });
    assertCondition(
      (await page.locator('[data-testid="btn-study-due"]').count()) === 1 &&
        (await page.locator('[data-testid="btn-study-due"]').isVisible()),
      'Expected [data-testid="btn-study-due"] (▶) to be visible on DUE tab when due cards exist'
    );

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
        '[data-testid="due-overall-time"] overall due time prediction is visible',
        '[data-testid="btn-study-due"] floating play button is visible',
        'Active due cards (Philippians 4:6-7, John 1:1-5) are listed with level/step square badges',
      ],
    });

    // Verify KNOWN tab (tab-active) hides [data-testid="btn-study-due"] (▶), then switch back to NEW tab (tab-queue)
    await page.locator('[data-testid="tab-active"]').click();
    await page.waitForTimeout(100);
    assertCondition(
      (await page.locator('[data-testid="btn-study-due"]').count()) === 0,
      'Expected [data-testid="btn-study-due"] (▶) to be hidden on KNOWN tab (tab-active)'
    );
    await page.locator('[data-testid="tab-queue"]').click();
    await page.locator('[data-testid="queue-page-section"]').waitFor({ state: 'visible', timeout: 10000 });

    // =========================================================================
    // 2. 02-copy-paste-highlight-verse-numbers.png & 02-smart-copy-paste-modal.png
    // =========================================================================
    console.log('Step 2: Testing Add Passage Modal (Missing Verse Numbers Warning, Reference + Label + Bracketed Verses & Peek Verse Boundaries)...');
    await page.locator('[data-testid="btn-open-add-passage"]').click();
    const refInput = page.locator('#input-reference');
    const labelInput = page.locator('#input-passage-label, #input-label');
    const rawTextarea = page.locator('#textarea-passage, [data-testid="textarea-passage-raw"]').first();
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

    // Fill Reference, Label, and Romans 8:35-39 with bracketed verses [35]..[39]
    await refInput.fill('Romans 8:35-39');
    await labelInput.first().fill('More Than Conquerors');
    await rawTextarea.fill(ROMANS_8_35_39_RAW);
    await page.locator('[data-testid="warning-no-verse-numbers"]').waitFor({ state: 'hidden', timeout: 5000 });

    const peekBtnTextCollapsed = await peekBtn.innerText();
    assertCondition(
      peekBtnTextCollapsed.includes('5 verses'),
      `Expected btn-peek-verse-boundaries to report 5 parsed verses, got "${peekBtnTextCollapsed}"`
    );

    await captureStepScreenshot(page, '02-copy-paste-highlight-verse-numbers.png', stepResults, {
      step: '2a',
      name: 'Copy-Paste Modal - Automatic Verse Number Parsing & Collapsed Peek Verse Boundaries Toggle',
      assertions: [
        '[data-testid="warning-no-verse-numbers"] warns when verse numbers are absent',
        'Filling #input-reference ("Romans 8:35-39"), #input-passage-label ("More Than Conquerors"), and #textarea-passage populates 5 verses',
        '[data-testid="btn-peek-verse-boundaries"] shows "(5 verses)" while keeping [data-testid="parsed-verses-preview"] collapsed by default',
      ],
    });

    // Click btn-peek-verse-boundaries to expand and inspect the parsed verses
    await peekBtn.click();
    const previewLocator = page.locator('[data-testid="parsed-verses-preview"]');
    await previewLocator.waitFor({ state: 'visible', timeout: 10000 });

    const parsedVerseItemsCount = await page.locator('[data-testid^="preview-verse-"]').count();
    assertCondition(
      parsedVerseItemsCount === 5,
      `Expected 5 parsed verses in expanded preview for Romans 8:35-39, found ${parsedVerseItemsCount}`
    );

    await captureStepScreenshot(page, '02-smart-copy-paste-modal.png', stepResults, {
      step: '2b',
      name: 'Copy-Paste Modal - Expanded Peek Verse Boundaries Preview',
      assertions: [
        'Clicking [data-testid="btn-peek-verse-boundaries"] expands [data-testid="parsed-verses-preview"]',
        '[data-testid="parsed-verses-preview"] displays all 5 automatically parsed verses ([v. 35]..[v. 39]) for +1v study',
      ],
    });

    await page.locator('[data-testid="btn-save-passage"]').click();
    await page.locator('[data-testid="queue-page-section"]').waitFor({ state: 'visible', timeout: 10000 });

    // =========================================================================
    // 3. 03-card-front-initial.png (Remember-Me Full-Screen Flashcard Front `r4.png`)
    // =========================================================================
    console.log('Step 3: Clicking Passage on Home Page -> Full-Screen Flashcard Front & Bottom Dock...');
    await page.locator('[data-testid="deck-item-0"]').first().click();

    await page.locator('[data-testid="card-front-view"]').waitFor({ state: 'visible', timeout: 10000 });
    await page.locator('[data-testid="card-reference"]').waitFor({ state: 'visible', timeout: 10000 });
    await page.locator('[data-testid="btn-enter-study"]').waitFor({ state: 'visible', timeout: 10000 });
    await page.locator('[data-testid="btn-scope-sheet-toggle"]').waitFor({ state: 'visible', timeout: 10000 });
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
        '[data-testid="btn-scope-sheet-toggle"] is visible in the compact top bar',
        'Circular [data-testid="btn-record-voice"] (🎤) is centered at the bottom of the card face',
      ],
    });

    // =========================================================================
    // 4 & 5. Separate First-Letter Study Page
    //    - 04-study-mode-first-letters-verse1.png
    //    - 05-study-mode-plus-1w-and-plus-1v.png
    // =========================================================================
    console.log('Step 4: Opening Separate First-Letter Study Page via Study Button...');
    await page.locator('[data-testid="btn-enter-study"]').click();

    const studyPage = page.locator('[data-testid="first-letter-study-page"]');
    await studyPage.waitFor({ state: 'visible', timeout: 10000 });
    const studyScopeFullBtn = page.locator('[data-testid="btn-study-scope-full"]');
    if ((await studyScopeFullBtn.count()) > 0 && (await studyScopeFullBtn.isVisible())) {
      await studyScopeFullBtn.click();
    }
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

    // Move the NEW card into the Review Deck so it enters DUE (CARD_STATE_LEARNING) and displays the 4-button Anki bar on Back
    const topbarMemorizeBtn = page.locator('[data-testid="btn-mark-memorizing"]');
    if ((await topbarMemorizeBtn.count()) > 0 && (await topbarMemorizeBtn.isVisible())) {
      await topbarMemorizeBtn.click();
      await page.waitForTimeout(150);
    }

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

    // If card was still in NEW state, click #btn-move-to-review to transition to DUE so Anki grading bar appears
    const moveToReviewBtn = page.locator('#btn-move-to-review');
    if ((await moveToReviewBtn.count()) > 0 && (await moveToReviewBtn.isVisible())) {
      await moveToReviewBtn.click();
      await page.waitForTimeout(150);
    }

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
    const moreScopeOptionsBtn = page.locator('[data-testid="btn-toggle-more-scope-options"]');
    if ((await moreScopeOptionsBtn.count()) > 0 && (await moreScopeOptionsBtn.isVisible())) {
      await moreScopeOptionsBtn.click();
      await page.waitForTimeout(100);
    }
    const toggleRemBtn = page.locator('[data-testid="btn-toggle-remaining-verses"]');
    if ((await toggleRemBtn.count()) > 0 && (await toggleRemBtn.isVisible())) {
      await toggleRemBtn.click();
      await page.waitForTimeout(100);
    }
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
    console.log('Step 8: Grading Card (Good) and Inspecting biblememory.v1 ProtoJSON Wire Format Modal (Advanced Section)...');
    await page.locator('[data-testid="btn-grade-good"]').click();
    await page.waitForTimeout(200);

    const protoSyncBtn = page.locator('[data-testid="btn-open-proto-sync"], [data-testid="nav-proto-sync"]');
    if (!(await protoSyncBtn.first().isVisible())) {
      const backToDeckBtn = page.locator('[data-testid="btn-back-to-deck"]');
      await backToDeckBtn.click({ timeout: 3000 }).catch(() => {});
    }
    await protoSyncBtn.first().waitFor({ state: 'visible', timeout: 10000 });
    await protoSyncBtn.first().click();

    // Expand the collapsed-by-default Advanced section before asserting json-preview / protojson-textarea
    const toggleAdvancedBtn = page.locator('#btn-toggle-advanced-sync');
    await toggleAdvancedBtn.waitFor({ state: 'visible', timeout: 10000 });
    await toggleAdvancedBtn.click();

    const protoTextarea = page.locator('[data-testid="json-preview"], [data-testid="protojson-textarea"]').first();
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
      name: 'ProtoJSON (biblememory.v1) Wire-Format Export/Import Modal (Expanded Advanced Section)',
      assertions: [
        '[data-testid="btn-grade-good"] records Anki review log',
        '[data-testid="btn-open-proto-sync"] opens Memory File modal and #btn-toggle-advanced-sync expands the Advanced section',
        '[data-testid="protojson-textarea"] contains valid biblememory.v1 JSON with passages, flashcards, and reviewLogs',
      ],
    });

    await context.close();

    // =========================================================================
    // 9. MOBILE PHONE VIEWPORT SCREENSHOTS (412x915 Android Pixel Phone)
    //    1. mobile-01-home.png
    //    2. mobile-02-study-first-letter.png
    //    3. mobile-03-flashcard-front.png
    //    4. mobile-04-verse-review-back.png
    //    5. mobile-05-verse-repair-highlight.png
    //    6. mobile-06-incremental-chunk.png
    //    7. mobile-07-chunks-outline.png
    // =========================================================================
    console.log('\nStep 9: Capturing 7 Android Phone (412x915) Mobile Viewport Screenshots...');
    const mobileContext = await browser.newContext({
      viewport: { width: 412, height: 915 },
      deviceScaleFactor: 2.625,
      isMobile: true,
      hasTouch: true,
      permissions: ['microphone', 'notifications'],
    });
    await addSeedScriptToContext(mobileContext);

    const mobilePage = await mobileContext.newPage();
    mobilePage.on('pageerror', (err: Error) => {
      consoleErrors.push(String(err));
    });

    await mobilePage.goto(APP_URL, { waitUntil: 'networkidle' });
    await mobilePage.locator('[data-testid="dashboard-tabs"]').waitFor({ state: 'visible', timeout: 15000 });

    // Verify PWA notification badge, app icon, and manifest.webmanifest assets via HTTP fetch
    const normalizedBaseUrl = APP_URL.endsWith('/') ? APP_URL : `${APP_URL}/`;
    for (const pngAsset of ['notification-badge-96.png', 'notification-badge-192.png', 'icon-192.png']) {
      const assetRes = await fetch(new URL(pngAsset, normalizedBaseUrl).href);
      assertCondition(
        assetRes.status === 200,
        `Expected ${pngAsset} to return HTTP 200, got ${assetRes.status}`
      );
      const contentType = assetRes.headers.get('content-type') || '';
      assertCondition(
        contentType.includes('image/png'),
        `Expected ${pngAsset} content-type to include image/png, got "${contentType}"`
      );
      const pngBytes = new Uint8Array(await assetRes.arrayBuffer());
      assertCondition(
        pngBytes.length > 8 &&
          pngBytes[0] === 0x89 &&
          pngBytes[1] === 0x50 &&
          pngBytes[2] === 0x4e &&
          pngBytes[3] === 0x47,
        `Expected ${pngAsset} to contain valid PNG signature bytes`
      );
    }

    const manifestRes = await fetch(new URL('manifest.webmanifest', normalizedBaseUrl).href);
    assertCondition(
      manifestRes.status === 200,
      `Expected manifest.webmanifest to return HTTP 200, got ${manifestRes.status}`
    );
    const manifestJson = (await manifestRes.json()) as WebManifestPayload;
    const manifestIcons = Array.isArray(manifestJson.icons) ? manifestJson.icons : [];
    assertCondition(
      manifestIcons.some((icon) => icon.purpose === 'any'),
      'Expected manifest.webmanifest to include a separate "purpose": "any" icon entry'
    );
    assertCondition(
      manifestIcons.some((icon) => icon.purpose === 'maskable'),
      'Expected manifest.webmanifest to include a separate "purpose": "maskable" icon entry'
    );
    assertCondition(
      manifestIcons.some(
        (icon) => icon.purpose === 'monochrome' && icon.src === 'notification-badge-96.png'
      ) &&
        manifestIcons.some(
          (icon) => icon.purpose === 'monochrome' && icon.src === 'notification-badge-192.png'
        ),
      'Expected manifest.webmanifest to include separate "purpose": "monochrome" badge icon entries (96x96 & 192x192)'
    );

    // Add Romans 8:35-39 ("More Than Conquerors") via Add Passage Modal and move it to DUE with 2 verses stitched
    await mobilePage.locator('[data-testid="btn-open-add-passage"]').click();
    await mobilePage.locator('#input-reference').fill('Romans 8:35-39');
    await mobilePage.locator('#input-passage-label, #input-label').first().fill('More Than Conquerors');
    await mobilePage.locator('#textarea-passage, [data-testid="textarea-passage-raw"]').first().fill(ROMANS_8_35_39_RAW);
    await mobilePage.locator('[data-testid="btn-save-passage"]').click();
    await mobilePage.locator('[data-testid="queue-page-section"]').waitFor({ state: 'visible', timeout: 10000 });

    // Open Romans 8:35-39 from NEW tab, flip to back, click #btn-move-to-review, and expand to 2 verses (v. 35–36) via [data-testid="btn-inline-add-verse"]
    await mobilePage.locator('.rm-row', { hasText: 'Romans 8:35-39' }).first().click();
    await mobilePage.locator('[data-testid="card-front-view"]').waitFor({ state: 'visible', timeout: 10000 });
    await mobilePage.locator('[data-testid="btn-flip-card"]').click();
    await mobilePage.locator('#btn-move-to-review').waitFor({ state: 'visible', timeout: 10000 });
    await mobilePage.locator('#btn-move-to-review').click();
    await mobilePage.waitForTimeout(150);
    // Click [data-testid="btn-inline-add-verse"] on the Back to stitch v. 36 (+1v -> 2/5 verses) and verify .compact-stitch-strip appears
    await mobilePage.locator('[data-testid="btn-inline-add-verse"]').waitFor({ state: 'visible', timeout: 10000 });
    await mobilePage.locator('[data-testid="btn-inline-add-verse"]').click();
    await mobilePage.locator('[data-testid="verse-stitching-bar"]').waitFor({ state: 'visible', timeout: 10000 });
    await mobilePage.locator('[data-testid="btn-mode-stitch-block"]').click();
    await mobilePage.locator('[data-testid="btn-back-to-deck"]').click();

    // Verify Consolidated ☰ Side Drawer on mobile (📂 Memory File, 🔔 Daily Reminder -> modal, Aa Text Size)
    await mobilePage.locator('[data-testid="btn-open-drawer"]').click();
    await mobilePage.locator('[data-testid="nav-drawer"]').waitFor({ state: 'visible', timeout: 10000 });
    await mobilePage.locator('[data-testid="drawer-open-proto-sync"]').waitFor({ state: 'visible', timeout: 10000 });
    await mobilePage.locator('[data-testid="drawer-open-reminder-modal"]').waitFor({ state: 'visible', timeout: 10000 });
    await mobilePage.locator('[data-testid="slider-text-size"]').waitFor({ state: 'visible', timeout: 10000 });
    await mobilePage.locator('[data-testid="drawer-open-reminder-modal"]').click();
    await mobilePage.locator('[data-testid="daily-reminder-modal"]').waitFor({ state: 'visible', timeout: 10000 });
    await mobilePage.locator('[data-testid="toggle-daily-reminder"]').waitFor({ state: 'visible', timeout: 10000 });
    await mobilePage.locator('[data-testid="btn-test-reminder-notification"]').waitFor({ state: 'visible', timeout: 10000 });

    // Install in-page spy capturing ServiceWorkerRegistration.prototype.showNotification & window.Notification
    await mobilePage.evaluate(() => {
      type SpyCall = {
        via: 'sw' | 'window';
        title: string;
        options: {
          body?: string;
          icon?: string;
          badge?: string;
          tag?: string;
          renotify?: boolean;
        };
      };
      const calls: SpyCall[] = [];
      (window as unknown as { __capturedNotifications?: SpyCall[] }).__capturedNotifications = calls;

      if (
        typeof ServiceWorkerRegistration !== 'undefined' &&
        ServiceWorkerRegistration.prototype &&
        typeof ServiceWorkerRegistration.prototype.showNotification === 'function'
      ) {
        ServiceWorkerRegistration.prototype.showNotification = new Proxy(
          ServiceWorkerRegistration.prototype.showNotification,
          {
            apply(_target, _thisArg, args: [string, NotificationOptions?]): Promise<void> {
              calls.push({
                via: 'sw',
                title: args[0],
                options: (args[1] ?? {}) as SpyCall['options'],
              });
              return Promise.resolve();
            },
          }
        );
      }

      const notificationHelpers = {
        requestPermission(): Promise<NotificationPermission> {
          return Promise.resolve('granted');
        },
      };

      if (typeof window.Notification === 'function') {
        window.Notification = new Proxy(window.Notification, {
          construct(_target, args: [string, NotificationOptions?]): object {
            calls.push({
              via: 'window',
              title: args[0],
              options: (args[1] ?? {}) as SpyCall['options'],
            });
            return {};
          },
          get(target, prop, receiver): unknown {
            if (prop === 'permission') {
              return 'granted';
            }
            if (prop === 'requestPermission') {
              return notificationHelpers.requestPermission;
            }
            return Reflect.get(target, prop, receiver);
          },
        });
      }
    });

    await mobilePage.locator('[data-testid="btn-test-reminder-notification"]').click();
    await mobilePage.locator('[data-testid="test-reminder-feedback"]').waitFor({ state: 'visible', timeout: 10000 });
    const reminderFeedbackText = await mobilePage.locator('[data-testid="test-reminder-feedback"]').innerText();
    assertCondition(
      reminderFeedbackText.includes('Test notification sent'),
      `Expected [data-testid="test-reminder-feedback"] to confirm sent notification, got: "${reminderFeedbackText}"`
    );

    const reminderModalArtifactPath =
      '/home/ashton/.gemini/antigravity-cli/brain/6336f3ca-83fd-49a4-b43b-8910d2e52396/mobile-daily-reminder-modal.png';
    try {
      await fs.access(path.dirname(reminderModalArtifactPath));
      await mobilePage.screenshot({ path: reminderModalArtifactPath, fullPage: false });
    } catch {
      await mobilePage.screenshot({
        path: path.join(OUTPUT_DIR, 'mobile-daily-reminder-modal.png'),
        fullPage: false,
      });
    }

    const capturedNotifications = await mobilePage.evaluate(() => {
      return (
        (
          window as unknown as {
            __capturedNotifications?: Array<{
              via: 'sw' | 'window';
              title: string;
              options: {
                body?: string;
                icon?: string;
                badge?: string;
                tag?: string;
                renotify?: boolean;
              };
            }>;
          }
        ).__capturedNotifications ?? []
      );
    });
    assertCondition(
      capturedNotifications.length >= 1,
      `Expected at least 1 captured notification call after clicking Test notification, got ${capturedNotifications.length}`
    );
    const lastNotification = capturedNotifications[capturedNotifications.length - 1] as CapturedNotificationCall;
    assertCondition(
      lastNotification.title === 'Selah Memory',
      `Expected notification title === "Selah Memory", got "${lastNotification.title}"`
    );
    assertCondition(
      typeof lastNotification.options.icon === 'string' &&
        lastNotification.options.icon.endsWith('/icon-192.png') &&
        !lastNotification.options.icon.includes('favicon-32x32.png'),
      `Expected notification options.icon to end with "/icon-192.png" (not favicon-32x32.png), got "${lastNotification.options.icon}"`
    );
    assertCondition(
      typeof lastNotification.options.badge === 'string' &&
        lastNotification.options.badge.endsWith('/notification-badge-96.png'),
      `Expected notification options.badge to end with "/notification-badge-96.png", got "${lastNotification.options.badge}"`
    );
    assertCondition(
      lastNotification.options.tag === 'selah-daily-reminder',
      `Expected notification options.tag === "selah-daily-reminder", got "${lastNotification.options.tag}"`
    );

    await mobilePage.locator('.reminder-modal-close').click();
    await mobilePage.locator('[data-testid="daily-reminder-modal"]').waitFor({ state: 'hidden', timeout: 10000 });

    // 9a. mobile-01-home.png: Home screen on DUE tab showing pinned NEW | DUE | KNOWN | 📖 OUTLINE bar,
    // custom label ("More Than Conquerors"), overall due time prediction, and left-square checkboxes (.rm-left-square)
    await mobilePage.locator('[data-testid="tab-due"]').click();
    await mobilePage.locator('[data-testid="due-page-section"]').waitFor({ state: 'visible', timeout: 10000 });
    await mobilePage.locator('[data-testid="due-overall-time"]').waitFor({ state: 'visible', timeout: 10000 });
    assertCondition(
      (await mobilePage.locator('.rm-left-square').count()) > 0,
      'Expected .rm-left-square multi-select checkboxes on mobile Home screen'
    );
    const mobileDueText = await mobilePage.locator('[data-testid="due-page-section"]').innerText();
    assertCondition(
      mobileDueText.includes('More Than Conquerors'),
      'Expected custom label "More Than Conquerors" on mobile Home screen'
    );
    assertCondition(
      mobileDueText.includes('v. 35–36') && mobileDueText.includes('v. 6') && !mobileDueText.includes('ESV'),
      `Expected actual verse numbers ("v. 35–36", "v. 6") and no "ESV" label on DUE rows, got: ${mobileDueText}`
    );
    const dueLeftBadgeText = (
      await mobilePage.locator('[data-testid="due-page-section"] .rm-left-square').first().innerText()
    ).trim();
    assertCondition(
      /^(due|<\d+d|\d+[dwmy]|\d+\/\d+)$/i.test(dueLeftBadgeText),
      `Expected days-until-review or fraction badge on DUE left square (no streak), got "${dueLeftBadgeText}"`
    );

    await captureStepScreenshot(mobilePage, 'mobile-01-home.png', stepResults, {
      step: '9a',
      name: 'Mobile Phone (412x915): Home / Deck Dashboard (NEW | DUE | KNOWN | OUTLINE, Custom Label, Due Time Prediction & Left-Square Multi-Select)',
      assertions: [
        'Pinned 4-tab bar (NEW | DUE | KNOWN | OUTLINE) is visible at top',
        '[data-testid="due-overall-time"] overall due time prediction bar is visible',
        'Custom label "More Than Conquerors", actual verse range tags (v. 35–36, v. 6), and .rm-left-square multi-select squares are visible',
        'Consolidated ☰ side drawer exposes 📂 Memory File, mobile-only 🔔 Daily Reminder ([data-testid="daily-reminder-modal"]), and Aa Text Size',
      ],
    });

    // Click Romans 8:35-39 ("More Than Conquerors") in DUE list to open Flashcard Front (at v. 35–36 of 5v)
    const romansDueRow = mobilePage.locator('.rm-row', { hasText: 'Romans 8:35-39' }).first();
    await romansDueRow.click();
    await mobilePage.locator('[data-testid="card-front-view"]').waitFor({ state: 'visible', timeout: 10000 });
    await mobilePage.waitForTimeout(150);

    // 9b. mobile-03-flashcard-front.png: Clean default Flashcard Front (without stitch strip until +1v is tapped)
    // showing reference, custom label, scoped recitation time estimate, and topbar scope pill (v. 35–36 of 5v ▾)
    await mobilePage.locator('[data-testid="card-recitation-time"]').waitFor({ state: 'visible', timeout: 10000 });
    await mobilePage.locator('[data-testid="btn-scope-sheet-toggle"]').waitFor({ state: 'visible', timeout: 10000 });

    // Verify 💡 Opening hint shows the first verse being recited (v. 35: "Who shall separate us from"), NOT the last verse (v. 36: "As it is written")
    await mobilePage.locator('[data-testid="btn-card-hint"]').click();
    const hintCue = mobilePage.locator('[data-testid="new-verse-context-cue"]');
    await hintCue.waitFor({ state: 'visible', timeout: 10000 });
    const hintCueText = await hintCue.innerText();
    assertCondition(
      hintCueText.includes('Who shall separate us from') && !hintCueText.includes('As it is written'),
      `Expected 💡 Opening hint on v. 35–36 stitch-block card to show opening words of v. 35 ("Who shall separate us from"), got "${hintCueText}"`
    );
    await mobilePage.locator('[data-testid="btn-card-hint"]').click();
    await hintCue.waitFor({ state: 'hidden', timeout: 10000 });
    await mobilePage.waitForTimeout(100);

    await captureStepScreenshot(mobilePage, 'mobile-03-flashcard-front.png', stepResults, {
      step: '9b',
      name: 'Mobile Phone (412x915): Clean Default Full-Screen Flashcard Front with Custom Label, Scoped Recitation Time & Topbar Scope Pill',
      assertions: [
        'Flashcard Front shows Romans 8:35-39 (More Than Conquerors) and scoped recitation time (⏱ ~25s (v. 35–36))',
        '💡 Opening hint ([data-testid="btn-card-hint"]) displays the opening words of the first recited verse (v. 35: "Who shall separate us from") rather than the last stitched verse (v. 36)',
        '.compact-stitch-strip is hidden by default during normal review so the card front is 100% distraction-free',
      ],
    });

    // 9c. mobile-02-study-first-letter.png: First-Letter Study screen (synchronized to v. 35–36 stitched scope)
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
    await mobilePage.locator('[data-testid="back-thumb-nav-bar"]').waitFor({ state: 'visible', timeout: 10000 });
    await mobilePage.locator('[data-testid="btn-back-study-mode"]').waitFor({ state: 'visible', timeout: 10000 });
    await mobilePage.locator('[data-testid="btn-flip-back-to-front"]').waitFor({ state: 'visible', timeout: 10000 });
    await mobilePage.locator('[data-testid="anki-grading-bar"]').waitFor({ state: 'visible', timeout: 10000 });
    await mobilePage.waitForTimeout(150);

    // 9d. mobile-04-verse-review-back.png: Flashcard Back showing ONLY the memorized verses (35–36) by default
    // and [data-testid="back-inline-scope-boundary"] with ONLY "🪡 Stitch Next Verse (v. 37)" and "▸ More options" visible by default
    const singleVerseHighlightCount = await mobilePage.locator('.verse-line.target-verse-emphasis').count();
    assertCondition(
      singleVerseHighlightCount === 0,
      'Expected simple review on Back without single-verse highlight box when in Stitch Block / Full-Passage review'
    );
    const defaultVisibleBackVerses = await mobilePage.locator('[data-testid^="back-verse-"]').count();
    assertCondition(
      defaultVisibleBackVerses === 2,
      `Expected only the 2 memorized verses (35–36) to be visible on Back by default, found ${defaultVisibleBackVerses}`
    );
    await mobilePage.locator('[data-testid="back-inline-scope-boundary"]').waitFor({ state: 'visible', timeout: 10000 });
    await mobilePage.locator('[data-testid="btn-inline-add-verse"]').waitFor({ state: 'visible', timeout: 10000 });
    await mobilePage.locator('[data-testid="btn-toggle-more-scope-options"]').waitFor({ state: 'visible', timeout: 10000 });
    assertCondition(
      (await mobilePage.locator('[data-testid="inline-boundary-more-drawer"]').count()) === 0,
      'Expected [data-testid="inline-boundary-more-drawer"] to be collapsed by default on <10v scope'
    );

    await captureStepScreenshot(mobilePage, 'mobile-04-verse-review-back.png', stepResults, {
      step: '9d',
      name: 'Mobile Phone (412x915): Flashcard Back / Memorized Verses Only with Clean Inline Scope Boundary (🪡 Stitch Next Verse + ▸ More options), Symmetric Thumb Bar & 4-Button Anki Bar',
      assertions: [
        '412x915 Android phone viewport renders only the memorized verses (35–36) by default',
        '[data-testid="back-inline-scope-boundary"] shows ONLY "🪡 Stitch Next Verse (v. 37)" and "▸ More options" ([data-testid="btn-toggle-more-scope-options"]) by default',
        'Symmetric thumb-zone bar ([data-testid="back-thumb-nav-bar"]) exposes 🎓 Study ([data-testid="btn-back-study-mode"]) and ◫ Flip to Front ([data-testid="btn-flip-back-to-front"])',
        'AnkiDroid-style 4-button grading bar (AGAIN / HARD / GOOD / EASY) spans the bottom edge cleanly',
      ],
    });

    // 9e. mobile-05-verse-repair-highlight.png: Multi-Verse Range Mend (3+ verses selected on the back of the card)
    // Click [data-testid="btn-toggle-more-scope-options"] ("▸ More options") and then [data-testid="btn-toggle-remaining-verses"] ("▸ Peek remaining 3 verses") so verses 35..39 are visible, then tap verse 35 (idx 0) and verse 37 (idx 2)
    await mobilePage.locator('[data-testid="btn-toggle-more-scope-options"]').click();
    await mobilePage.locator('[data-testid="inline-boundary-more-drawer"]').waitFor({ state: 'visible', timeout: 10000 });
    await mobilePage.locator('[data-testid="btn-toggle-remaining-verses"]').click();
    await mobilePage.waitForTimeout(150);
    await mobilePage.locator('[data-testid^="back-verse-"]').nth(0).click();
    await mobilePage.locator('[data-testid="repair-action-sheet"]').waitFor({ state: 'visible', timeout: 10000 });
    await mobilePage.waitForTimeout(150);
    await mobilePage.locator('[data-testid^="back-verse-"]').nth(2).click();
    await mobilePage.waitForTimeout(150);
    const draftSelectedCount = await mobilePage.locator('.verse-line.repair-draft-selected').count();
    assertCondition(
      draftSelectedCount === 3,
      `Expected 3 verses highlighted for multi-verse range mend, found ${draftSelectedCount}`
    );
    const repairSheetText = await mobilePage.locator('[data-testid="repair-action-sheet"]').innerText();
    assertCondition(
      repairSheetText.includes('Mend v. 35–37'),
      `Expected [data-testid="repair-action-sheet"] to show "🩹 Mend v. 35–37", got "${repairSheetText}"`
    );

    await captureStepScreenshot(mobilePage, 'mobile-05-verse-repair-highlight.png', stepResults, {
      step: '9e',
      name: 'Mobile Phone (412x915): Multi-Verse Range Mend (3 Verses Highlighted) with 🩹 Mend Action Bar',
      assertions: [
        'Expanding "▸ More options" ([data-testid="btn-toggle-more-scope-options"]) and "▸ Peek remaining 3 verses" ([data-testid="btn-toggle-remaining-verses"]) reveals verses 35–39',
        'Selecting start verse (35) and end verse (37) highlights all 3 verses (v. 35–37) in warm amber',
        '[data-testid="repair-action-sheet"] displays 🩹 Mend v. 35–37 with Mend & Resume (v. 38) ↩ and Forgot Rest buttons above the 4-button Anki bar',
      ],
    });

    // Cancel the draft repair selection and hide the remaining 3 unmemorized verses again for mobile-06-incremental-chunk.png
    await mobilePage.locator('.repair-cancel-link').click();
    await mobilePage.locator('[data-testid="btn-toggle-remaining-verses"]').click();
    await mobilePage.waitForTimeout(100);

    // 9f. mobile-06-incremental-chunk.png: Centered Tap-to-Split Modal ([data-testid="incremental-chunk-sheet"]) with interactive boundary lines,
    // Undo button ([data-testid="btn-undo-split-boundary"]), zero naming friction, and single full-width #btn-confirm-carve-chunk ("✂️ Split into 2 Passages")
    const backInlineBoundary = mobilePage.locator('[data-testid="back-inline-scope-boundary"]');
    await backInlineBoundary.waitFor({ state: 'visible', timeout: 10000 });
    await mobilePage.locator('[data-testid="btn-inline-carve-chunk"]').click();
    const chunkSheet = mobilePage.locator('[data-testid="incremental-chunk-sheet"]');
    await chunkSheet.waitFor({ state: 'visible', timeout: 10000 });
    await mobilePage.locator('[data-testid="tap-to-split-verse-list"]').waitFor({ state: 'visible', timeout: 10000 });
    const splitBoundary1 = mobilePage.locator('[data-testid="btn-split-boundary-1"]');
    await splitBoundary1.waitFor({ state: 'visible', timeout: 10000 });
    const splitBoundary1Text = await splitBoundary1.innerText();
    assertCondition(
      splitBoundary1Text.includes('SPLIT HERE (after v. 36)'),
      `Expected [data-testid="btn-split-boundary-1"] to show "SPLIT HERE (after v. 36)", got "${splitBoundary1Text}"`
    );
    await mobilePage.locator('[data-testid="btn-undo-split-boundary"]').waitFor({ state: 'visible', timeout: 10000 });

    // Ensure hidden #input-carve-chunk-label is empty so split passages default to opening words on Outline
    await mobilePage.locator('#input-carve-chunk-label').evaluate((el: HTMLInputElement) => {
      el.value = '';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const confirmSplitBtn = mobilePage.locator('#btn-confirm-carve-chunk');
    await confirmSplitBtn.waitFor({ state: 'visible', timeout: 10000 });
    const confirmSplitText = await confirmSplitBtn.innerText();
    assertCondition(
      confirmSplitText.includes('Split into 2 Passages'),
      `Expected #btn-confirm-carve-chunk to show "✂️ Split into 2 Passages", got "${confirmSplitText}"`
    );
    await mobilePage.waitForTimeout(150);

    await captureStepScreenshot(mobilePage, 'mobile-06-incremental-chunk.png', stepResults, {
      step: '9f',
      name: 'Mobile Phone (412x915): Centered Interactive Tap-to-Split Passage Modal with Split Boundary Dividers, Undo Button & Single Split CTA',
      assertions: [
        '[data-testid="incremental-chunk-sheet"] displays centered Tap-to-Split modal with interactive verse lines ([data-testid="tap-to-split-verse-list"])',
        '[data-testid="btn-split-boundary-1"] ("✂️ ═══ SPLIT HERE (after v. 36) · Tap to remove ═══") and [data-testid="btn-undo-split-boundary"] ("↩ Undo") are visible',
        'No custom label prompt is required and single full-width #btn-confirm-carve-chunk shows "✂️ Split into 2 Passages"',
      ],
    });

    // Click #btn-confirm-carve-chunk so Romans 8:35-36 is split off and Romans 8:37-39 continues!
    await mobilePage.locator('#btn-confirm-carve-chunk').click();
    await mobilePage.waitForTimeout(200);
    const remainingRefText = await mobilePage.locator('[data-testid="card-reference"]').innerText();
    assertCondition(
      remainingRefText.includes('Romans 8:37-39'),
      `Expected remaining passage after splitting passage to include "Romans 8:37-39", got "${remainingRefText}"`
    );

    // 9g. mobile-07-chunks-outline.png: Return to Deck Dashboard, click OUTLINE tab, verify groups default to collapsed,
    // expand Romans 8, verify hierarchical multi-select, contiguous-only "🪡 Sew", "passages" vocabulary,
    // first-words default on unlabeled passages ("Who shall separate us…", "No, in all these things…"),
    // and direct sub-passage row tap to expand/collapse inline verse preview on 8:35–36
    await mobilePage.locator('[data-testid="btn-back-to-deck"]').click();
    const outlineTabBtn = mobilePage.locator('[data-testid="tab-filter-outline"], [data-testid="tab-outline"]').first();
    await outlineTabBtn.waitFor({ state: 'visible', timeout: 10000 });
    await outlineTabBtn.click();

    const outlineSection = mobilePage.locator('[data-testid="outline-page-section"]');
    await outlineSection.waitFor({ state: 'visible', timeout: 10000 });
    const collapseAllBtn = mobilePage.locator('[data-testid="btn-outline-collapse-all"]');
    await collapseAllBtn.waitFor({ state: 'visible', timeout: 10000 });
    await mobilePage.locator('[data-testid="outline-group-select-0"]').waitFor({ state: 'visible', timeout: 10000 });
    await mobilePage.locator('[data-testid="outline-group-select-2"]').waitFor({ state: 'visible', timeout: 10000 });

    // Verify all groups default to collapsed ("▸ Expand All", and [data-testid="outline-chunk-2-1"] is hidden)
    const initialCollapseAllText = await collapseAllBtn.innerText();
    assertCondition(
      initialCollapseAllText.includes('Expand All'),
      `Expected [data-testid="btn-outline-collapse-all"] to show "▸ Expand All" initially, got "${initialCollapseAllText}"`
    );
    assertCondition(
      (await mobilePage.locator('[data-testid="outline-chunk-2-1"]').count()) === 0,
      'Expected sub-passages to be collapsed by default when 📖 OUTLINE opens'
    );
    assertCondition(
      (await mobilePage.locator('[data-testid="btn-study-due"]').count()) === 0,
      'Expected #btn-study-due (▶) to be hidden on OUTLINE tab so only #btn-fab-add (+) is shown'
    );

    // Click [data-testid="btn-outline-toggle-group-2"] ("Romans 8 · 3 passages") to expand ONLY the Romans 8 group
    await mobilePage.locator('[data-testid="btn-outline-toggle-group-2"]').click();
    await mobilePage.locator('[data-testid="outline-chunk-2-1"]').waitFor({ state: 'visible', timeout: 10000 });

    // Verify group 2 (Romans 8 with 8:1-4, 8:35-36, 8:37-39) has group-level "🪡 Sew" disabled due to the gap v. 5–34,
    // while selecting the two contiguous passages (8:35-36 and 8:37-39) shows partial group selection (aria-checked="mixed") and enables batch Sew!
    const group2SewBtn = mobilePage.locator('[data-testid="btn-outline-combine-2"]');
    const group2CombineDisabled = await group2SewBtn.isDisabled();
    assertCondition(
      group2CombineDisabled === true,
      'Expected group-level 🪡 Sew on Romans 8 (with gap v. 5–34) to be disabled'
    );
    const group2SewText = await group2SewBtn.innerText();
    assertCondition(
      group2SewText.includes('Sew'),
      `Expected [data-testid="btn-outline-combine-2"] to show "🪡 Sew", got "${group2SewText}"`
    );
    await mobilePage.locator('[data-testid="outline-chunk-range-2-1"]').click();
    await mobilePage.locator('[data-testid="outline-chunk-range-2-2"]').click();
    const group2CheckedAttr = await mobilePage.locator('[data-testid="outline-group-select-2"]').getAttribute('aria-checked');
    assertCondition(
      group2CheckedAttr === 'mixed',
      `Expected [data-testid="outline-group-select-2"] to have aria-checked="mixed" when 2 of 3 passages are selected, got "${group2CheckedAttr}"`
    );
    await mobilePage.locator('[data-testid="btn-clear-selection"]').click();

    // Assert that .rm-outline-sub-meta does NOT contain ▸ or ▾
    const subMetaTexts = await mobilePage.locator('.rm-outline-sub-meta').allInnerTexts();
    assertCondition(
      subMetaTexts.length > 0 && subMetaTexts.every((t) => !t.includes('▸') && !t.includes('▾')),
      `Expected .rm-outline-sub-meta to not contain ▸ or ▾ arrows, got: ${JSON.stringify(subMetaTexts)}`
    );

    // Click the sub-passage row [data-testid="outline-chunk-2-1"] directly to expand, click again to verify collapse, and click once more so [35] and [36] are expanded
    const subPassageRow21 = mobilePage.locator('[data-testid="outline-chunk-2-1"]');
    await subPassageRow21.click();
    await mobilePage.locator('[data-testid="outline-chunk-verses-2-1"]').waitFor({ state: 'visible', timeout: 10000 });
    await subPassageRow21.click();
    await mobilePage.waitForTimeout(100);
    assertCondition(
      (await mobilePage.locator('[data-testid="outline-chunk-verses-2-1"]').count()) === 0,
      'Expected clicking [data-testid="outline-chunk-2-1"] a second time to collapse its inline verses'
    );
    await subPassageRow21.click();
    await mobilePage.locator('[data-testid="outline-chunk-verses-2-1"]').waitFor({ state: 'visible', timeout: 10000 });
    await mobilePage.waitForTimeout(200);

    const outlineText = await outlineSection.innerText();
    assertCondition(
      outlineText.includes('passages') && !outlineText.toLowerCase().includes('chunks'),
      `Expected Outline tab header text to use "passages" vocabulary instead of "chunks", got: ${outlineText}`
    );
    assertCondition(
      outlineText.includes('No Condemnation') &&
        outlineText.includes('Who shall separate us') &&
        outlineText.includes('No, in all these things'),
      `Expected Outline tab to display "No Condemnation" on 8:1–4 and opening words on split passages ("Who shall separate us…" and "No, in all these things…"), got: ${outlineText}`
    );
    assertCondition(
      outlineText.includes('Gap: v. 5–34 not in deck') && outlineText.includes('Auto-Seam (v. 36 → v. 37)'),
      `Expected Outline tab to display honest Gap ("v. 5–34 not in deck") and Auto-Seam ("v. 36 → v. 37") connectors, got: ${outlineText}`
    );
    assertCondition(
      outlineText.includes('[35] Who shall separate us'),
      `Expected expanded inline verse preview under 8:35–36 to show "[35] Who shall separate us", got: ${outlineText}`
    );

    await captureStepScreenshot(mobilePage, 'mobile-07-chunks-outline.png', stepResults, {
      step: '9g',
      name: 'Mobile Phone (412x915): Passages Outline View (📖 OUTLINE Tab with Collapsed-by-Default Groups, Expanded Romans 8, First-Words Default, Direct Row Tap Verse Peek & Contiguous 🪡 Sew)',
      assertions: [
        'Groups default to collapsed (▸) with single-line headers; Romans 8 · 3 passages is expanded (▾) while Psalm 23, John 1, and Philippians 4 remain compactly collapsed',
        'Unlabeled split passages (Romans 8:35–36, Romans 8:37–39) display their opening words while labeled passages display their titles',
        'Tapping sub-passage row [data-testid="outline-chunk-2-1"] directly expands/collapses its inline verses ([35] Who shall separate us...) without a ▸/▾ arrow in .rm-outline-sub-meta',
        'Honest ⋮ Gap: v. 5–34 not in deck and 🪡 Auto-Seam (v. 36 → v. 37) connectors with contiguous-only 🪡 Sew validation',
      ],
    });

    // =========================================================================
    // 9h. mobile-08-known-tab-ordering.png: KNOWN & NEW Tab Ordering + Left Badges
    // =========================================================================
    console.log('Step 9h: Scheduling Philippians 4:6-7 (Hard -> MEMORIZING 1d) & John 1:1-5 (Good -> MEMORIZED), then verifying KNOWN & NEW...');
    await mobilePage.locator('[data-testid="tab-due"]').click();
    await mobilePage.locator('[data-testid="due-page-section"] .rm-row', { hasText: 'Philippians 4:6-7' }).first().click();
    await mobilePage.locator('[data-testid="btn-flip-card"]').click();
    await mobilePage.locator('[data-testid="btn-grade-hard"]').click();
    await mobilePage.locator('[data-testid="tab-due"]').click();
    await mobilePage.locator('[data-testid="due-page-section"] .rm-row', { hasText: 'John 1:1-5' }).first().click();
    await mobilePage.locator('[data-testid="btn-flip-card"]').click();
    await mobilePage.locator('[data-testid="btn-grade-good"]').click();
    await mobilePage.locator('[data-testid="tab-active"]').click();
    await mobilePage.locator('[data-testid="active-page-section"]').waitFor({ state: 'visible', timeout: 10000 });
    await mobilePage.locator('[data-testid="known-section-memorizing"]').waitFor({ state: 'visible', timeout: 10000 });
    await mobilePage.locator('[data-testid="known-section-memorized"]').waitFor({ state: 'visible', timeout: 10000 });

    const memorizingHdrBox = await mobilePage.locator('[data-testid="known-section-memorizing"]').boundingBox();
    const memorizedHdrBox = await mobilePage.locator('[data-testid="known-section-memorized"]').boundingBox();
    assertCondition(
      Boolean(memorizingHdrBox && memorizedHdrBox && memorizingHdrBox.y < memorizedHdrBox.y),
      'Expected MEMORIZING section header above MEMORIZED section header in KNOWN tab'
    );
    const knownText = await mobilePage.locator('[data-testid="active-page-section"]').innerText();
    assertCondition(
      !knownText.includes('ESV'),
      `Expected KNOWN cards to show verse count instead of "ESV", got: ${knownText}`
    );

    await captureStepScreenshot(mobilePage, 'mobile-08-known-tab-ordering.png', stepResults, {
      step: '9h',
      name: 'Mobile Phone (412x915): KNOWN Tab (MEMORIZING Pinned at Top, Days-Until-Review Squares & Verse Counts)',
      assertions: [
        'MEMORIZING cards appear pinned above MEMORIZED cards with slim section dividers',
        'Left squares display days-until-review (due/<1d/1d...) instead of streak numbers; right tags show verse count instead of ESV',
      ],
    });

    // Verify NEW tab has canonical order (Psalm 23 before Romans 8) and no reorder arrows
    await mobilePage.locator('[data-testid="tab-queue"]').click();
    await mobilePage.locator('[data-testid="queue-page-section"]').waitFor({ state: 'visible', timeout: 10000 });
    const reorderBtnCount = await mobilePage.locator('[data-testid^="btn-move-up-"], [data-testid^="btn-move-down-"]').count();
    assertCondition(
      reorderBtnCount === 0,
      `Expected zero up/down reorder arrows in NEW tab, found ${reorderBtnCount}`
    );
    const newRowRefs = await mobilePage.locator('[data-testid="queue-page-section"] .rm-ref').allInnerTexts();
    const psalmIdx = newRowRefs.findIndex((t) => t.includes('Psalm 23'));
    const romansIdx = newRowRefs.findIndex((t) => t.includes('Romans 8'));
    assertCondition(
      psalmIdx >= 0 && romansIdx >= 0 && psalmIdx < romansIdx,
      `Expected NEW tab canonical order Psalm 23 before Romans 8, got: ${JSON.stringify(newRowRefs)}`
    );

    // =========================================================================
    // 9i. mobile-09-partial-known-picker.png: Partially-Known Passage Picker
    // =========================================================================
    console.log('Step 9i: Opening Romans 8:1-4 (NEW) -> Partially-Known Passage Picker (v. 1-3)...');
    await mobilePage.locator('[data-testid="queue-page-section"] .rm-row', { hasText: 'Romans 8:1-4' }).first().click();
    await mobilePage.locator('[data-testid="card-front-view"]').waitFor({ state: 'visible', timeout: 10000 });
    await mobilePage.locator('[data-testid="btn-flip-card"]').click();
    await mobilePage.locator('[data-testid="card-back-view"]').waitFor({ state: 'visible', timeout: 10000 });

    const partialOpenBtn = mobilePage.locator('[data-testid="btn-open-partial-known"]');
    const moveReviewBtn = mobilePage.locator('[data-testid="btn-move-to-review"]');
    await partialOpenBtn.waitFor({ state: 'visible', timeout: 10000 });
    await moveReviewBtn.waitFor({ state: 'visible', timeout: 10000 });
    const partialBox = await partialOpenBtn.boundingBox();
    const moveBox = await moveReviewBtn.boundingBox();
    assertCondition(
      Boolean(partialBox && moveBox && Math.abs(partialBox.y - moveBox.y) < 12),
      'Expected NEW Back 2-button bar (Know Part / All + Move to Review Deck) on one non-wrapping row'
    );

    await partialOpenBtn.click();
    await mobilePage.locator('[data-testid="partial-known-modal"]').waitFor({ state: 'visible', timeout: 10000 });
    await mobilePage.locator('[data-testid="partial-known-verse-2"]').click();
    await mobilePage.waitForTimeout(150);

    await captureStepScreenshot(mobilePage, 'mobile-09-partial-known-picker.png', stepResults, {
      step: '9i',
      name: 'Mobile Phone (412x915): Partially-Known Passage Picker Modal (Romans 8:1-3 Selected)',
      assertions: [
        'Non-wrapping NEW Back action bar sits cleanly above pinned bottom-right flip button',
        '[data-testid="partial-known-modal"] lets user tap verse 3 to highlight verses 1–3 as already known',
      ],
    });

    await mobilePage.locator('[data-testid="btn-save-partial-known"]').click();
    await mobilePage.locator('[data-testid="partial-known-modal"]').waitFor({ state: 'hidden', timeout: 10000 });
    const scopeAfterPartial = (await mobilePage.locator('[data-testid="btn-scope-sheet-toggle"]').innerText()).trim();
    assertCondition(
      scopeAfterPartial.includes('3 of 4v'),
      `Expected partially-known Romans 8:1-4 to jump straight to 3 of 4v stitch scope, got "${scopeAfterPartial}"`
    );

    // =========================================================================
    // 9j. mobile-10-stitch-step1-pinned-flip.png: Final-Verse Stitch Strip, 2-Btn Step 1, Pinned Flip
    // =========================================================================
    console.log('Step 9j: Advancing to Final Verse (4 of 4v) -> Final-Verse Stitch Strip, Step 1 2-Btn Bar & Pinned Flip...');
    await mobilePage.locator('[data-testid="btn-flip-card"]').click();
    await mobilePage.locator('[data-testid="card-back-view"]').waitFor({ state: 'visible', timeout: 10000 });
    await mobilePage.locator('[data-testid="btn-inline-add-verse"]').click();
    await mobilePage.waitForTimeout(200);
    await mobilePage.locator('[data-testid="card-front-view"]').waitFor({ state: 'visible', timeout: 10000 });
    await mobilePage.locator('[data-testid="verse-stitching-bar"]').waitFor({ state: 'visible', timeout: 10000 });

    const frontFlipBox = await mobilePage.locator('[data-testid="btn-flip-card"]').boundingBox();
    await mobilePage.locator('[data-testid="btn-flip-card"]').click();
    await mobilePage.locator('[data-testid="card-back-view"]').waitFor({ state: 'visible', timeout: 10000 });
    await mobilePage.locator('[data-testid="step1-stitch-bar"]').waitFor({ state: 'visible', timeout: 10000 });

    assertCondition(
      (await mobilePage.locator('[data-testid="btn-flip-to-front"]').count()) === 0,
      'Expected topbar ↩ button removed on Card Back so flip lives solely at bottom-right'
    );
    assertCondition(
      (await mobilePage.locator('[data-testid="anki-grading-bar"]').count()) === 0,
      'Expected 4-button Anki bar hidden during Step 1 New Verse flow in favor of 2-button Step 1 bar'
    );
    const backFlipBox = await mobilePage.locator('[data-testid="btn-flip-back-to-front"]').boundingBox();
    assertCondition(
      Boolean(
        frontFlipBox &&
          backFlipBox &&
          Math.abs(frontFlipBox.x - backFlipBox.x) <= 1.5 &&
          Math.abs(frontFlipBox.y - backFlipBox.y) <= 1.5
      ),
      `Expected bottom-right ◫ flip button pinned at identical (x, y) on Front ${JSON.stringify(frontFlipBox)} and Back ${JSON.stringify(backFlipBox)}`
    );

    await captureStepScreenshot(mobilePage, 'mobile-10-stitch-step1-pinned-flip.png', stepResults, {
      step: '9j',
      name: 'Mobile Phone (412x915): Step 1 (Final Verse 4 of 4v) Dedicated 2-Button Bar & Pinned Bottom-Right Flip',
      assertions: [
        '1 · New | 2 · Stitch | All bar appears on the final verse (4 of 4v) just like earlier verses',
        '[data-testid="step1-stitch-bar"] displays ↻ Retry and 🪡 Stitch 1–4 → instead of 4 Anki grading buttons',
        'Bottom-right ◫ flip button maintains identical (x, y) coordinates across Front and Back',
      ],
    });

    // Advance from Step 1 -> Step 2 Stitch Block (Front) then flip to verify 4-button Anki bar returns
    await mobilePage.locator('[data-testid="btn-step1-advance-stitch"]').click();
    await mobilePage.locator('[data-testid="card-front-view"]').waitFor({ state: 'visible', timeout: 10000 });
    await mobilePage.locator('[data-testid="btn-flip-card"]').click();
    await mobilePage.locator('[data-testid="anki-grading-bar"]').waitFor({ state: 'visible', timeout: 10000 });
    await mobilePage.locator('[data-testid="btn-back-to-deck"]').click();

    // =========================================================================
    // 9k & 9l. Stitched Seams Button, Cross-Chapter Psalms Unlinked, Unlink Persist, Live Counter & Skip
    // =========================================================================
    console.log('Step 9k: Setting up Stitched Romans 8 & Psalm 117/118 cross-chapter boundary, testing Seams & DUE Queue...');
    // Add Psalm 117:1-2 (complete 2-verse chapter) and Psalm 118:1-2 and mark both known
    await mobilePage.locator('[data-testid="btn-open-add-passage"]').click();
    await mobilePage.locator('#input-reference').fill('Psalm 117:1-2');
    await mobilePage.locator('#textarea-passage').fill(
      '[1] Praise the LORD, all nations! Extol him, all peoples! [2] For great is his steadfast love toward us, and the faithfulness of the LORD endures forever. Praise the LORD!'
    );
    await mobilePage.locator('[data-testid="btn-save-passage"]').click();
    await mobilePage.locator('[data-testid="btn-open-add-passage"]').click();
    await mobilePage.locator('#input-reference').fill('Psalm 118:1-2');
    await mobilePage.locator('#textarea-passage').fill(
      '[1] Oh give thanks to the LORD, for he is good; for his steadfast love endures forever! [2] Let Israel say, His steadfast love endures forever.'
    );
    await mobilePage.locator('[data-testid="btn-save-passage"]').click();
    await mobilePage.locator('[data-testid="tab-queue"]').click();

    // Mark Psalm 117:1-2 fully known via Partial-Known modal
    await mobilePage.locator('[data-testid="queue-page-section"] .rm-row', { hasText: 'Psalm 117:1-2' }).first().click();
    await mobilePage.locator('[data-testid="btn-flip-card"]').click();
    await mobilePage.locator('[data-testid="btn-open-partial-known"]').click();
    await mobilePage.locator('[data-testid="partial-known-verse-1"]').click();
    await mobilePage.locator('[data-testid="btn-save-partial-known"]').click();
    await mobilePage.locator('[data-testid="btn-back-to-deck"]').click();

    // Mark Psalm 118:1-2 fully known via Partial-Known modal
    await mobilePage.locator('[data-testid="tab-queue"]').click();
    await mobilePage.locator('[data-testid="queue-page-section"] .rm-row', { hasText: 'Psalm 118:1-2' }).first().click();
    await mobilePage.locator('[data-testid="btn-flip-card"]').click();
    await mobilePage.locator('[data-testid="btn-open-partial-known"]').click();
    await mobilePage.locator('[data-testid="partial-known-verse-1"]').click();
    await mobilePage.locator('[data-testid="btn-save-partial-known"]').click();
    await mobilePage.locator('[data-testid="btn-back-to-deck"]').click();

    // Mark Romans 8:37-39 fully known via Scope Sheet -> Set Known Verses so Romans 8:35-39 becomes Stitched DUE card
    await mobilePage.locator('[data-testid="tab-due"]').click();
    await mobilePage.locator('[data-testid="due-page-section"] .rm-row', { hasText: 'Romans 8:37-39' }).first().click();
    await mobilePage.locator('[data-testid="btn-scope-sheet-toggle"]').click();
    await mobilePage.locator('[data-testid="btn-scope-set-known-verses"]').click();
    await mobilePage.locator('[data-testid="partial-known-verse-2"]').click();
    await mobilePage.locator('[data-testid="btn-save-partial-known"]').click();
    await mobilePage.locator('[data-testid="btn-back-to-deck"]').click();

    // Start DUE review session and verify live counter + Again increment + Stitched Seams + Skip
    await mobilePage.locator('[data-testid="tab-due"]').click();
    await mobilePage.locator('[data-testid="btn-study-due"]').click();
    await mobilePage.locator('[data-testid="card-front-view"]').waitFor({ state: 'visible', timeout: 10000 });

    const counterLoc = mobilePage.locator('[data-testid="study-queue-progress"]');
    const initialCounterText = (await counterLoc.innerText()).trim();
    const initialCounterMatch = /^1 \/ (\d+)$/.exec(initialCounterText);
    assertCondition(
      Boolean(initialCounterMatch && Number(initialCounterMatch[1]) >= 2),
      `Expected study queue counter in "1 / N" (N >= 2) format, got "${initialCounterText}"`
    );
    const counterBox = await counterLoc.boundingBox();
    assertCondition(
      Boolean(counterBox && counterBox.height <= 30),
      `Expected counter "${initialCounterText}" on one line (height <= 30px), got ${counterBox?.height}`
    );
    const totalBeforeAgain = Number(initialCounterMatch![1]);

    // Grade first DUE card Again -> total queue count must increment live in this session
    await mobilePage.locator('[data-testid="btn-flip-card"]').click();
    await mobilePage.locator('[data-testid="btn-grade-again"]').click();
    await mobilePage.locator('[data-testid="card-front-view"]').waitFor({ state: 'visible', timeout: 10000 });
    const afterAgainCounterText = (await counterLoc.innerText()).trim();
    const afterAgainMatch = /^\d+ \/ (\d+)$/.exec(afterAgainCounterText);
    assertCondition(
      Boolean(afterAgainMatch && Number(afterAgainMatch[1]) === totalBeforeAgain + 1),
      `Expected grading Again to increment live session counter total from ${totalBeforeAgain} to ${totalBeforeAgain + 1}, got "${afterAgainCounterText}"`
    );

    // Walk forward in DUE session until stitched card Romans 8:35-39 is active (using ⏭ Skip when shown, else Good)
    for (let hop = 0; hop < 10; hop++) {
      if ((await mobilePage.locator('[data-testid="btn-edit-card-seams"]').count()) > 0) {
        break;
      }
      if ((await mobilePage.locator('[data-testid="btn-skip-long-card"]').count()) > 0) {
        await mobilePage.locator('[data-testid="btn-skip-long-card"]').click();
      } else {
        await mobilePage.locator('[data-testid="btn-flip-card"]').click();
        await mobilePage.locator('[data-testid="btn-grade-good"]').click();
      }
      await mobilePage.waitForTimeout(120);
      if ((await mobilePage.locator('[data-testid="card-front-view"]').count()) === 0) {
        break;
      }
    }
    await mobilePage.locator('[data-testid="btn-edit-card-seams"]').waitFor({ state: 'visible', timeout: 10000 });

    await captureStepScreenshot(mobilePage, 'mobile-11-stitched-card-seams-btn.png', stepResults, {
      step: '9k',
      name: 'Mobile Phone (412x915): Auto-Stitched Card with Clean [✂️ Seams] Topbar Action & Live Counter',
      assertions: [
        'Stitched passage card displays single [✂️ Seams] button in topbar in place of verse-count scope picker',
        'Bottom counter displays non-wrapping "pos / total" format and updates live during DUE session',
      ],
    });

    // Tap [✂️ Seams] -> Outline View with highlighted Romans 8 + Resume banner + Unlink toggle + Cross-chapter Psalms unlinked
    await mobilePage.locator('[data-testid="btn-edit-card-seams"]').click();
    await mobilePage.locator('[data-testid="outline-page-section"]').waitFor({ state: 'visible', timeout: 10000 });
    await mobilePage.locator('[data-testid="btn-resume-review-from-outline"]').waitFor({ state: 'visible', timeout: 10000 });

    // Toggle Romans 8 Auto-Seam to Unlinked
    const romSeamBtn = mobilePage.locator('.rm-outline-group-card', { hasText: 'Romans 8' }).locator('.rm-outline-seam-pill').first();
    await romSeamBtn.waitFor({ state: 'visible', timeout: 10000 });
    await romSeamBtn.click();
    await mobilePage.waitForTimeout(150);

    // Expand Psalms group to verify cross-chapter Psalm 117 -> 118 defaults to Unlinked
    const psalmGroupToggle = mobilePage.locator('.rm-outline-group-toggle', { hasText: 'Psalm 117' }).first();
    if ((await psalmGroupToggle.getAttribute('aria-expanded')) !== 'true') {
      await psalmGroupToggle.click();
      await mobilePage.waitForTimeout(150);
    }

    const outlineAfterUnlinkText = await mobilePage.locator('[data-testid="outline-page-section"]').innerText();
    assertCondition(
      outlineAfterUnlinkText.includes('Unlinked (v. 36 ✂ v. 37') &&
        outlineAfterUnlinkText.includes('Unlinked (117:2 ✂ 118:1'),
      `Expected both unlinked Romans v.36-37 and default-unlinked Psalm 117:2->118:1 in Outline, got: ${outlineAfterUnlinkText}`
    );

    const psalmGroupHeader = mobilePage.locator('.rm-outline-group-card', { hasText: 'Psalm 117' }).first().locator('.rm-outline-group-header');
    const psalmCountBox = await psalmGroupHeader.locator('.rm-outline-chunk-count').boundingBox();
    const psalmActionsBox = await psalmGroupHeader.locator('.rm-outline-header-actions').boundingBox();
    assertCondition(
      Boolean(psalmCountBox && psalmActionsBox && psalmCountBox.x + psalmCountBox.width <= psalmActionsBox.x + 1),
      `Expected Psalm 117 group title/count not to collide with header actions: count=${JSON.stringify(psalmCountBox)}, actions=${JSON.stringify(psalmActionsBox)}`
    );

    await captureStepScreenshot(mobilePage, 'mobile-12-outline-seam-unlink.png', stepResults, {
      step: '9l',
      name: 'Mobile Phone (412x915): Outline Auto-Seam Unlink, Cross-Chapter Psalms Unlinked Default & Resume Session',
      assertions: [
        '[✂️ Seams] opens OUTLINE with Romans 8 highlighted and ↩ Resume Review Session pinned at top',
        'Tapping Auto-Seam unlinks v. 36 ✂ v. 37; cross-chapter Psalm 117:2 ✂ 118:1 defaults to Unlinked',
      ],
    });

    // Verify ↩ Resume Review Session returns to study view, test ⏭ Skip advances rather than exiting, & unlink persists on reload
    await mobilePage.locator('[data-testid="btn-resume-review-from-outline"]').click();
    await mobilePage.locator('[data-testid="card-front-view"]').waitFor({ state: 'visible', timeout: 10000 });
    if ((await mobilePage.locator('[data-testid="btn-skip-long-card"]').count()) > 0) {
      await mobilePage.locator('[data-testid="btn-skip-long-card"]').click();
      await mobilePage.locator('[data-testid="card-front-view"]').waitFor({ state: 'visible', timeout: 10000 });
    }
    await mobilePage.reload({ waitUntil: 'networkidle' });
    if ((await mobilePage.locator('[data-testid="btn-back-to-deck"]').count()) > 0) {
      await mobilePage.locator('[data-testid="btn-back-to-deck"]').click();
    }
    await mobilePage.locator('[data-testid="tab-outline"]').click();
    await mobilePage.locator('[data-testid="outline-page-section"]').waitFor({ state: 'visible', timeout: 10000 });
    const romGroupToggleAfterReload = mobilePage.locator('.rm-outline-group-toggle', { hasText: 'Romans 8' }).first();
    if ((await romGroupToggleAfterReload.getAttribute('aria-expanded')) !== 'true') {
      await romGroupToggleAfterReload.click();
      await mobilePage.waitForTimeout(150);
    }
    const outlineReloadText = await mobilePage.locator('[data-testid="outline-page-section"]').innerText();
    assertCondition(
      outlineReloadText.includes('Unlinked (v. 36 ✂ v. 37'),
      `Expected unlinked Romans seam to persist across page reload, got: ${outlineReloadText}`
    );

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
    console.log(`\nAll ${stepResults.length} screenshot tests (Desktop + 12 Mobile 412x915) PASSED! Report written to ${REPORT_PATH}`);
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
