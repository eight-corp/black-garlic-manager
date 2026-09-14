const assert = require('node:assert/strict');
const path = require('node:path');

const appUrl = 'https://eight-corp.github.io/black-garlic-manager/';
const mainType = '\u30a8\u30a4\u30c8';
const secondType = '\u9752\u5e78';
const blankType = 'TF';
const day = (base, offset) => {
  const date = new Date(base + 'T00:00:00Z');
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
};

async function typeRow(page, name) {
  const rows = page.locator('.type-master-row');
  const index = await rows.evaluateAll((rows, name) => rows.findIndex(row => row.querySelector('[data-field="type_name"]').value === name), name);
  assert.ok(index >= 0, 'type exists:' + name);
  return rows.nth(index);
}
const dateField = row => row.locator('[data-field="harvest_base_date"]');

async function testTypeHarvestDates(browser, scenario, unlocked) {
  const { page, context, backend } = await scenario(browser, { mobile: true });
  const db = backend.db;
  db.black_garlic_rooms.push({ id: 'room-2', room_name: 'Room 2', active: true });
  db.black_garlic_types[0].display_order = 1;
  db.black_garlic_types.push(
    { id: 'type-2', type_name: secondType, active: true, display_order: 2 },
    { id: 'type-blank', type_name: blankType, active: true, display_order: 3 },
    { id: 'hidden-type', type_name: 'Hidden type', active: false, display_order: 4 }
  );
  db.black_garlic_age_brackets = [
    { id: 'b0', label: '0-60', min_days: 0, max_days: 60, active: true },
    { id: 'b1', label: '61-120', min_days: 61, max_days: 120, active: true },
    { id: 'b2', label: '121+', min_days: 121, max_days: null, active: true }
  ];
  db.black_garlic_maturation_rules = ['room', 'room-2'].flatMap((room, roomIndex) =>
    (roomIndex ? [5, 0, 2] : [40, 25, 10]).map((days, index) => ({ id: room + index, room_id: room, age_bracket_id: 'b' + index, maturation_days: days })));
  db.black_garlic_settings = [
    { setting_key: 'maturation', setting_value: { harvestBaseDate: '2026-01-01', harvestBaseDates: { type: '2026-02-01', 'type-blank': '' }, futureOption: 'keep' } },
    { setting_key: 'prediction', setting_value: { avgUsage: 2.5 } },
    { setting_key: 'roomCapacities', setting_value: { room: 15 } }
  ];
  db.black_garlic_harvest_lots[0].harvest_date = '2025-01-01';
  db.black_garlic_harvest_lots[0].display_order = 1;
  const template = db.black_garlic_entries[0];
  db.black_garlic_entries = [
    ['entry-1', 'type', 'room', 32, 'lot'], ['entry-2', 'type-2', 'room', 64, 'lot'],
    ['entry-3', 'type-blank', 'room', 96, 'lot'], ['entry-room-2', 'type', 'room-2', 128, 'lot'],
    ['entry-no-lot', 'type-blank', 'room', 160, null], ['entry-hidden', 'hidden-type', 'room', 900, 'lot']
  ].map(([id, type, room, qty, lot]) => ({ ...template, id, type_id: type, room_id: room, entry_date: '2026-03-03', in_qty: qty, harvest_lot_id: lot }));
  const originalRecords = structuredClone({ entries: db.black_garlic_entries, storage: db.black_garlic_storage_entries, lots: db.black_garlic_harvest_lots });
  const originalPrediction = structuredClone(db.black_garlic_settings[1]);
  const openTypes = async () => {
    await page.locator('[data-tab="master"]').click();
    const section = page.locator('[data-master-section="types"]');
    if (!await section.evaluate(section => section.open)) await section.locator('summary').click();
    return section;
  };
  const save = async () => {
    await page.locator('#masterSaveBtn').click();
    await page.waitForFunction(() => !document.querySelector('#masterSaveBtn').dataset.busy);
    assert.equal(await page.locator('#toast').textContent(), '\u30de\u30b9\u30bf\u3092\u4fdd\u5b58\u3057\u307e\u3057\u305f');
  };
  const setting = () => db.black_garlic_settings.find(row => row.setting_key === 'maturation').setting_value;
  const assertForecast = async (expected, type = 'All', room = 'All') => {
    const writes = backend.writes.length;
    await page.locator('[data-tab="prediction"]').click();
    await page.locator('[data-prediction-view="table"]').click();
    await page.locator('#predictionStartDate').fill('2026-03-01');
    await page.locator('#predictionEndDate').fill('2026-04-30');
    await page.locator('#predictionType').selectOption(type);
    await page.locator('#predictionRoom').selectOption(room);
    await page.locator('[data-tab="main"]').click();
    await page.locator('[data-tab="prediction"]').click();
    const numbers = await page.locator('#predictionTable tbody tr').evaluateAll(rows => rows.map(row => Number(row.querySelector('.total-col .cell-upper').textContent.replaceAll(',', ''))));
    const actual = Object.fromEntries(numbers.flatMap((value, index) => value ? [[day('2026-03-01', index), value]] : []));
    assert.deepEqual(actual, expected);
    assert.deepEqual(await page.evaluate(() => Chart.getChart(document.querySelector('#predictionChart')).data.datasets[0].data), numbers);
    assert.equal(backend.writes.length, writes);
  };
  const before = { '2026-03-08': 128, '2026-03-13': 96, '2026-03-28': 64, '2026-04-02': 160, '2026-04-12': 32 };
  const after = { '2026-03-03': 128, '2026-03-13': 96, '2026-03-28': 32, '2026-04-02': 160, '2026-04-12': 64 };
  try {
    await page.goto(appUrl); await unlocked(page);
    await page.locator('[data-tab="master"]').click();
    assert.deepEqual(await page.locator('#masterRooms details > summary').allTextContents(), ['\u5ba4\u540d', '\u7a2e\u5225', '\u4fdd\u7ba1\u7a2e\u5225', '\u719f\u6210\u65e5\u6570\u8868']);
    assert.equal(await page.locator('#masterRooms details[open]').count(), 0);
    assert.equal(await page.locator('#harvestBaseDate,[data-master-section="maturation"] input[type="date"],[data-master-section="storageTypes"] input[type="date"]').count(), 0);
    await openTypes();
    for (const [name, date] of [[mainType, '2026-02-01'], [secondType, '2026-01-01'], [blankType, ''], ['Hidden type', '2026-01-01']]) {
      assert.equal(await dateField(await typeRow(page, name)).inputValue(), date);
    }
    await assertForecast(before);
    await openTypes();
    await dateField(await typeRow(page, mainType)).fill('2026-01-01');
    await dateField(await typeRow(page, secondType)).fill('2026-03-03');
    assert.equal(await (await typeRow(page, secondType)).locator('.weekday-inline').textContent(), '\uff08\u706b\u66dc\u65e5\uff09');
    const writesBeforeDraft = backend.writes.length;
    await (await typeRow(page, secondType)).locator('[data-master-action="up"]').click();
    assert.deepEqual(await page.locator('.type-master-row > [data-field="type_name"]').evaluateAll(inputs => inputs.map(input => input.value)), [secondType, mainType, blankType, 'Hidden type']);
    const types = page.locator('[data-master-section="types"]');
    assert.equal(await types.evaluate(section => section.open), true);
    await types.locator('[data-master-action="add"]').click();
    assert.equal(await dateField(page.locator('.type-master-row').last()).inputValue(), '');
    await page.locator('.type-master-row').last().locator('[data-field="type_name"]').fill('New type');
    await dateField(await typeRow(page, 'New type')).fill('2024-02-29');
    await types.locator('[data-master-action="add"]').click();
    await dateField(page.locator('.type-master-row').last()).fill('2026-08-01');
    assert.equal(backend.writes.length, writesBeforeDraft);
    await assertForecast(before);
    await openTypes();
    assert.equal(await dateField(await typeRow(page, mainType)).inputValue(), '2026-01-01');
    assert.equal(await dateField(await typeRow(page, secondType)).inputValue(), '2026-03-03');
    await (await typeRow(page, mainType)).locator('[data-field="type_name"]').fill('Renamed type');
    await save();
    const newTypeId = db.black_garlic_types.find(row => row.type_name === 'New type').id;
    assert.deepEqual(setting(), { futureOption: 'keep', harvestBaseDates: { 'type-2': '2026-03-03', type: '2026-01-01', 'type-blank': '', 'hidden-type': '2026-01-01', [newTypeId]: '2024-02-29' } });
    assert.ok(backend.writes.filter(write => write.resource === 'black_garlic_types' && write.payload).every(write => !('harvest_base_date' in write.payload)));
    await assertForecast(after);
    await assertForecast({ '2026-03-03': 128, '2026-03-28': 32 }, 'type');
    await assertForecast({ '2026-03-03': 128 }, 'type', 'room-2');
    await page.reload(); await unlocked(page); await openTypes();
    assert.equal(await dateField(await typeRow(page, 'Renamed type')).inputValue(), '2026-01-01');
    for (const width of [320, 390, 760, 761, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'master:' + width);
      assert.ok(await page.locator('.type-master-row').evaluateAll(rows => rows.every(row => {
        const bounds = row.getBoundingClientRect();
        const date = row.querySelector('[data-field="harvest_base_date"]').getBoundingClientRect();
        const weekday = row.querySelector('.weekday-inline').getBoundingClientRect();
        const label = row.querySelector('.type-harvest-date-field').getBoundingClientRect();
        const compact = matchMedia('(max-width: 760px), (pointer: coarse)').matches;
        const dateText = row.querySelector('.type-harvest-date-display > span');
        const controls = [...row.querySelectorAll('input:not([type="checkbox"]),button,.visibility-switch')];
        return getComputedStyle(row).gridTemplateRows.split(' ').length === 1 && date.width >= (compact ? 90 : 142) && weekday.right <= label.right &&
          (!compact || dateText.scrollWidth <= dateText.clientWidth) && controls.every((field, index) => {
          const r = field.getBoundingClientRect();
          return r.left >= bounds.left && r.right <= bounds.right && r.top >= bounds.top && r.bottom <= bounds.bottom &&
            (!index || r.left >= controls[index - 1].getBoundingClientRect().right);
        });
      })), 'date/weekday/buttons:' + width);
      if (process.env.QA_ARTIFACTS && [320, 390, 1280].includes(width)) await page.screenshot({ path: path.join(process.env.QA_ARTIFACTS, 'type-harvest-dates-' + width + '.png'), fullPage: true });
    }
    await (await typeRow(page, secondType)).locator('.visibility-switch').click();
    assert.equal(await (await typeRow(page, secondType)).locator('[data-field="active"]').isChecked(), false);
    await save();
    assert.equal(setting().harvestBaseDates['type-2'], '2026-03-03');
    await assertForecast({ '2026-03-03': 128, '2026-03-13': 96, '2026-03-28': 32, '2026-04-02': 160 });
    await openTypes();
    await (await typeRow(page, secondType)).locator('.visibility-switch').click();
    assert.equal(await (await typeRow(page, secondType)).locator('[data-field="active"]').isChecked(), true);
    await dateField(await typeRow(page, 'Renamed type')).fill('');
    await save();
    assert.equal(setting().harvestBaseDates.type, '');
    assert.ok(!('harvestBaseDate' in setting()));
    await assertForecast({ '2026-03-05': 128, '2026-03-13': 128, '2026-04-02': 160, '2026-04-12': 64 });
    await openTypes();
    const invalidDate = dateField(await typeRow(page, secondType));
    await invalidDate.evaluate(input => { input.type = 'text'; input.value = '2026-02-30'; input.dispatchEvent(new Event('change', { bubbles: true })); });
    const writesBeforeInvalid = backend.writes.length;
    await page.locator('#masterSaveBtn').click();
    await page.waitForFunction(() => !document.querySelector('#masterSaveBtn').dataset.busy);
    assert.match(await page.locator('#toast').textContent(), /\u53ce\u7a6b\u57fa\u6e96\u65e5/);
    assert.equal(backend.writes.length, writesBeforeInvalid);
    await page.reload(); await unlocked(page); await openTypes();
    await (await typeRow(page, 'Renamed type')).locator('[data-master-action="remove"]').click();
    const writesBeforeUsedDelete = backend.writes.length;
    await page.locator('#masterSaveBtn').click();
    await page.waitForFunction(() => !document.querySelector('#masterSaveBtn').dataset.busy);
    assert.match(await page.locator('#toast').textContent(), /\u4f7f\u7528\u4e2d\u306e\u7a2e\u5225/);
    assert.equal(backend.writes.length, writesBeforeUsedDelete);
    await page.reload(); await unlocked(page); await openTypes();
    await (await typeRow(page, 'New type')).locator('[data-master-action="remove"]').click();
    await save();
    assert.ok(!(newTypeId in setting().harvestBaseDates));
    assert.deepEqual({ entries: db.black_garlic_entries, storage: db.black_garlic_storage_entries, lots: db.black_garlic_harvest_lots }, originalRecords);
    assert.deepEqual(db.black_garlic_settings.find(row => row.setting_key === 'prediction'), originalPrediction);
    assert.ok(!backend.writes.some(write => ['black_garlic_entries', 'black_garlic_storage_entries'].includes(write.resource)));
    assert.deepEqual(backend.errors, []);
    const legacy = await scenario(browser);
    try {
      legacy.backend.db.black_garlic_types.push({ id: 'legacy-hidden', type_name: 'Legacy hidden', active: false });
      legacy.backend.db.black_garlic_settings.push({ setting_key: 'maturation', setting_value: { harvestBaseDate: '2026-05-01', keep: 1 } });
      legacy.backend.db.black_garlic_age_brackets.push({ id: 'legacy-b', label: 'All ages', min_days: 0, max_days: null, active: true });
      legacy.backend.db.black_garlic_maturation_rules.push({ id: 'legacy-rule', room_id: 'room', age_bracket_id: 'legacy-b', maturation_days: 17 });
      const records = structuredClone(legacy.backend.db.black_garlic_entries);
      const legacyForecast = async () => {
        await legacy.page.locator('[data-tab="prediction"]').click();
        await legacy.page.locator('[data-prediction-view="table"]').click();
        await legacy.page.locator('#predictionStartDate').fill('2026-09-01');
        await legacy.page.locator('#predictionEndDate').fill('2026-10-01');
        await legacy.page.locator('[data-tab="main"]').click();
        await legacy.page.locator('[data-tab="prediction"]').click();
        const numbers = await legacy.page.locator('#predictionTable tbody tr').evaluateAll(rows => rows.map(row => Number(row.querySelector('.total-col .cell-upper').textContent.replaceAll(',', ''))));
        assert.equal(numbers[27], 10);
        assert.equal(numbers.reduce((total, number) => total + number, 0), 10);
        return numbers;
      };
      await legacy.page.goto(appUrl); await unlocked(legacy.page);
      const beforeMigration = await legacyForecast();
      await legacy.page.locator('[data-tab="master"]').click();
      await legacy.page.locator('[data-master-section="types"] > summary').click();
      assert.deepEqual(await legacy.page.locator('.type-master-row [data-field="harvest_base_date"]').evaluateAll(inputs => inputs.map(input => input.value)), ['2026-05-01', '2026-05-01']);
      await legacy.page.locator('#masterSaveBtn').click();
      await legacy.page.waitForFunction(() => !document.querySelector('#masterSaveBtn').dataset.busy);
      assert.deepEqual(legacy.backend.db.black_garlic_settings.find(row => row.setting_key === 'maturation').setting_value, { keep: 1, harvestBaseDates: { type: '2026-05-01', 'legacy-hidden': '2026-05-01' } });
      assert.deepEqual(await legacyForecast(), beforeMigration);
      assert.deepEqual(legacy.backend.db.black_garlic_entries, records);
      assert.deepEqual(legacy.backend.errors, []);
    } finally { await legacy.context.close(); }
    return true;
  } finally { await context.close(); }
}

module.exports = testTypeHarvestDates;
if (require.main === module) {
  const { chromium } = require('playwright');
  const { scenario, unlocked } = require('./common-auth.cjs');
  (async () => {
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    try { await testTypeHarvestDates(browser, scenario, unlocked); console.log('Type harvest dates passed; database writes mocked.'); }
    finally { await browser.close(); }
  })().catch(error => { console.error(error); process.exitCode = 1; });
}
