const assert = require('node:assert/strict');
const path = require('node:path');

const appUrl = 'https://eight-corp.github.io/black-garlic-manager/';
const day = (base, offset) => {
  const date = new Date(base + 'T00:00:00Z');
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
};

async function testMaturation(browser, scenario, unlocked) {
  const { context, backend, page } = await scenario(browser);
  try {
    backend.db.black_garlic_rooms.push({ id: 'room-2', room_name: 'Room 2', active: true });
    backend.db.black_garlic_age_brackets = [
      { id: 'b0', label: '0-60', min_days: 0, max_days: 60, active: true, display_order: 1 },
      { id: 'b1', label: '61-120', min_days: 61, max_days: 120, active: true, display_order: 2 },
      { id: 'b2', label: '121-180', min_days: 121, max_days: 180, active: true, display_order: 3 },
      { id: 'b3', label: '181+', min_days: 181, max_days: null, active: true, display_order: 4 }
    ];
    backend.db.black_garlic_maturation_rules = [40, 30, 20, 10].map((days, index) => ({
      id: 'r' + index, room_id: 'room', age_bracket_id: 'b' + index, maturation_days: days
    }));
    backend.db.black_garlic_maturation_rules.push({ id: 'r-zero', room_id: 'room-2', age_bracket_id: 'b0', maturation_days: 0 });
    backend.db.black_garlic_settings = [
      { setting_key: 'prediction', setting_value: { avgUsage: 1.25 } },
      { setting_key: 'maturation', setting_value: { futureOption: 'preserve' } }
    ];
    backend.db.black_garlic_harvest_lots[0].harvest_date = '2025-01-01';
    backend.db.black_garlic_harvest_lots[0].display_order = 1;
    backend.db.black_garlic_entries = [-1, 0, 60, 61, 120, 121, 180, 181, 240].map((elapsed, index) => ({
      id: 'main-' + index, entry_date: day('2026-01-01', elapsed), recorded_at: day('2026-01-01', elapsed) + 'T03:00:00Z',
      room_id: 'room', type_id: 'type', harvest_lot_id: 'lot', worker_id: 'other',
      inventory_qty: 100 + index, inventory_manual: false, in_qty: 32 * (index + 1), out_qty: index, empty_qty: 0, note: ''
    }));
    backend.db.black_garlic_entries.push(
      { ...backend.db.black_garlic_entries[1], id: 'zero-day', room_id: 'room-2', in_qty: 320, out_qty: 0 },
      { ...backend.db.black_garlic_entries[3], id: 'missing-rule', room_id: 'room-2', in_qty: 352, out_qty: 0 }
    );
    const operationalBefore = structuredClone({ main: backend.db.black_garlic_entries, storage: backend.db.black_garlic_storage_entries });
    const lotsBefore = structuredClone(backend.db.black_garlic_harvest_lots);
    const settingsBefore = structuredClone(backend.db.black_garlic_settings[0]);
    const expected = baseDate => {
      const result = new Map();
      for (const entry of backend.db.black_garlic_entries) {
        const base = baseDate || backend.db.black_garlic_harvest_lots.find(lot => lot.id === entry.harvest_lot_id)?.harvest_date;
        const elapsed = (new Date(entry.entry_date + 'T00:00:00Z') - new Date(base + 'T00:00:00Z')) / 86400000;
        const bracket = backend.db.black_garlic_age_brackets.find(item => item.active !== false && elapsed >= item.min_days && (item.max_days == null || elapsed <= item.max_days));
        const rule = bracket && backend.db.black_garlic_maturation_rules.find(item => item.room_id === entry.room_id && item.age_bracket_id === bracket.id);
        const date = day(entry.entry_date, rule?.maturation_days ?? 30);
        result.set(date, (result.get(date) || 0) + entry.in_qty);
      }
      return Object.fromEntries([...result].sort(([a], [b]) => a.localeCompare(b)));
    };
    const readForecast = async () => {
      const rows = await page.locator('#predictionTable tbody tr').evaluateAll(rows => rows.map(row => [...row.cells].map(cell => cell.textContent)));
      const start = await page.locator('#predictionStartDate').inputValue();
      return Object.fromEntries(rows.flatMap((cells, index) => {
        const value = Number(cells[1].replaceAll(',', ''));
        return value ? [[day(start, index), value]] : [];
      }));
    };
    const showForecast = async (baseDate, start = '2025-12-25', end = '2026-12-01') => {
      await page.locator('[data-tab="prediction"]').click();
      await page.locator('[data-graph-view="forecast"]').click();
      await page.locator('[data-prediction-view="table"]').click();
      await page.locator('#predictionStartDate').fill(start);
      await page.locator('#predictionEndDate').fill(end);
      const writes = backend.writes.length;
      await page.locator('[data-tab="main"]').click();
      await page.locator('[data-tab="prediction"]').click();
      assert.deepEqual(await readForecast(), expected(baseDate));
      const forecast = await page.evaluate(() => Chart.getChart(document.querySelector('#predictionChart')).data.datasets[0].data);
      const table = await page.locator('#predictionTable tbody tr').evaluateAll(rows => rows.map(row => Number(row.cells[1].textContent.replaceAll(',', ''))));
      assert.deepEqual(forecast, table);
      assert.equal(backend.writes.length, writes);
    };
    const save = async () => {
      await page.locator('#masterSaveBtn').click();
      await page.waitForFunction(() => !document.querySelector('#masterSaveBtn').dataset.busy && document.querySelector('#toast').textContent === '\u30de\u30b9\u30bf\u3092\u4fdd\u5b58\u3057\u307e\u3057\u305f');
    };
    await page.goto(appUrl);
    await unlocked(page);
    await showForecast('');
    await page.locator('[data-tab="master"]').click();
    const section = page.locator('[data-master-section="maturation"]');
    assert.equal(await section.getAttribute('open'), null);
    await section.locator('summary').click();
    assert.equal(await page.locator('#harvestBaseDate').inputValue(), '');
    await page.locator('#harvestBaseDate').fill('2026-01-01');
    assert.equal(await page.locator('#harvestBaseDateWeekday').textContent(), '\uff08\u6728\u66dc\u65e5\uff09');
    const writesBefore = backend.writes.length;
    await section.locator('[data-master-action="add"][data-draft="brackets"]').click();
    assert.equal(await page.locator('#harvestBaseDate').inputValue(), '2026-01-01');
    assert.notEqual(await section.getAttribute('open'), null);
    await section.locator('.bracket-row').last().locator('[data-master-action="remove"]').click();
    assert.equal(await page.locator('#harvestBaseDate').inputValue(), '2026-01-01');
    assert.equal(backend.writes.length, writesBefore);
    await showForecast('');
    await page.locator('[data-tab="master"]').click();
    await save();
    assert.equal(await page.locator('#harvestBaseDate').inputValue(), '2026-01-01');
    assert.deepEqual(backend.db.black_garlic_settings.find(row => row.setting_key === 'maturation').setting_value, { futureOption: 'preserve', harvestBaseDate: '2026-01-01' });
    await showForecast('2026-01-01');
    assert.deepEqual(await readForecast(), {
      '2026-01-01': 320,
      '2026-01-30': 32,
      '2026-02-10': 64,
      '2026-04-02': 480,
      '2026-04-11': 96,
      '2026-05-22': 192,
      '2026-05-31': 160,
      '2026-07-11': 256,
      '2026-07-20': 224,
      '2026-09-08': 288
    });
    await page.locator('[data-tab="master"]').click();
    for (const width of [320, 390, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      const bounds = await page.locator('#harvestBaseDate').boundingBox();
      assert.ok(bounds.width >= 142 && bounds.x + bounds.width <= width);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      if (process.env.QA_ARTIFACTS) await page.screenshot({ path: path.join(process.env.QA_ARTIFACTS, 'maturation-base-date-' + width + '.png'), fullPage: true });
    }
    await page.reload();
    await unlocked(page);
    await page.locator('[data-tab="master"]').click();
    await section.locator('summary').click();
    assert.equal(await page.locator('#harvestBaseDate').inputValue(), '2026-01-01');
    await page.locator('#harvestBaseDate').fill('2026-01-02');
    await showForecast('2026-01-01');
    await page.locator('[data-tab="master"]').click();
    assert.equal(await page.locator('#harvestBaseDate').inputValue(), '2026-01-02');
    await save();
    assert.equal(backend.db.black_garlic_settings.find(row => row.setting_key === 'maturation').setting_value.harvestBaseDate, '2026-01-02');
    assert.equal(await page.locator('#harvestBaseDate').inputValue(), '2026-01-02');
    await showForecast('2026-01-02');
    await page.locator('[data-tab="master"]').click();
    await page.locator('#harvestBaseDate').fill('');
    await save();
    await showForecast('');
    assert.deepEqual({ main: backend.db.black_garlic_entries, storage: backend.db.black_garlic_storage_entries }, operationalBefore);
    assert.deepEqual(backend.db.black_garlic_harvest_lots, lotsBefore);
    assert.deepEqual(backend.db.black_garlic_settings.find(row => row.setting_key === 'prediction'), settingsBefore);
    assert.equal(backend.writes.filter(write => ['black_garlic_entries', 'black_garlic_storage_entries'].includes(write.resource)).length, 0);

    backend.db.black_garlic_entries = [0, 60, 61, 181].map((elapsed, index) => ({ ...operationalBefore.main[index], entry_date: day('2024-02-29', elapsed), in_qty: 32 * (index + 1) }));
    backend.db.black_garlic_settings.find(row => row.setting_key === 'maturation').setting_value.harvestBaseDate = '2024-02-29';
    backend.db.black_garlic_age_brackets.unshift({ id: 'hidden', label: 'Hidden', min_days: 0, max_days: null, active: false, display_order: 0 });
    await page.reload();
    await unlocked(page);
    await showForecast('2024-02-29', '2024-02-29', '2024-12-01');
    assert.deepEqual(backend.errors, []);
    return true;
  } finally {
    await context.close();
  }
}

module.exports = testMaturation;
if (require.main === module) {
  const { chromium } = require('playwright');
  const { scenario, unlocked } = require('./common-auth.cjs');
  (async () => {
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    try {
      await testMaturation(browser, scenario, unlocked);
      console.log(JSON.stringify({ maturationBaseDateBoundariesRoomsZeroDayFallbackDraftPersistenceReloadAndLeapYear: true, databaseWritesAreMocked: true, source: process.env.USE_PUBLISHED_SOURCE ? 'published' : 'local' }));
    } finally { await browser.close(); }
  })().catch(error => { console.error(error); process.exitCode = 1; });
}
