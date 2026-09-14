const assert = require('node:assert/strict');
const path = require('node:path');

const appUrl = 'https://eight-corp.github.io/black-garlic-manager/';
const roomName = '\u516d\u6238\u2460';
const renamedRoom = 'Renamed room';

async function roomRow(page, name) {
  const rows = page.locator('.room-master-row');
  const index = await rows.evaluateAll((elements, name) => elements.findIndex(row => row.querySelector('[data-field="room_name"]').value === name), name);
  assert.ok(index >= 0, 'Room must be present: ' + name);
  return rows.nth(index);
}

async function openMaster(page) {
  await page.locator('[data-tab="master"]').click();
  const section = page.locator('[data-master-section="rooms"]');
  if (!await section.evaluate(section => section.open)) await section.locator('summary').click();
  return section;
}

async function saveMaster(page) {
  await page.locator('#masterSaveBtn').click();
  await page.waitForFunction(() => !document.querySelector('#masterSaveBtn').disabled);
  assert.match(await page.locator('#toast').textContent(), /\u30de\u30b9\u30bf\u3092\u4fdd\u5b58/);
}

async function testRoomCapacities(browser, scenario, unlocked) {
  const legacy = await scenario(browser);
  try {
    await legacy.page.goto(appUrl);
    await unlocked(legacy.page);
    await openMaster(legacy.page);
    assert.equal(await (await roomRow(legacy.page, roomName)).locator('[data-field="capacity_qty"]').inputValue(), '');
    await saveMaster(legacy.page);
    assert.ok(!legacy.backend.writes.some(write => write.resource === 'black_garlic_settings' && write.payload.setting_key === 'roomCapacities'));
    assert.equal(legacy.backend.db.black_garlic_entries[0].inventory_qty, 8);
    assert.deepEqual(legacy.backend.errors, []);
  } finally { await legacy.context.close(); }

  const { page, context, backend } = await scenario(browser);
  backend.db.black_garlic_rooms[0].display_order = 1;
  backend.db.black_garlic_rooms.push(
    { id: 'room-2', room_name: 'Extra room', display_order: 2, active: true },
    { id: 'hidden-room', room_name: 'Hidden room', display_order: 3, active: false }
  );
  backend.db.black_garlic_settings.push(
    { setting_key: 'roomCapacities', setting_value: { room: 10.5, 'room-2': 0, 'hidden-room': 40 } },
    { setting_key: 'unrelated', setting_value: { keep: 'unchanged' } }
  );
  const capacities = () => backend.db.black_garlic_settings.find(row => row.setting_key === 'roomCapacities').setting_value;
  try {
    await page.goto(appUrl);
    await unlocked(page);
    const section = await openMaster(page);
    assert.equal(await (await roomRow(page, roomName)).locator('[data-field="capacity_qty"]').inputValue(), '10.5');
    assert.equal(await (await roomRow(page, 'Extra room')).locator('[data-field="capacity_qty"]').inputValue(), '0');
    assert.equal(await (await roomRow(page, 'Hidden room')).locator('[data-field="capacity_qty"]').inputValue(), '40');
    assert.equal(await page.locator('[data-draft="types"] [data-field="capacity_qty"]').count(), 0);
    assert.equal(await page.locator('[data-draft="storageTypes"] [data-field="capacity_qty"]').count(), 0);

    for (const width of [320, 390, 600, 601, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      const row = await roomRow(page, roomName);
      assert.ok(await row.evaluate(row => {
        const bounds = row.getBoundingClientRect();
        const controls = [...row.querySelectorAll('input:not([type="checkbox"]), button, .visibility-switch')];
        return getComputedStyle(row).gridTemplateRows.split(' ').length === 1 && bounds.right <= innerWidth && bounds.left >= 0 && row.scrollWidth <= row.clientWidth + 1 && controls.every((control, index) => {
          const frame = control.getBoundingClientRect();
          return frame.width >= (control.matches('.visibility-switch') ? 26 : 28) && frame.left >= bounds.left && frame.right <= bounds.right + 1 &&
            (!index || frame.left >= controls[index - 1].getBoundingClientRect().right);
        });
      }), 'Room controls must fit at width ' + width);
      if (process.env.QA_ARTIFACTS && [320, 390, 1440].includes(width)) {
        await page.screenshot({ path: path.join(process.env.QA_ARTIFACTS, 'room-capacities-' + width + '.png') });
      }
    }
    await page.setViewportSize({ width: 390, height: 844 });
    let row = await roomRow(page, roomName);
    await row.locator('[data-field="capacity_qty"]').fill('12.75');
    await row.locator('[data-field="room_name"]').fill(renamedRoom);
    await row.locator('[data-master-action="down"]').click();
    assert.equal(await (await roomRow(page, renamedRoom)).locator('[data-field="capacity_qty"]').inputValue(), '12.75');
    await section.locator('[data-master-action="add"]').click();
    assert.equal(await section.evaluate(section => section.open), true);
    assert.equal(backend.writes.length, 0, 'Editing and reordering must remain drafts until confirmation');
    assert.equal(capacities().room, 10.5);
    row = page.locator('.room-master-row').last();
    await row.locator('[data-field="room_name"]').fill('New room');
    await row.locator('[data-field="capacity_qty"]').fill('25.25');
    await saveMaster(page);
    const newRoom = backend.db.black_garlic_rooms.find(row => row.room_name === 'New room');
    assert.ok(newRoom?.id);
    assert.deepEqual(capacities(), { 'room-2': 0, room: 12.75, 'hidden-room': 40, [newRoom.id]: 25.25 });
    assert.equal(backend.db.black_garlic_rooms.find(row => row.id === 'room').room_name, renamedRoom);
    assert.ok(backend.writes.filter(write => write.resource === 'black_garlic_rooms').every(write => !('capacity_qty' in write.payload)));
    assert.deepEqual(backend.db.black_garlic_settings.find(row => row.setting_key === 'unrelated').setting_value, { keep: 'unchanged' });

    await page.reload();
    await unlocked(page);
    await openMaster(page);
    assert.equal(await (await roomRow(page, renamedRoom)).locator('[data-field="capacity_qty"]').inputValue(), '12.75');
    assert.equal(await (await roomRow(page, 'New room')).locator('[data-field="capacity_qty"]').inputValue(), '25.25');
    const beforeInvalid = backend.writes.length;
    await (await roomRow(page, renamedRoom)).locator('[data-field="capacity_qty"]').fill('-1');
    await page.locator('#masterSaveBtn').click();
    await page.waitForFunction(() => !document.querySelector('#masterSaveBtn').disabled);
    assert.match(await page.locator('#toast').textContent(), /\u53ce\u5bb9\u80fd\u529b/);
    assert.equal(backend.writes.length, beforeInvalid, 'Invalid capacities must fail before any master writes');
    await (await roomRow(page, renamedRoom)).locator('[data-field="capacity_qty"]').fill('5');
    await saveMaster(page);

    await page.locator('[data-tab="main"]').click();
    await page.locator('#mainDate').fill('2026-09-12');
    await page.locator('#mainRoom').selectOption('room');
    await page.locator('#mainIn').fill('7');
    await page.locator('#mainSubmitBtn').click();
    await page.waitForFunction(() => !document.querySelector('#mainSubmitBtn').disabled && document.querySelector('#mainIn').value === '');
    let entry = backend.db.black_garlic_entries.find(row => row.entry_date === '2026-09-12');
    assert.equal(entry.inventory_qty, 15, 'Automatic inventory must exceed the reference capacity without clamping');
    assert.equal(entry.inventory_manual, false);
    await page.locator('#mainDate').fill('2026-09-12');
    await page.locator('#mainRoom').selectOption('room');
    await page.locator('#mainInventory').fill('100');
    await page.locator('#mainSubmitBtn').click();
    await page.waitForFunction(() => !document.querySelector('#mainSubmitBtn').disabled && document.querySelector('#mainInventory').value === '');
    entry = backend.db.black_garlic_entries.find(row => row.entry_date === '2026-09-12');
    assert.equal(entry.inventory_qty, 100, 'Manual inventory may also exceed the reference capacity');
    assert.equal(entry.inventory_manual, true);
    assert.equal(capacities().room, 5);

    await openMaster(page);
    await (await roomRow(page, renamedRoom)).locator('.visibility-switch').click();
    await saveMaster(page);
    assert.equal(capacities().room, 5, 'Hidden rooms must retain their capacity');
    await (await roomRow(page, renamedRoom)).locator('[data-field="capacity_qty"]').fill('');
    await (await roomRow(page, 'New room')).locator('[data-master-action="remove"]').click();
    await saveMaster(page);
    assert.deepEqual(capacities(), { 'room-2': 0, 'hidden-room': 40 });
    assert.equal(backend.db.black_garlic_entries.find(row => row.entry_date === '2026-09-12').inventory_qty, 100);
    assert.deepEqual(backend.errors, []);
  } finally { await context.close(); }
  return true;
}

module.exports = testRoomCapacities;
if (require.main === module) {
  const { chromium } = require('playwright');
  const { scenario, unlocked } = require('./common-auth.cjs');
  (async () => {
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    try {
      await testRoomCapacities(browser, scenario, unlocked);
      console.log(JSON.stringify({ roomCapacitiesDraftSaveReloadRenameReorderZeroBlankDeleteResponsiveAndNoInventoryLimit: true, databaseWritesAreMocked: true, source: process.env.USE_PUBLISHED_SOURCE ? 'published' : 'local' }));
    } finally { await browser.close(); }
  })().catch(error => { console.error(error); process.exitCode = 1; });
}
