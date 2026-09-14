const assert = require('node:assert/strict');
const path = require('node:path');

module.exports = async function testStackedStorage(browser, scenario, unlocked) {
  const { page, context, backend } = await scenario(browser, { mobile: true });
  const template = backend.db.black_garlic_storage_entries[0];
  for (let index = 2; index <= 7; index++) {
    backend.db.black_garlic_storage_types.push({ id: 'type-' + index, type_name: 'Type ' + index, active: index !== 7, display_order: index });
  }
  for (const [type, date, columns, pieces] of [
    ['type-2', '2026-09-09', 2, 1], ['type-3', '2026-09-10', 3, 0],
    ['type-4', '2026-09-10', 0, 0], ['type-5', '2026-09-10', 0, 1],
    ['type-6', '2026-09-13', 100, 0], ['type-7', '2026-09-10', 500, 0]
  ]) backend.db.black_garlic_storage_entries.push({ ...template, id: type, storage_type_id: type, storage_date: date, recorded_at: date + 'T03:00:00Z', columns16: columns, pieces });
  const original = JSON.stringify(backend.db);
  try {
    await page.goto('https://eight-corp.github.io/black-garlic-manager/'); await unlocked(page);
    assert.equal(await page.locator('[data-tab="prediction"] span').textContent(), '\u4e88\u6e2c');
    await page.locator('[data-tab="summary"]').click();
    await page.locator('[data-summary-view="storageGraph"]').click();
    await page.locator('#storageGraphStartDate').fill('2026-09-10');
    await page.locator('#storageGraphEndDate').fill('2026-09-13');
    await page.locator('#storageGraphRefreshBtn').click();
    const reads = backend.reads.length;
    for (const id of ['storageGraphType2', 'storageGraphType3', 'storageGraphType4', 'storageGraphType5']) await page.locator('#' + id).selectOption('');
    await page.locator('#storageGraphMode').selectOption('stacked');
    assert.equal(await page.locator('.storage-graph-series-controls').isVisible(), false);
    const snapshot = await page.locator('#storageSummaryChart').evaluate(canvas => {
      const chart = Chart.getChart(canvas);
      return { types: chart.data.datasets.map(row => row.type), labels: chart.data.datasets.map(row => row.label), data: chart.data.datasets.map(row => row.data), stacked: [chart.options.scales.x.stacked, chart.options.scales.y.stacked] };
    });
    assert.equal(snapshot.labels.length, 5);
    assert.ok(!snapshot.labels.includes('\u5168\u4f53'));
    assert.deepEqual(snapshot.labels.slice(1), ['Type 2', 'Type 3', 'Type 4', 'Type 5']);
    assert.deepEqual(snapshot.types, Array(5).fill('bar'));
    assert.deepEqual(snapshot.stacked, [true, true]);
    assert.deepEqual(snapshot.data, [[null, 4.5, 4.5, null], [2.0625, 2.0625, 2.0625, null], [3, 3, 3, null], [0, 0, 0, null], [.0625, .0625, .0625, null]]);
    for (const width of [320, 390, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      await page.waitForFunction(() => {
        const canvas = document.querySelector('#storageSummaryChart');
        const chart = Chart.getChart(canvas);
        return canvas.getBoundingClientRect().width >= innerWidth - 20 && chart.chartArea.width > 60 && document.documentElement.scrollWidth <= innerWidth;
      });
      assert.ok(await page.locator('#storageSummaryChart').evaluate(canvas => {
        const chart = Chart.getChart(canvas);
        const bars = chart.data.datasets.map((row, index) => chart.getDatasetMeta(index).data[1]);
        const ratio = chart.currentDevicePixelRatio;
        const bar = bars[2];
        const pixel = canvas.getContext('2d').getImageData(Math.round(bar.x * ratio), Math.round((bar.y + bar.base) / 2 * ratio), 1, 1).data;
        return bars.every(row => Math.abs(row.x - bar.x) < 1) && bar.height > 10 && pixel[3] > 100 && pixel[0] > 150;
      }), 'Stacked bars must share x position and render at width ' + width);
      if (process.env.QA_ARTIFACTS) await page.screenshot({ path: path.join(process.env.QA_ARTIFACTS, 'stacked-storage-' + width + '.png') });
    }
    await page.locator('#storageGraphMode').selectOption('line');
    assert.equal(await page.locator('.storage-graph-series-controls').isVisible(), true);
    assert.deepEqual(await page.locator('#storageSummaryChart').evaluate(canvas => Chart.getChart(canvas).data.datasets[0].data), [5.13, 9.63, 9.63, null]);
    assert.equal(await page.locator('#storageGraphType5').inputValue(), '');
    await page.locator('#storageGraphMode').selectOption('stacked');
    await page.locator('#storageGraphStartDate').fill('2024-02-29');
    await page.locator('#storageGraphEndDate').fill('2024-03-01');
    await page.locator('#storageGraphRefreshBtn').click();
    assert.equal(await page.locator('#storageSummaryChart').evaluate(canvas => Chart.getChart(canvas).data.datasets.length), 0);
    assert.equal(await page.locator('#storageGraphStatus').isVisible(), true);
    await page.locator('[data-tab="prediction"]').click();
    assert.deepEqual(await page.locator('.prediction-bottom-tabs button').allTextContents(), ['\u5ba4', '\u51fa\u5eab\u4e88\u6e2c\u30b0\u30e9\u30d5', '\u4fdd\u7ba1\u6570\u4e88\u6e2c\u30b0\u30e9\u30d5']);
    for (const view of ['table', 'chart']) {
      await page.locator('[data-prediction-view="' + view + '"]').click();
      for (const width of [320, 390, 1280]) {
        await page.setViewportSize({ width, height: 844 });
        await page.waitForFunction(width => innerWidth === width, width);
        if (view === 'chart') await page.waitForFunction(() => {
          const frame = document.querySelector('#predictionChart').getBoundingClientRect();
          const nav = document.querySelector('.prediction-bottom-tabs').getBoundingClientRect();
          return frame.width >= innerWidth - 20 && frame.width <= innerWidth && frame.bottom <= nav.top + 1;
        });
        assert.ok(await page.locator('.prediction-bottom-tabs').evaluate(nav => {
          const bounds = nav.getBoundingClientRect();
          const main = document.querySelector('.tabs').getBoundingClientRect();
          return getComputedStyle(nav).position === 'fixed' && bounds.bottom <= main.top + 1 && bounds.top > innerHeight * .6 &&
            [...nav.querySelectorAll('button')].every(button => {
              const frame = button.getBoundingClientRect();
              return button.scrollWidth <= button.clientWidth && document.elementFromPoint(frame.left + frame.width / 2, frame.top + frame.height / 2)?.closest('button') === button;
            });
        }));
        if (process.env.QA_ARTIFACTS && width === 390) await page.screenshot({ path: path.join(process.env.QA_ARTIFACTS, 'prediction-bottom-' + view + '.png') });
      }
    }
    await page.emulateMedia({ media: 'print' });
    assert.equal(await page.locator('.prediction-bottom-tabs').isVisible(), false);
    assert.equal(backend.reads.length, reads);
    assert.equal(backend.writes.length, 0);
    assert.equal(JSON.stringify(backend.db), original);
    assert.deepEqual(backend.errors, []);
  } finally { await context.close(); }
  return true;
};
