const assert = require('node:assert/strict');
const path = require('node:path');

module.exports = async function(browser, scenario, unlocked) {
  for (const todayActual of [false, true]) {
    const { page, context, backend } = await scenario(browser, { mobile: true });
    const db = backend.db;
    db.black_garlic_settings.push({ setting_key: 'prediction', setting_value: { avgUsage: 1, preserve: true } });
    db.black_garlic_entries = ['2026-08-13', '2026-08-15'].map((entry_date, i) => ({ ...db.black_garlic_entries[0], id: 'in-' + i, entry_date, in_qty: 64, out_qty: 0 }));
    if (todayActual) db.black_garlic_storage_entries.push({ ...db.black_garlic_storage_entries[0], id: 'today', storage_date: '2026-09-12', columns16: 7, pieces: 0 });
    const original = JSON.stringify(db);
    try {
      await page.goto('https://eight-corp.github.io/black-garlic-manager/'); await unlocked(page);
      await page.locator('[data-tab="prediction"]').click();
      await page.locator('#predictionStartDate').fill('2026-09-11'); await page.locator('#predictionEndDate').fill('2026-09-16');
      await page.locator('#predictionRefreshBtn').click();
      await page.locator('[data-prediction-view="storage"]').click();
      assert.equal(await page.locator('#predictionRoom').isDisabled(), true);
      const snapshot = () => page.locator('#storageForecastChart').evaluate(canvas => {
        const chart = Chart.getChart(canvas), stock = chart.data.datasets[1];
        return { data: chart.data.datasets.map(d => d.data), colors: [stock.segment.borderColor({p1DataIndex: 0}), stock.segment.borderColor({p1DataIndex: 1}), stock.segment.borderColor({p1DataIndex: 2})], count: chart.data.datasets.length, axis: chart.options.scales.y.title.text };
      });
      let value = await snapshot();
      assert.deepEqual(value.data[0], [0, 2, 0, 2, null, null]);
      assert.deepEqual(value.data[1], todayActual ? [4.5, 7, 7, 8, null, null] : [4.5, 5.5, 5.5, 6.5, null, null]);
      assert.deepEqual(value.colors, todayActual ? ['#28a745', '#28a745', '#d9534f'] : ['#28a745', '#d9534f', '#d9534f']);
      assert.equal(value.count, 2); assert.ok(value.axis.includes('\u5217'));
      assert.equal(await page.locator('#storageForecastChart').evaluate(c => Chart.getChart(c).config.options.scales.x.ticks.color({index:2})), '#d9534f');
      await page.locator('#storageForecastStyle').selectOption('line');
      assert.equal(await page.locator('#storageForecastChart').evaluate(c => Chart.getChart(c).getDatasetMeta(0).type), 'line');
      for (const width of [320, 390, 1280]) {
        await page.setViewportSize({width, height: 844});
        await page.waitForFunction(w => innerWidth === w && document.documentElement.scrollWidth <= w && document.querySelector('#storageForecastChart').getBoundingClientRect().width > w - 20, width);
        assert.ok(await page.locator('#storageForecastChart').evaluate(c => c.getContext('2d').getImageData(0, 0, c.width, c.height).data.some((v, i) => i % 4 === 3 && v > 100)));
        if (process.env.QA_ARTIFACTS) await page.screenshot({path: path.join(process.env.QA_ARTIFACTS, 'storage-forecast-' + todayActual + '-' + width + '.png')});
      }
      assert.equal(backend.writes.length, 0); assert.equal(JSON.stringify(db), original);
      await page.locator('#predictionStartDate').fill('2026-09-14'); await page.locator('#predictionRefreshBtn').click();
      await page.waitForFunction(() => !document.querySelector('#predictionRefreshBtn').disabled);
      assert.deepEqual((await snapshot()).data[1], todayActual ? [8, null, null] : [6.5, null, null]);
      await page.locator('#storageForecastUsage').fill('100'); await page.locator('#predictionRefreshBtn').click();
      await page.waitForFunction(() => !document.querySelector('#predictionRefreshBtn').disabled);
      assert.equal((await snapshot()).data[1][0], 0);
      assert.deepEqual(db.black_garlic_settings.find(s => s.setting_key === 'prediction').setting_value, {avgUsage:100, preserve:true});
      assert.equal(backend.writes.length, 1);
      await page.locator('[data-prediction-view="chart"]').click(); assert.equal(await page.locator('#predictionRoom').isDisabled(), false);
      assert.deepEqual(backend.errors, []);
    } finally { await context.close(); }
  }
  for (const empty of [true, false]) {
    const {page, context, backend} = await scenario(browser, {role:'viewer'});
    backend.db.black_garlic_entries[0].in_qty = 32;
    backend.db.black_garlic_entries[0].entry_date = '2026-08-13';
    backend.db.black_garlic_storage_entries = empty ? [] : [{...backend.db.black_garlic_storage_entries[0], columns16:0, pieces:0}];
    try {
      await page.goto('https://eight-corp.github.io/black-garlic-manager/'); await unlocked(page);
      await page.locator('[data-tab="prediction"]').click();
      await page.locator('[data-prediction-view="storage"]').click();
      assert.equal(await page.locator('#storageForecastUsage').isDisabled(), true);
      const values = await page.locator('#storageForecastChart').evaluate(c => Chart.getChart(c).data.datasets[1].data);
      assert.equal(values.some(v => v !== null), !empty);
      if (!empty) assert.ok(values.includes(1));
      await page.locator('#predictionRefreshBtn').click();
      await page.waitForFunction(() => !document.querySelector('#predictionRefreshBtn').disabled);
      assert.equal(backend.writes.length, 0); assert.deepEqual(backend.errors, []);
    } finally {await context.close();}
  }
  return true;
};
