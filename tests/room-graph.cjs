const assert = require('node:assert/strict');
const path = require('node:path');

module.exports = async function testRoomGraph(browser, scenario, unlocked) {
  const { page, context, backend } = await scenario(browser, { mobile: true });
  backend.db.black_garlic_settings.push({ setting_key: 'roomCapacities', setting_value: { room: 10 } });
  const original = JSON.stringify(backend.db);
  try {
    await page.goto('https://eight-corp.github.io/black-garlic-manager/');
    await unlocked(page);
    await page.locator('[data-tab="summary"]').click();
    await page.locator('[data-summary-view="graph"]').click();
    await page.locator('#graphStartDate').fill('2026-09-10');
    await page.locator('#graphEndDate').fill('2026-09-12');
    await page.locator('#graphRefreshBtn').click();
    const reads = backend.reads.length;
    assert.equal(await page.locator('#graphCapacityType,#graphCapacityStatus').count(), 0);
    for (const room of ['All', 'room']) {
      await page.locator('#graphRoom').selectOption(room);
      for (const type of ['All', 'type']) {
        await page.locator('#graphType').selectOption(type);
        assert.deepEqual(await page.locator('#summaryChart').evaluate(canvas => {
          const chart = Chart.getChart(canvas);
          return { data: chart.data.datasets.map(dataset => dataset.data), colors: chart.data.datasets.map(dataset => dataset.borderColor), axes: Object.keys(chart.scales).sort() };
        }), { data: [[0, 10, 0], [0, 2, 0], [0, 8, 8]], colors: ['#007bff', '#d9534f', '#28a745'], axes: ['x', 'y', 'y1'] });
      }
    }
    for (const width of [320, 390, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      await page.waitForFunction(() => {
        const frame = document.querySelector('#summaryChart').getBoundingClientRect();
        return frame.width >= innerWidth - 20 && document.documentElement.scrollWidth <= innerWidth;
      });
      if (process.env.QA_ARTIFACTS) await page.screenshot({ path: path.join(process.env.QA_ARTIFACTS, 'room-graph-' + width + '.png') });
    }
    assert.equal(backend.reads.length, reads);
    assert.equal(backend.writes.length, 0);
    assert.equal(JSON.stringify(backend.db), original);
    assert.deepEqual(backend.errors, []);
  } finally { await context.close(); }
  return true;
};
