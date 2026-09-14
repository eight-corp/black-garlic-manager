const assert = require('node:assert/strict');
const path = require('node:path');

async function testGraphRotation(browser, scenario, unlocked, view = 'graph') {
  const storage = view === 'storageGraph';
  const prefix = storage ? 'storageGraph' : 'graph';
  const graphId = storage ? 'storageGraphSummary' : 'summaryGraph';
  const canvasId = storage ? 'storageSummaryChart' : 'summaryChart';
  for (const mode of ['supported', 'denied', 'missing', 'lock-denied', 'pending-lock', 'pending-fullscreen', 'desktop']) {
    const { context, backend, page } = await scenario(browser, { mobile: mode !== 'desktop' });
    try {
      await context.addInitScript(mode => {
        const trace = window.rotationTest = { requests: [], locks: [], unlocks: 0, policy: 'default' };
        const requestFullscreen = HTMLElement.prototype.requestFullscreen;
        if (mode === 'missing') {
          Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', { configurable: true, value: undefined });
          Object.defineProperty(screen, 'orientation', { configurable: true, value: undefined });
          return;
        }
        HTMLElement.prototype.requestFullscreen = function (options) {
          trace.requests.push(this.id);
          if (mode === 'denied') return Promise.reject(new DOMException('Not allowed', 'NotAllowedError'));
          const result = requestFullscreen.call(this, options);
          if (mode === 'pending-fullscreen') return result.then(() => new Promise(resolve => window.completeFullscreenRequest = resolve));
          return result;
        };
        let rejectLock;
        screen.orientation.lock = type => {
          trace.locks.push(type);
          if (mode === 'lock-denied') return Promise.reject(new DOMException('Not supported', 'NotSupportedError'));
          if (mode === 'pending-lock') return new Promise((resolve, reject) => {
            window.completeOrientationRequest = resolve;
            rejectLock = reject;
          });
          trace.policy = type;
          return Promise.resolve();
        };
        screen.orientation.unlock = () => {
          trace.unlocks++;
          trace.policy = 'default';
          if (rejectLock) rejectLock(new DOMException('Canceled', 'AbortError'));
        };
      }, mode);
      await page.goto('https://eight-corp.github.io/black-garlic-manager/');
      await unlocked(page);
      await page.locator('[data-tab="summary"]').click();
      await page.locator('[data-summary-view="' + view + '"]').click();
      await page.locator('#' + prefix + 'StartDate').fill('2026-09-10');
      await page.locator('#' + prefix + 'EndDate').fill('2026-09-12');
      await page.locator('#' + prefix + 'RefreshBtn').click();
      const reads = backend.reads.length;
      await page.locator('#' + prefix + 'FullscreenBtn').click();
      if (['supported', 'lock-denied', 'pending-lock', 'pending-fullscreen'].includes(mode)) {
        await page.waitForFunction(id => document.fullscreenElement?.id === id, graphId);
        if (mode !== 'pending-fullscreen') await page.waitForFunction(() => window.rotationTest.locks.length === 1);
      }
      assert.equal(await page.locator('#graphFullscreenDialog').evaluate(dialog => dialog.open), true);
      for (const [width, height] of [[390, 844], [844, 390], [390, 844], [844, 390]]) {
        await page.setViewportSize({ width, height });
        await page.evaluate(() => {
          window.dispatchEvent(new Event('orientationchange'));
          screen.orientation?.dispatchEvent(new Event('change'));
          visualViewport?.dispatchEvent(new Event('resize'));
        });
        await page.waitForFunction(id => {
          const canvas = document.getElementById(id);
          const bounds = canvas.getBoundingClientRect();
          const host = document.fullscreenElement || document.querySelector('#graphFullscreenDialog');
          const frame = host.getBoundingClientRect();
          return Math.abs(frame.width - innerWidth) < 1 && Math.abs(frame.height - innerHeight) < 1 && bounds.width >= innerWidth - 20 && bounds.width <= innerWidth && bounds.height > 120 && bounds.bottom <= innerHeight - 7 && host.scrollWidth <= innerWidth;
        }, canvasId, { timeout: 10000 });
        assert.deepEqual(await page.locator('#' + canvasId).evaluate(canvas => Chart.getChart(canvas).data.datasets.map(dataset => dataset.data)), storage ? [[null, 4.5, 4.5], [null, 4.5, 4.5]] : [[0, 10, 0], [0, 2, 0], [0, 8, 8]]);
        assert.ok(await page.locator('#' + canvasId).evaluate(canvas => {
          const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
          let colorful = 0;
          for (let i = 0; i < pixels.length; i += 4) {
            if (pixels[i + 3] > 100 && Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) - Math.min(pixels[i], pixels[i + 1], pixels[i + 2]) > 40) colorful++;
          }
          return colorful > 100;
        }));
      }
      const trace = await page.evaluate(() => window.rotationTest);
      assert.deepEqual(trace.requests, ['desktop', 'missing'].includes(mode) ? [] : [graphId]);
      assert.deepEqual(trace.locks, ['supported', 'lock-denied', 'pending-lock'].includes(mode) ? ['any'] : []);
      if (mode === 'supported') assert.equal(trace.policy, 'any');
      if (process.env.QA_ARTIFACTS) await page.screenshot({ path: path.join(process.env.QA_ARTIFACTS, 'graph-rotation-' + (storage ? 'storage-' : '') + mode + '-landscape.png') });
      if (mode === 'supported') await page.evaluate(() => document.exitFullscreen());
      else await page.locator('#' + prefix + 'FullscreenBtn').click();
      await page.waitForFunction(() => !document.fullscreenElement && !document.querySelector('#graphFullscreenDialog').open);
      await page.evaluate(() => {
        window.completeOrientationRequest?.();
        window.completeFullscreenRequest?.();
      });
      await page.waitForFunction(id => document.querySelector('#summaryPanel').contains(document.getElementById(id)) && !document.body.classList.contains('graph-fullscreen-active'), graphId);
      await page.locator('[data-tab="main"]').click();
      await page.evaluate(() => window.dispatchEvent(new Event('orientationchange')));
      const after = await page.evaluate(() => window.rotationTest);
      assert.deepEqual(after.requests, trace.requests);
      assert.deepEqual(after.locks, trace.locks);
      assert.equal(after.unlocks, ['supported', 'lock-denied', 'pending-lock'].includes(mode) ? 1 : 0);
      assert.equal(after.policy, 'default');
      assert.equal(backend.reads.length, reads);
      assert.equal(backend.writes.length, 0);
      assert.deepEqual(backend.errors, []);
    } finally {
      await context.close();
    }
  }
  return true;
}

module.exports = testGraphRotation;
if (require.main === module) {
  const { chromium } = require('playwright');
  const { scenario, unlocked } = require('./common-auth.cjs');
  (async () => {
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    try {
      await testGraphRotation(browser, scenario, unlocked);
      console.log(JSON.stringify({ fullscreenGraphPortraitLandscapeRotationScopedNativeExitFallbackAndPendingCleanup: true, databaseWritesAreMocked: true, source: process.env.USE_PUBLISHED_SOURCE ? 'published' : 'local' }));
    } finally { await browser.close(); }
  })().catch(error => { console.error(error); process.exitCode = 1; });
}
