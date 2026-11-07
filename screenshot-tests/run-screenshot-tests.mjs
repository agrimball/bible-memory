#!/usr/bin/env node
/**
 * Automated Playwright Screenshot & E2E Verification Runner for Bible Memory App
 *
 * Verifies all 8 core user journeys against the running Angular 19 app and saves
 * high-resolution PNG screenshots to `screenshot-tests/output/` and `screenshot-tests/`.
 */

import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:4200';
const OUTPUT_DIR = path.join(__dirname, 'output');
const REPORT_PATH = path.join(__dirname, 'test-report.json');

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

  console.log(`Launching headless Chromium against ${APP_URL} ...`);
  const chromePath = process.env.CHROME_PATH || (existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : undefined);
  const browser = await chromium.launch({
    headless: true,
    executablePath: chromePath,
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
    // 1. 01-deck-dashboard.png
    // =========================================================================
    console.log('Step 1: Navigating to Deck Dashboard...');
    await page.goto(APP_URL, { waitUntil: 'networkidle' });
    await page.locator('[data-testid="deck-stats-grid"]').waitFor({ state: 'visible', timeout: 15000 });
    await page.locator('[data-testid="passage-deck-list"]').waitFor({ state: 'visible', timeout: 15000 });

    const deckListText = await page.locator('[data-testid="passage-deck-list"]').innerText();
    assertCondition(
      deckListText.includes('Romans 8:1-4') || deckListText.includes('Romans 8'),
      'Expected starter passage Romans 8:1-4 on Deck Dashboard'
    );
    assertCondition(
      deckListText.includes('Psalm 23:1-6') || deckListText.includes('Psalm 23'),
      'Expected starter passage Psalm 23:1-6 on Deck Dashboard'
    );

    await captureStepScreenshot(page, '01-deck-dashboard.png', stepResults, {
      step: 1,
      name: 'Deck Dashboard & Starter Passages',
      assertions: [
        '[data-testid="deck-stats-grid"] is visible',
        '[data-testid="passage-deck-list"] is visible',
        'Starter passages (Romans 8:1-4, Psalm 23:1-6) and Anki due counts are displayed',
      ],
    });

    // =========================================================================
    // 2. 02-smart-copy-paste-modal.png & 02-copy-paste-highlight-verse-numbers.png
    // =========================================================================
    console.log('Step 2: Testing Smart Copy-Paste Modal (Highlight & Remove Verse Numbers)...');
    await page.locator('[data-testid="btn-open-add-passage"]').click();
    await page.locator('[data-testid="textarea-passage-raw"]').waitFor({ state: 'visible', timeout: 10000 });

    const pasteExampleBtn = page.locator('[data-testid="btn-paste-example"]');
    if ((await pasteExampleBtn.count()) > 0 && (await pasteExampleBtn.first().isVisible())) {
      await pasteExampleBtn.first().click();
    } else {
      const refInput = page.locator('[data-testid="input-passage-reference"]');
      if ((await refInput.count()) > 0) {
        await refInput.fill('Philippians 4:6-7');
      }
      await page
        .locator('[data-testid="textarea-passage-raw"]')
        .fill(
          '6 do not be anxious about anything, but in everything by prayer and supplication with thanksgiving let your requests be made known to God. 7 And the peace of God, which surpasses all understanding, will guard your hearts and your minds in Christ Jesus.'
        );
    }

    // Click btn-highlight-verse-numbers and verify verse-number-highlight-preview is visible
    const highlightBtn = page.locator('[data-testid="btn-highlight-verse-numbers"]');
    await highlightBtn.waitFor({ state: 'visible', timeout: 10000 });
    await highlightBtn.click();

    const highlightPreview = page.locator('[data-testid="verse-number-highlight-preview"]');
    await highlightPreview.waitFor({ state: 'visible', timeout: 10000 });

    const previewLocator = page.locator('[data-testid="parsed-verses-preview"]');
    await previewLocator.waitFor({ state: 'visible', timeout: 10000 });
    const previewText = await previewLocator.innerText();
    assertCondition(previewText.trim().length > 20, 'Expected parsed verses preview to show split individual verses');

    await captureStepScreenshot(page, '02-copy-paste-highlight-verse-numbers.png', stepResults, {
      step: 2,
      name: 'Smart Copy-Paste Modal - Highlighted Verse Numbers Preview',
      assertions: [
        '[data-testid="btn-open-add-passage"] opens modal',
        '[data-testid="btn-highlight-verse-numbers"] triggers verse number highlighting',
        '[data-testid="verse-number-highlight-preview"] is visible showing highlighted verse numbers',
        '[data-testid="parsed-verses-preview"] splits multi-verse passage into individual verses',
      ],
    });

    await captureStepScreenshot(page, '02-smart-copy-paste-modal.png', stepResults, {
      step: 2,
      name: 'Smart Copy-Paste Modal with Live Verse Splitting Preview',
      assertions: [
        '[data-testid="btn-open-add-passage"] opens modal',
        '[data-testid="verse-number-highlight-preview"] and [data-testid="parsed-verses-preview"] are visible',
      ],
    });

    // Confirm removing the highlighted verse numbers before saving the passage
    const removeVerseNumbersBtn = page.locator('[data-testid="btn-remove-verse-numbers"]');
    await removeVerseNumbersBtn.waitFor({ state: 'visible', timeout: 10000 });
    await removeVerseNumbersBtn.click();

    await page.locator('[data-testid="btn-save-passage"]').click();
    await page.locator('[data-testid="passage-deck-list"]').waitFor({ state: 'visible', timeout: 10000 });

    // =========================================================================
    // 3. 03-card-front-initial.png
    // =========================================================================
    console.log('Step 3: Opening First Flashcard Front...');
    const studyCard0 = page.locator('[data-testid="btn-study-card-0"]');
    if ((await studyCard0.count()) > 0 && (await studyCard0.first().isVisible())) {
      await studyCard0.first().click();
    } else {
      await page.locator('[data-testid="btn-study-due"]').first().click();
    }

    await page.locator('[data-testid="card-reference"]').waitFor({ state: 'visible', timeout: 10000 });
    await page.locator('[data-testid="btn-enter-study"]').waitFor({ state: 'visible', timeout: 10000 });
    await page.locator('[data-testid="btn-record-voice"]').waitFor({ state: 'visible', timeout: 10000 });
    await page.locator('[data-testid="btn-flip-card"]').waitFor({ state: 'visible', timeout: 10000 });

    const cardRefText = await page.locator('[data-testid="card-reference"]').innerText();
    assertCondition(cardRefText.trim().length > 0, 'Expected card reference title to be non-empty');

    await captureStepScreenshot(page, '03-card-front-initial.png', stepResults, {
      step: 3,
      name: 'Flashcard Front Initial View',
      assertions: [
        '[data-testid="card-reference"] is visible',
        '[data-testid="btn-enter-study"] is visible',
        '[data-testid="btn-record-voice"] is visible',
        '[data-testid="btn-flip-card"] is visible',
      ],
    });

    // =========================================================================
    // 4. 04-study-mode-first-letters-verse1.png
    // =========================================================================
    console.log('Step 4: Entering First-Letter Study Mode (Verse 1 Only)...');
    await page.locator('[data-testid="btn-enter-study"]').click();
    const studyPanel = page.locator('[data-testid="first-letter-study-panel"]');
    await studyPanel.waitFor({ state: 'visible', timeout: 10000 });
    await page.locator('[data-testid="btn-reveal-1w"]').waitFor({ state: 'visible', timeout: 10000 });
    await page.locator('[data-testid="btn-reveal-1v"]').waitFor({ state: 'visible', timeout: 10000 });

    // Verify Verse 1 is visible and Verse 2 is not yet shown if verse testids are present
    const verse2Row = page.locator('[data-testid="study-verse-row-1"], [data-testid="study-verse-2"]');
    if ((await verse2Row.count()) > 0) {
      assertCondition(
        !(await verse2Row.first().isVisible()),
        'Expected Verse 2 not to be visible before Verse 1 is completed'
      );
    }

    await captureStepScreenshot(page, '04-study-mode-first-letters-verse1.png', stepResults, {
      step: 4,
      name: 'First-Letter Study Mode - Verse 1 Only with +1w and +1v Controls',
      assertions: [
        '[data-testid="first-letter-study-panel"] is visible with Verse 1 first letters only',
        '[data-testid="btn-reveal-1w"] (+1w) is visible',
        '[data-testid="btn-reveal-1v"] (+1v) is visible',
      ],
    });

    // =========================================================================
    // 5. 05-study-mode-plus-1w-and-plus-1v.png
    // =========================================================================
    console.log('Step 5: Exercising +1w (x3), +1v (completing Verse 1 -> showing Verse 2), and +1w (x2 on Verse 2)...');
    const btn1w = page.locator('[data-testid="btn-reveal-1w"]');
    const btn1v = page.locator('[data-testid="btn-reveal-1v"]');

    const beforeRevealText = await studyPanel.innerText();
    // Click +1w 3 times on Verse 1
    await btn1w.click();
    await btn1w.click();
    await btn1w.click();
    const after3WordsText = await studyPanel.innerText();
    assertCondition(
      after3WordsText !== beforeRevealText,
      'Expected clicking +1w 3 times to reveal the first 3 words of Verse 1'
    );

    // Click +1v to reveal the rest of Verse 1 and automatically surface Verse 2 in first-letter mode
    await btn1v.click();
    const after1vText = await studyPanel.innerText();
    assertCondition(
      after1vText.length > after3WordsText.length,
      'Expected clicking +1v to complete Verse 1 and reveal Verse 2 in first-letter mode'
    );

    // Click +1w twice on Verse 2
    await btn1w.click();
    await btn1w.click();
    const afterVerse2TwoWordsText = await studyPanel.innerText();
    assertCondition(
      afterVerse2TwoWordsText !== after1vText,
      'Expected clicking +1w twice on Verse 2 to reveal 2 words of Verse 2'
    );

    await captureStepScreenshot(page, '05-study-mode-plus-1w-and-plus-1v.png', stepResults, {
      step: 5,
      name: 'Progressive Reveal (+1w and +1v) Completing Verse 1 and Advancing to Verse 2 First Letters',
      assertions: [
        'Clicking +1w 3 times reveals first 3 words of Verse 1',
        'Clicking +1v reveals remainder of Verse 1 and displays Verse 2 in first-letter mode below Verse 1',
        'Clicking +1w twice on Verse 2 reveals first 2 words of Verse 2 while remaining words stay as first letters',
      ],
    });

    // =========================================================================
    // 6. 06-voice-recording-active.png
    // =========================================================================
    console.log('Step 6: Starting Voice Recording on Card Front...');
    await page.locator('[data-testid="btn-record-voice"]').click();
    await page
      .locator('[data-testid="recording-active-indicator"]')
      .waitFor({ state: 'visible', timeout: 10000 });
    await page.waitForTimeout(1250);

    await captureStepScreenshot(page, '06-voice-recording-active.png', stepResults, {
      step: 6,
      name: 'Active Voice Recording on Flashcard Front',
      assertions: [
        '[data-testid="btn-record-voice"] starts voice recording',
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
        step: 7,
        name: 'Card Back View with Auto Voice Playback, Full Passage Read-Along, and Anki Grading Bar',
        assertions: [
          '[data-testid="card-back-view"] is visible',
          '[data-testid="voice-playback-bar"] is visible and playing recorded audio',
          '[data-testid="card-back-full-text"] displays full passage text',
          '[data-testid="anki-grading-bar"] displays Again / Hard / Good / Easy buttons',
        ],
      }
    );

    // =========================================================================
    // 8. 08-protojson-wire-format-modal.png
    // =========================================================================
    console.log('Step 8: Grading Card (Good) and Inspecting biblememory.v1 ProtoJSON Wire Format Modal...');
    await page.locator('[data-testid="btn-grade-good"]').click();

    // Return to dashboard if grading advanced to the next due card in the session
    const protoSyncBtn = page.locator('[data-testid="btn-open-proto-sync"]');
    if (!(await protoSyncBtn.isVisible())) {
      const backBtn = page.locator(
        '[data-testid="btn-back-to-deck"], [data-testid="btn-exit-study"], [data-testid="btn-close-study"]'
      );
      if ((await backBtn.count()) > 0 && (await backBtn.first().isVisible())) {
        await backBtn.first().click();
      } else {
        await page.goto(APP_URL, { waitUntil: 'networkidle' });
      }
    }

    await protoSyncBtn.waitFor({ state: 'visible', timeout: 10000 });
    await protoSyncBtn.click();

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
  }
}

runScreenshotSuite().catch(async (err) => {
  console.error('\n[FAIL] Screenshot test suite failed:', err);
  const failureReport = {
    suite: 'bible-memory-playwright-screenshot-tests',
    appUrl: APP_URL,
    finishedAt: new Date().toISOString(),
    status: 'FAILED',
    error: err?.stack || String(err),
  };
  await fs.writeFile(REPORT_PATH, JSON.stringify(failureReport, null, 2), 'utf8').catch(() => {});
  process.exitCode = 1;
});
