const assert = require('node:assert/strict');
const path = require('node:path');

async function testCapacityPercent(browser, scenario, unlocked) {
  const fixture = await scenario(browser, { mobile: true });
  const { page, context, backend } = fixture;
  const url = 'https://eight-corp.github.io/black-garlic-manager/';
  const entry = (id, date, room, type, stock) => ({
    id, entry_date: date, recorded_at: date + 'T03:00:00Z', room_id: room, type_id: type,
    harvest_lot_id: 'lot', worker_id: 'other', inventory_qty: stock, inventory_manual: true,
    in_qty: stock, out_qty: 2, empty_qty: 0, note: ''
  });
  backend.db.black_garlic_rooms.push(
    { id: 'room-2', room_name: '\u516d\u6238\u2461', active: true },
    { id: 'hidden-room', room_name: 'Hidden', active: false }
  );
  backend.db.black_garlic_types.push(
    { id: 'type-2', type_name: 'TF', active: true },
    { id: 'hidden-type', type_name: 'Hidden', active: false }
  );
  const capacitySetting = { setting_key: 'roomCapacities', setting_value: { room: 10, 'room-2': 20 } };
  backend.db.black_garlic_settings.push(capacitySetting);
  backend.db.black_garlic_entries = [
    entry('a', '2026-09-10', 'room', 'type', 5),
    entry('b', '2026-09-10', 'room-2', 'type', 7),
    entry('c', '2026-09-10', 'room', 'type-2', 3),
    entry('d', '2026-09-12', 'room-2', 'type', 37),
    entry('hidden-room-row', '2026-09-10', 'hidden-room', 'type', 500),
    entry('hidden-type-row', '2026-09-10', 'room', 'hidden-type', 500)
  ];
  async function openGraph() {
    await page.goto(url); await unlocked(page);
    await page.locator('[data-tab="summary"]').click();
    await page.locator('[data-summary-view="graph"]').click();
    await page.locator('#graphStartDate').fill('2026-09-09');
    await page.locator('#graphEndDate').fill('2026-09-13');
    await page.locator('#graphRefreshBtn').click();
  }
  const percent = () => page.locator('#summaryChart').evaluate(canvas => Chart.getChart(canvas).data.datasets[3].data);
  try {
    await openGraph();
    const reads = backend.reads.length;
    assert.deepEqual(await percent(), [0, 50, 50, 150, 150]);
    assert.equal(await page.locator('#graphCapacityStatus').isVisible(), false);
    const options = await page.locator('#summaryChart').evaluate(canvas => {
      const chart = Chart.getChart(canvas);
      const dataset = chart.data.datasets[3];
      return {
        type: dataset.type, color: dataset.borderColor, fill: dataset.backgroundColor,
        axis: dataset.yAxisID, stockAxis: chart.data.datasets[2].yAxisID,
        stockColor: chart.data.datasets[2].borderColor,
        positions: [chart.scales.y.position, chart.scales.y1.position, chart.scales.y2.position],
        max: chart.scales.y2.max, tick: chart.options.scales.y2.ticks.callback(150),
        tooltip: chart.options.plugins.tooltip.callbacks.label({ dataset, formattedValue: '150' }),
        flowTooltip: chart.options.plugins.tooltip.callbacks.label({ dataset: chart.data.datasets[0], formattedValue: '5' })
      };
    });
    assert.equal(options.type, 'line');
    assert.equal(options.color, '#000000');
    assert.equal(options.fill, '#000000');
    assert.equal(options.axis, 'y2');
    assert.equal(options.stockAxis, 'y1');
    assert.equal(options.stockColor, '#28a745');
    assert.deepEqual(options.positions, ['left', 'right', 'right']);
    assert.ok(options.max >= 150);
    assert.equal(options.tick, '150%');
    assert.equal(options.tooltip, '\u5168\u5ba4\u53ce\u5bb9\u7387: 150%');
    assert.equal(options.flowTooltip, '\u5165\u5eab: 5');
    for (const [type, room, stock] of [
      ['type', 'room', [0, 5, 5, 5, 5]],
      ['type-2', 'All', [0, 3, 3, 3, 3]],
      ['All', 'room-2', [0, 7, 7, 37, 37]]
    ]) {
      await page.locator('#graphType').selectOption(type);
      await page.locator('#graphRoom').selectOption(room);
      assert.deepEqual(await page.locator('#summaryChart').evaluate(canvas => Chart.getChart(canvas).data.datasets[2].data), stock);
      assert.deepEqual(await percent(), [0, 50, 50, 150, 150]);
    }
    for (const width of [320, 360, 390, 760, 761, 844, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      await page.waitForFunction(() => {
        const canvas = document.querySelector('#summaryChart');
        const chart = Chart.getChart(canvas);
        const frame = canvas.getBoundingClientRect();
        return chart.chartArea.width > 60 && frame.width <= innerWidth && frame.width >= innerWidth - 20 &&
          chart.scales.y2.right <= chart.width + 1 && document.documentElement.scrollWidth <= innerWidth;
      });
      assert.ok(await page.locator('#summaryChart').evaluate(canvas => {
        const chart = Chart.getChart(canvas);
        const points = chart.getDatasetMeta(3).data;
        const from = points[1], to = points[2];
        const ratio = chart.currentDevicePixelRatio;
        const x = Math.round((from.x + to.x) / 2 * ratio);
        const y = Math.round((from.y + to.y) / 2 * ratio);
        const pixels = canvas.getContext('2d').getImageData(x - 2, y - 2, 5, 5).data;
        let black = 0;
        for (let index = 0; index < pixels.length; index += 4) {
          if (pixels[index] < 5 && pixels[index + 1] < 5 && pixels[index + 2] < 5 && pixels[index + 3] > 100) black++;
        }
        return black > 3 && points.every(point => !point.skip && Number.isFinite(point.x) && Number.isFinite(point.y));
      }), 'Black capacity line must render at width ' + width);
      if (process.env.QA_ARTIFACTS && [320, 390, 1280].includes(width)) {
        await page.screenshot({ path: path.join(process.env.QA_ARTIFACTS, 'capacity-percent-' + width + '.png') });
      }
    }
    await page.locator('#graphFullscreenBtn').click();
    await page.setViewportSize({ width: 844, height: 390 });
    await page.waitForFunction(() => {
      const canvas = document.querySelector('#summaryChart');
      return document.querySelector('#graphFullscreenDialog').open && canvas.getBoundingClientRect().width >= innerWidth - 20 && Chart.getChart(canvas).chartArea.width > 400;
    });
    assert.deepEqual(await percent(), [0, 50, 50, 150, 150]);
    if (process.env.QA_ARTIFACTS) await page.screenshot({ path: path.join(process.env.QA_ARTIFACTS, 'capacity-percent-fullscreen-landscape.png') });
    await page.locator('#graphFullscreenBtn').click();
    assert.equal(await page.locator('#graphFullscreenDialog').evaluate(dialog => dialog.open), false);
    assert.equal(backend.reads.length, reads);
    assert.equal(backend.writes.length, 0);

    for (const [capacities, expected, status] of [
      [{ room: 0, 'room-2': 30 }, [0, 50, 50, 150, 150], false],
      [{ room: 10, 'room-2': 50 }, [0, 25, 25, 75, 75], false],
      [{ room: 10, 'room-2': 0 }, [0, 150, 150, 450, 450], false],
      [{ room: 10 }, [null, null, null, null, null], true],
      [{ room: 10, 'room-2': null }, [null, null, null, null, null], true],
      [{ room: 10, 'room-2': -1 }, [null, null, null, null, null], true],
      [{ room: 0, 'room-2': 0 }, [null, null, null, null, null], true],
      [{}, [null, null, null, null, null], true]
    ]) {
      capacitySetting.setting_value = capacities;
      await openGraph();
      assert.deepEqual(await percent(), expected);
      assert.equal(await page.locator('#graphCapacityStatus').isVisible(), status);
      assert.equal(await page.locator('#summaryChart').evaluate(canvas => Chart.getChart(canvas).options.scales.y2.display), !status);
      assert.deepEqual(await page.locator('#summaryChart').evaluate(canvas => Chart.getChart(canvas).data.datasets[2].data), [0, 15, 15, 45, 45]);
      assert.equal(backend.writes.length, 0);
    }
    backend.db.black_garlic_rooms.forEach(room => { room.active = false; });
    await openGraph();
    assert.deepEqual(await percent(), [null, null, null, null, null]);
    assert.match(await page.locator('#graphCapacityStatus').textContent(), /\u8868\u793a\u5bfe\u8c61/);
    await page.locator('[data-tab="prediction"]').click();
    assert.equal(await page.locator('#predictionChart').evaluate(canvas => Chart.getChart(canvas).data.datasets.length), 3);
    assert.equal(await page.locator('#predictionChart').evaluate(canvas => Chart.getChart(canvas).scales.y2 !== undefined), false);
    assert.equal(backend.writes.length, 0);
    assert.deepEqual(backend.errors, []);
  } finally { await context.close(); }
  return true;
}

module.exports = testCapacityPercent;
if (require.main === module) {
  const { chromium } = require('playwright');
  const { scenario, unlocked } = require('./common-auth.cjs');
  (async () => {
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    try {
      await testCapacityPercent(browser, scenario, unlocked);
      console.log(JSON.stringify({ allRoomCapacityPercent: true, databaseWritesAreMocked: true, source: process.env.USE_PUBLISHED_SOURCE ? 'published' : 'local' }));
    } finally { await browser.close(); }
  })().catch(error => { console.error(error); process.exitCode = 1; });
}
