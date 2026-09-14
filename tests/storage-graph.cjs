const assert = require('node:assert/strict');
const path = require('node:path');

async function testStorageGraph(browser, scenario, unlocked) {
  const { page, context, backend } = await scenario(browser, { mobile: true });
  const url = 'https://eight-corp.github.io/black-garlic-manager/';
  const template = backend.db.black_garlic_storage_entries[0];
  backend.db.black_garlic_storage_types[0].display_order = 1;
  backend.db.black_garlic_storage_types.push(
    { id: 'storage-2', type_name: '\u9078\u5225(\u826f)', active: true, display_order: 2 },
    { id: 'storage-3', type_name: '\u3080\u304d\u9ed2', active: true, display_order: 3 },
    { id: 'storage-hidden', type_name: 'Hidden', active: false, display_order: 4 }
  );
  for (const [id, date, type, columns, pieces, time] of [
    ['prior', '2026-09-08', 'storage', 10, 0, '03:00:00'],
    ['other', '2026-09-10', 'storage-2', 2, 8, '03:00:00'],
    ['older-same-day', '2026-09-11', 'storage', 6, 0, '02:00:00'],
    ['hidden', '2026-09-10', 'storage-hidden', 500, 0, '03:00:00'],
    ['future', '2026-09-13', 'storage', 900, 0, '03:00:00']
  ]) backend.db.black_garlic_storage_entries.push({
    ...template, id, storage_date: date, recorded_at: date + 'T' + time + 'Z',
    storage_type_id: type, columns16: columns, pieces
  });
  const original = JSON.stringify(backend.db);
  const data = () => page.locator('#storageSummaryChart').evaluate(canvas => Chart.getChart(canvas).data.datasets[0].data);
  async function period(start, end) {
    await page.locator('#storageGraphStartDate').fill(start);
    await page.locator('#storageGraphEndDate').fill(end);
    await page.locator('#storageGraphRefreshBtn').click();
  }
  try {
    await page.goto(url); await unlocked(page);
    await page.locator('[data-tab="summary"]').click();
    await page.locator('[data-summary-view="graph"]').click();
    await page.locator('#graphStartDate').fill('2026-09-10');
    await page.locator('#graphEndDate').fill('2026-09-12');
    await page.locator('#graphRefreshBtn').click();
    const roomData = await page.locator('#summaryChart').evaluate(canvas => Chart.getChart(canvas).data.datasets.map(dataset => dataset.data));
    await page.locator('[data-summary-view="storageGraph"]').click();
    assert.equal(await page.locator('#summaryGraph').isVisible(), false);
    assert.equal(await page.locator('#storageGraphSummary').isVisible(), true);
    assert.equal(await page.locator('.main-summary-controls').isVisible(), false);
    assert.equal(await page.locator('#summaryMetricControls').isVisible(), false);
    assert.equal(await page.locator('#summaryPanel .summary-view:visible').count(), 1);
    assert.equal(await page.locator('#storageGraphStyle').inputValue(), 'line');
    assert.deepEqual(await page.locator('#storageGraphType option').evaluateAll(options => options.map(option => option.value)), ['All', 'storage', 'storage-2', 'storage-3']);
    const reads = backend.reads.length;
    await period('2026-09-09', '2026-09-13');
    assert.deepEqual(await data(), [10, 12.5, 7, 7, null]);
    assert.equal(await page.locator('#storageGraphStatus').isVisible(), false);
    assert.equal(await page.locator('#storageGraphPrintTitle').isVisible(), false);
    assert.ok(await page.locator('#storageSummaryChart').evaluate(canvas => {
      const chart = Chart.getChart(canvas);
      const dataset = chart.data.datasets[0];
      return dataset.borderColor === '#28a745' && chart.options.scales.y.title.text === '\u4fdd\u7ba1\u6570(\u5217)' &&
        chart.options.plugins.tooltip.callbacks.label({ formattedValue: '7' }) === '\u4fdd\u7ba1\u6570: 7\u5217';
    }));
    for (const [type, expected] of [
      ['storage', [10, 10, 4.5, 4.5, null]],
      ['storage-2', [null, 2.5, 2.5, 2.5, null]],
      ['storage-3', [null, null, null, null, null]],
      ['All', [10, 12.5, 7, 7, null]]
    ]) {
      await page.locator('#storageGraphType').selectOption(type);
      assert.deepEqual(await data(), expected);
      assert.equal(await page.locator('#storageGraphStatus').isVisible(), type === 'storage-3');
    }
    for (const style of ['bar', 'line']) {
      await page.locator('#storageGraphStyle').selectOption(style);
      assert.equal(await page.locator('#storageSummaryChart').evaluate(canvas => Chart.getChart(canvas).getDatasetMeta(0).type), style);
      assert.deepEqual(await data(), [10, 12.5, 7, 7, null]);
    }
    for (const width of [320, 360, 390, 760, 761, 844, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      await page.waitForFunction(() => {
        const canvas = document.querySelector('#storageSummaryChart');
        const frame = canvas.getBoundingClientRect();
        return frame.width >= innerWidth - 20 && frame.width <= innerWidth && frame.height > 200 &&
          frame.bottom <= document.querySelector('.summary-bottom-tabs').getBoundingClientRect().top + 1 && document.documentElement.scrollWidth <= innerWidth;
      });
      assert.ok(await page.locator('.storage-graph-toolbar').evaluate(toolbar => {
        const fields = [...toolbar.querySelectorAll('select,input,button')].map(field => field.getBoundingClientRect());
        const bounds = toolbar.getBoundingClientRect();
        const dates = [...toolbar.querySelectorAll('.graph-date-display > span')];
        return toolbar.scrollWidth <= toolbar.clientWidth && fields.every((frame, index) => frame.width >= 26 &&
          frame.left >= bounds.left && frame.right <= bounds.right + 1 && Math.abs(frame.top - fields[0].top) < 1 && (!index || frame.left >= fields[index - 1].right)) &&
          dates.every(date => date.scrollWidth <= date.clientWidth);
      }), 'Storage toolbar at width ' + width);
      assert.ok(await page.locator('.summary-bottom-tabs').evaluate(nav => [...nav.querySelectorAll('button')].every(button => {
        const frame = button.getBoundingClientRect();
        return button.scrollWidth <= button.clientWidth && button.scrollHeight <= button.clientHeight &&
          document.elementFromPoint(frame.left + frame.width / 2, frame.top + frame.height / 2)?.closest('button') === button;
      })), 'Six tabs at width ' + width);
      assert.ok(await page.locator('#storageSummaryChart').evaluate(canvas => {
        const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
        let green = 0;
        for (let index = 0; index < pixels.length; index += 4) {
          if (Math.abs(pixels[index] - 40) < 3 && Math.abs(pixels[index + 1] - 167) < 3 && Math.abs(pixels[index + 2] - 69) < 3 && pixels[index + 3] > 100) green++;
        }
        return green > 100 && Chart.getChart(canvas).getDatasetMeta(0).data[4].skip;
      }));
      if (process.env.QA_ARTIFACTS && [320, 390, 1280].includes(width)) await page.screenshot({ path: path.join(process.env.QA_ARTIFACTS, 'storage-graph-' + width + '.png') });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => {
      window.storagePickerTargets = [];
      for (const id of ['storageGraphStartDate', 'storageGraphEndDate']) document.getElementById(id).showPicker = () => window.storagePickerTargets.push(id);
    });
    for (const id of ['storageGraphStartDate', 'storageGraphEndDate']) await page.locator('#' + id).click({ position: { x: 5, y: 17 } });
    assert.deepEqual(await page.evaluate(() => window.storagePickerTargets), ['storageGraphStartDate', 'storageGraphEndDate']);
    await page.locator('[data-summary-view="graph"]').click();
    assert.equal(await page.locator('#graphStartDate').inputValue(), '2026-09-10');
    assert.equal(await page.locator('#graphEndDate').inputValue(), '2026-09-12');
    assert.deepEqual(await page.locator('#summaryChart').evaluate(canvas => Chart.getChart(canvas).data.datasets.map(dataset => dataset.data)), roomData);
    await page.locator('[data-summary-view="storageGraph"]').click();
    assert.equal(await page.locator('#storageGraphStartDate').inputValue(), '2026-09-09');
    assert.equal(await page.locator('#storageGraphEndDate').inputValue(), '2026-09-13');
    await page.locator('#storageGraphFullscreenBtn').click();
    await page.emulateMedia({ media: 'print' });
    await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
    assert.equal(await page.locator('#graphFullscreenDialog').evaluate(dialog => dialog.open), false);
    assert.equal(await page.locator('#summaryPanel #storageGraphSummary').count(), 1);
    assert.equal(await page.locator('#storageGraphPrintTitle').isVisible(), true);
    assert.equal(await page.locator('#storageGraphPrintTitle').textContent(), '\u30b0\u30e9\u30d5(\u4fdd\u7ba1\u5eab) \u5168\u4f53 2026-09-09\u301c2026-09-13');
    assert.equal(await page.locator('#summaryPanel .summary-view:visible').count(), 1);
    assert.equal(await page.locator('#summaryPanel canvas:visible').count(), 1);
    assert.equal(await page.locator('.summary-bottom-tabs').isVisible(), false);
    assert.ok(await page.locator('#storageSummaryChart').evaluate(canvas => canvas.getBoundingClientRect().height > 400));
    await page.emulateMedia({ media: 'screen' });
    await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
    await period('2026-09-13', '2026-09-15');
    assert.deepEqual(await data(), [null, null, null]);
    await period('2024-02-29', '2024-03-01');
    assert.deepEqual(await data(), [null, null]);
    assert.equal(await page.locator('#storageGraphStartDateText').textContent(), '24/02/29');
    assert.equal(await page.locator('#storageGraphEndDateText').textContent(), '24/03/01');
    assert.equal(backend.reads.length, reads);
    assert.equal(backend.writes.length, 0);
    assert.equal(JSON.stringify(backend.db), original);
    template.columns16 = 1;
    template.pieces = 4;
    await page.locator('#reloadBtn').click();
    await page.waitForFunction(() => !document.querySelector('#reloadBtn').disabled);
    await period('2026-09-11', '2026-09-12');
    assert.deepEqual(await data(), [3.75, 3.75]);
    assert.equal(backend.writes.length, 0);
    assert.deepEqual(backend.errors, []);
  } finally { await context.close(); }
  return true;
}

module.exports = testStorageGraph;
if (require.main === module) {
  const { chromium } = require('playwright');
  const { scenario, unlocked } = require('./common-auth.cjs');
  (async () => {
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    try {
      await testStorageGraph(browser, scenario, unlocked);
      await require('./graph-rotation.cjs')(browser, scenario, unlocked, 'storageGraph');
      console.log(JSON.stringify({ storageGraph: true, storageGraphRotation: true, databaseWritesAreMocked: true, source: process.env.USE_PUBLISHED_SOURCE ? 'published' : 'local' }));
    } finally { await browser.close(); }
  })().catch(error => { console.error(error); process.exitCode = 1; });
}
