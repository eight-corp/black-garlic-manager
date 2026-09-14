const assert = require('node:assert/strict');
const path = require('node:path');

async function testCompactGraph(browser, scenario, unlocked) {
  const { page, context, backend } = await scenario(browser, { mobile: true });
  try {
    await page.goto('https://eight-corp.github.io/black-garlic-manager/');
    await unlocked(page);
    await page.locator('[data-tab="summary"]').click();
    await page.locator('[data-summary-view="graph"]').click();
    await page.locator('#graphType').selectOption('type');
    await page.locator('#graphRoom').selectOption('room');
    await page.locator('#graphStartDate').fill('2026-09-10');
    await page.locator('#graphEndDate').fill('2026-09-12');
    await page.locator('#graphRefreshBtn').click();
    const reads = backend.reads.length;
    for (const width of [320, 360, 390, 760, 761, 844, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      await page.waitForFunction(() => {
        const bounds = document.querySelector('#summaryChart').getBoundingClientRect();
        return bounds.width >= innerWidth - 20 && bounds.width <= innerWidth;
      });
      assert.ok(await page.locator('.actual-graph-toolbar').evaluate((toolbar, compact) => {
        const bounds = toolbar.getBoundingClientRect();
        const ids = ['graphType', 'graphRoom', 'graphStartDate', 'graphEndDate', 'graphRefreshBtn', 'graphFullscreenBtn'];
        const controls = ids.map(id => document.getElementById(id).getBoundingClientRect());
        const dateValues = [...toolbar.querySelectorAll('.graph-date-display > span')];
        const datesFit = dateValues.every(value => {
          const text = value.getBoundingClientRect();
          const icon = value.nextElementSibling.getBoundingClientRect();
          const field = value.parentElement.getBoundingClientRect();
          return value.scrollWidth <= value.clientWidth && text.left >= field.left && text.right <= icon.left && icon.right <= field.right;
        });
        return document.documentElement.scrollWidth <= innerWidth && toolbar.scrollWidth <= toolbar.clientWidth &&
          controls.every((frame, index) => frame.width >= 26 && frame.left >= bounds.left && frame.right <= bounds.right + 1 && frame.height >= 34 &&
            (!compact || (Math.abs(frame.top - controls[0].top) < 1 && (!index || frame.left >= controls[index - 1].right)))) &&
          (!compact || datesFit) && getComputedStyle(document.getElementById('graphStartDate')).opacity === (compact ? '0' : '1');
      }, true), 'Graph toolbar must fit at width ' + width);
      assert.deepEqual(await page.locator('#summaryChart').evaluate(canvas => Chart.getChart(canvas).data.datasets.map(dataset => dataset.data)), [[0, 10, 0], [0, 2, 0], [0, 8, 8], [null, null, null]]);
      assert.equal(await page.locator('#graphStartDateText').textContent(), '26/09/10');
      assert.equal(await page.locator('#graphEndDateText').textContent(), '26/09/12');
      if (process.env.QA_ARTIFACTS && [320, 390, 1280].includes(width)) {
        await page.screenshot({ path: path.join(process.env.QA_ARTIFACTS, 'graph-compact-toolbar-' + width + '.png') });
      }
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => {
      window.graphPickerTargets = [];
      for (const id of ['graphStartDate', 'graphEndDate']) {
        document.getElementById(id).showPicker = () => window.graphPickerTargets.push(id);
      }
    });
    for (const id of ['graphStartDate', 'graphEndDate']) await page.locator('#' + id).click({ position: { x: 5, y: 17 } });
    assert.deepEqual(await page.evaluate(() => window.graphPickerTargets), ['graphStartDate', 'graphEndDate']);
    for (const [start, end, values] of [
      ['2024-02-29', '2024-03-01', ['24/02/29', '24/03/01']],
      ['2025-12-31', '2026-01-01', ['25/12/31', '26/01/01']]
    ]) {
      await page.locator('#graphStartDate').fill(start);
      await page.locator('#graphEndDate').fill(end);
      assert.deepEqual(await page.locator('.graph-date-display > span').allTextContents(), values);
      assert.equal(await page.locator('#graphStartDate').inputValue(), start);
      assert.equal(await page.locator('#graphEndDate').inputValue(), end);
    }
    await page.locator('[data-tab="prediction"]').click();
    assert.equal(await page.locator('#predictionStartDate').evaluate(input => getComputedStyle(input).opacity), '1');
    assert.equal(backend.reads.length, reads);
    assert.equal(backend.writes.length, 0);
    assert.deepEqual(backend.errors, []);
  } finally { await context.close(); }
  const desktop = await scenario(browser);
  try {
    await desktop.page.goto('https://eight-corp.github.io/black-garlic-manager/');
    await unlocked(desktop.page);
    await desktop.page.locator('[data-tab="summary"]').click();
    await desktop.page.locator('[data-summary-view="graph"]').click();
    for (const width of [761, 1280]) {
      await desktop.page.setViewportSize({ width, height: 844 });
      assert.equal(await desktop.page.locator('#graphStartDate').evaluate(input => getComputedStyle(input).opacity), '1');
      assert.equal(await desktop.page.locator('.graph-date-display').first().isVisible(), false);
      assert.ok(await desktop.page.evaluate(() => document.getElementById('graphStartDate').getBoundingClientRect().top > document.getElementById('graphType').getBoundingClientRect().bottom));
    }
    assert.equal(desktop.backend.writes.length, 0);
    assert.deepEqual(desktop.backend.errors, []);
  } finally { await desktop.context.close(); }
  return true;
}

module.exports = testCompactGraph;
if (require.main === module) {
  const { chromium } = require('playwright');
  const { scenario, unlocked } = require('./common-auth.cjs');
  (async () => {
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    try {
      await testCompactGraph(browser, scenario, unlocked);
      console.log(JSON.stringify({ compactActualGraphSingleRowDatePickerFullDateLeapAndYearLabelsResponsiveAndNoWrites: true, databaseWritesAreMocked: true, source: process.env.USE_PUBLISHED_SOURCE ? 'published' : 'local' }));
    } finally { await browser.close(); }
  })().catch(error => { console.error(error); process.exitCode = 1; });
}
