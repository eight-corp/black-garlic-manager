const assert = require('node:assert/strict');
const path = require('node:path');

module.exports = async function testPredictionRoom(browser, scenario, unlocked) {
  const { page, context, backend } = await scenario(browser, { mobile: true });
  const db = backend.db;
  db.black_garlic_rooms.push({ id: 'room-2', room_name: '\u516d\u6238\u2461', active: true }, { id: 'hidden-room', room_name: 'Hidden', active: false });
  db.black_garlic_types.push({ id: 'type-2', type_name: 'TF', active: true });
  db.black_garlic_age_brackets = [{ id: 'fresh', label: 'Fresh', min_days: 0, max_days: 60, active: true }, { id: 'dry', label: 'Dry', min_days: 61, max_days: null, active: true }];
  db.black_garlic_maturation_rules = [
    { id: 'a', room_id: 'room', age_bracket_id: 'fresh', maturation_days: 10 },
    { id: 'b', room_id: 'room-2', age_bracket_id: 'fresh', maturation_days: 12 },
    { id: 'c', room_id: 'room', age_bracket_id: 'dry', maturation_days: 3 }
  ];
  db.black_garlic_settings.push({ setting_key: 'maturation', setting_value: { harvestBaseDates: { type: '2026-08-01', 'type-2': '2026-04-01' } } }, { setting_key: 'prediction', setting_value: { avgUsage: 2.5, preserve: true } });
  db.black_garlic_entries = [
    ['aug-a', '2026-08-21', 'room', 'type', 5, 0], ['aug-b', '2026-08-19', 'room-2', 'type', 6, 0],
    ['actual-a', '2026-08-31', 'room', 'type', 0, 2], ['actual-b', '2026-08-31', 'room-2', 'type', 0, 3],
    ['fresh-a', '2026-09-01', 'room', 'type', 32, 4], ['fresh-b', '2026-09-01', 'room-2', 'type', 64, 8],
    ['dry', '2026-09-01', 'room', 'type-2', 16, 1],
    ['today-a', '2026-09-12', 'room', 'type', 0, 7], ['today-b', '2026-09-12', 'room-2', 'type', 0, 9],
    ['hidden', '2026-09-01', 'hidden-room', 'type', 500, 500]
  ].map(([id, entry_date, room_id, type_id, in_qty, out_qty]) => ({ id, entry_date, room_id, type_id, in_qty, out_qty, harvest_lot_id: 'lot', recorded_at: entry_date + 'T03:00:00Z', worker_id: 'other', inventory_qty: 0, empty_qty: 0, note: '' }));
  const original = JSON.stringify(db);
  const pair = date => page.locator('[data-prediction-date="' + date + '"]').evaluate(row => [...row.cells].slice(1).map(cell => [Number(cell.querySelector('.cell-upper').textContent.replaceAll(',', '')), Number(cell.querySelector('.cell-lower').textContent.replaceAll(',', ''))]));
  try {
    await page.goto('https://eight-corp.github.io/black-garlic-manager/'); await unlocked(page);
    await page.locator('[data-tab="prediction"]').click();
    await page.locator('#predictionStartDate').fill('2026-08-31');
    await page.locator('#predictionEndDate').fill('2026-09-15');
    await page.locator('#predictionRefreshBtn').click();
    const reads = backend.reads.length;
    await page.locator('[data-prediction-view="table"]').click();
    assert.deepEqual(await page.locator('.prediction-month h3').allTextContents(), ['2026-08 \u4e88\u6e2c\u8868', '2026-09 \u4e88\u6e2c\u8868']);
    assert.deepEqual(await page.locator('.prediction-month').first().locator('thead th').allTextContents(), ['\u65e5', '\u516d\u6238\u2460', '\u516d\u6238\u2461', '\u5408\u8a08']);
    assert.deepEqual(await pair('2026-08-31'), [[5, 2], [6, 3], [11, 5]]);
    assert.deepEqual(await pair('2026-09-04'), [[16, 0], [0, 0], [16, 0]]);
    assert.deepEqual(await pair('2026-09-11'), [[32, 0], [0, 0], [32, 0]]);
    assert.deepEqual(await pair('2026-09-13'), [[0, 0], [64, 0], [64, 0]]);
    assert.deepEqual(await pair('2026-09-12'), [[0, 7], [0, 9], [0, 16]]);
    assert.equal(await page.locator('[data-prediction-date="2026-09-12"]').getAttribute('class'), 'prediction-today');
    await page.locator('#predictionRoom').selectOption('room-2');
    await page.locator('[data-tab="main"]').click(); await page.locator('[data-tab="prediction"]').click();
    assert.deepEqual(await pair('2026-08-31'), [[6, 3], [6, 3]]);
    await page.locator('#predictionRoom').selectOption('All');
    await page.locator('#predictionType').selectOption('type-2');
    await page.locator('[data-tab="main"]').click(); await page.locator('[data-tab="prediction"]').click();
    assert.deepEqual(await pair('2026-09-04'), [[16, 0], [0, 0], [16, 0]]);
    assert.deepEqual(await pair('2026-09-11'), [[0, 0], [0, 0], [0, 0]]);
    await page.locator('#predictionType').selectOption('All');
    await page.locator('[data-tab="main"]').click(); await page.locator('[data-tab="prediction"]').click();
    for (const width of [320, 390, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      await page.waitForFunction(width => innerWidth === width && document.documentElement.scrollWidth <= width, width);
      assert.ok(await page.locator('#predictionTable table').evaluateAll(tables => tables.every(table => table.getBoundingClientRect().width <= innerWidth)));
      if (process.env.QA_ARTIFACTS) await page.screenshot({ path: path.join(process.env.QA_ARTIFACTS, 'prediction-room-table-' + width + '.png') });
    }
    const totals = await page.locator('#predictionTable tbody tr').evaluateAll(rows => [0, 1].map(index => rows.map(row => Number(row.querySelector(index ? '.total-col .cell-lower' : '.total-col .cell-upper').textContent.replaceAll(',', '')))));
    await page.locator('[data-prediction-view="chart"]').click();
    for (let combination = 0; combination < 4; combination++) {
      const styles = [combination & 1 ? 'line' : 'bar', combination & 2 ? 'line' : 'bar'];
      await page.locator('#predictionPredStyle').selectOption(styles[0]); await page.locator('#predictionActualStyle').selectOption(styles[1]);
      assert.deepEqual(await page.locator('#predictionChart').evaluate(canvas => {
        const chart = Chart.getChart(canvas);
        return { types: chart.data.datasets.map((row, index) => chart.getDatasetMeta(index).type), data: chart.data.datasets.map(row => row.data), colors: chart.data.datasets.map(row => row.borderColor), axes: Object.keys(chart.scales).sort() };
      }), { types: styles, data: totals, colors: ['#007bff', '#d9534f'], axes: ['x', 'y'] });
      if (process.env.QA_ARTIFACTS) await page.screenshot({ path: path.join(process.env.QA_ARTIFACTS, 'prediction-room-chart-' + combination + '.png') });
    }
    assert.equal(await page.locator('#avgUsage').count(), 0);
    for (const width of [320, 390, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      await page.waitForFunction(width => {
        const frame = document.querySelector('#predictionChart').getBoundingClientRect();
        const nav = document.querySelector('.prediction-bottom-tabs').getBoundingClientRect();
        return innerWidth === width && frame.width >= width - 20 && frame.width <= width && frame.bottom <= nav.top + 1;
      }, width);
      assert.ok(await page.locator('#predictionChart').evaluate(canvas => {
        const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
        let blue = 0, red = 0;
        for (let index = 0; index < pixels.length; index += 4) {
          if (pixels[index + 3] < 100) continue;
          if (pixels[index] < 3 && Math.abs(pixels[index + 1] - 123) < 3 && pixels[index + 2] > 252) blue++;
          if (Math.abs(pixels[index] - 217) < 3 && Math.abs(pixels[index + 1] - 83) < 3 && Math.abs(pixels[index + 2] - 79) < 3) red++;
        }
        return blue > 50 && red > 50;
      }));
      if (process.env.QA_ARTIFACTS) await page.screenshot({ path: path.join(process.env.QA_ARTIFACTS, 'prediction-room-responsive-' + width + '.png') });
    }
    assert.equal(backend.reads.length, reads);
    assert.equal(backend.writes.length, 0);
    assert.equal(JSON.stringify(db), original);
    assert.deepEqual(backend.errors, []);
  } finally { await context.close(); }
  return true;
};
