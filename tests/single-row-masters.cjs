const assert = require('node:assert/strict');
const path = require('node:path');

async function testSingleRowMasters(browser, scenario, unlocked) {
  for (const mobile of [true, false]) {
    const { page, context, backend } = await scenario(browser, { mobile });
    backend.db.black_garlic_types[0].type_name = '\u30a8\u30a4\u30c8R7';
    backend.db.black_garlic_types.push({ id: 'type-2', type_name: '\u9752\u5e78R8', active: true });
    backend.db.black_garlic_rooms.push({ id: 'room-2', room_name: '\u516d\u6238\u2461', active: true });
    backend.db.black_garlic_settings.push(
      { setting_key: 'maturation', setting_value: { harvestBaseDates: { type: '2026-09-12', 'type-2': '2024-02-29' } } },
      { setting_key: 'roomCapacities', setting_value: { room: 12.75, 'room-2': 150 } }
    );
    const original = JSON.stringify(backend.db);
    try {
      await page.goto('https://eight-corp.github.io/black-garlic-manager/'); await unlocked(page);
      await page.locator('[data-tab="master"]').click();
      for (const key of ['rooms', 'types']) await page.locator('[data-master-section="' + key + '"] > summary').click();
      const reads = backend.reads.length;
      for (const width of [320, 360, 390, 600, 601, 760, 761, 943, 1280]) {
        await page.setViewportSize({ width, height: 844 });
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        const fits = await page.locator('.room-master-row,.type-master-row').evaluateAll(rows => rows.every(row => {
          const compact = matchMedia('(max-width: 760px), (pointer: coarse)').matches;
          const bounds = row.getBoundingClientRect();
          const controls = [...row.querySelectorAll('input:not([type="checkbox"]),button,.visibility-switch')];
          if (getComputedStyle(row).gridTemplateRows.split(' ').length !== 1 || bounds.height > 75 || row.scrollWidth > row.clientWidth) return false;
          if (!controls.every((control, index) => {
            const r = control.getBoundingClientRect();
            return r.width >= 26 && r.height >= (!compact && control.matches('.visibility-switch') ? 18 : 34) && r.left >= bounds.left && r.right <= bounds.right && r.top >= bounds.top && r.bottom <= bounds.bottom &&
              (!index || r.left >= controls[index - 1].getBoundingClientRect().right) && (!compact || Math.abs(r.top - controls[0].getBoundingClientRect().top) < 1);
          })) return false;
          const ctx = document.createElement('canvas').getContext('2d');
          for (const input of row.querySelectorAll('input[data-field="type_name"],input[data-field="room_name"],input[data-field="capacity_qty"]')) {
            const style = getComputedStyle(input);
            ctx.font = style.font;
            if (ctx.measureText(input.value).width > input.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)) return false;
          }
          const date = row.querySelector('input[type="date"]');
          if (date) {
            if (getComputedStyle(date).opacity !== (compact ? '0' : '1')) return false;
            if (compact) {
              const text = row.querySelector('.type-harvest-date-display > span');
              const icon = text.nextElementSibling.getBoundingClientRect();
              if (text.scrollWidth > text.clientWidth || text.getBoundingClientRect().right > icon.left) return false;
            }
          }
          return true;
        }));
        if (!fits) console.error(JSON.stringify(await page.locator('.room-master-row,.type-master-row').evaluateAll(rows => rows.map(row => ({
          className: row.className, rows: getComputedStyle(row).gridTemplateRows, bounds: row.getBoundingClientRect().toJSON(),
          controls: [...row.querySelectorAll('input:not([type="checkbox"]),button,.visibility-switch')].map(control => ({ field: control.dataset.field || control.dataset.masterAction || control.className, frame: control.getBoundingClientRect().toJSON(), font: getComputedStyle(control).font, opacity: getComputedStyle(control).opacity })),
          text: row.querySelector('.type-harvest-date-display > span')?.getBoundingClientRect().toJSON(),
          icon: row.querySelector('.type-harvest-date-display > svg')?.getBoundingClientRect().toJSON()
        }))), null, 2));
        assert.ok(fits, 'One readable master row:' + mobile + ':' + width);
        assert.equal(await page.locator('#typeHarvestBaseDate-0').inputValue(), '2026-09-12');
        assert.equal(await page.locator('#typeHarvestBaseDateText-0').textContent(), '26/09/12(\u571f)');
        assert.equal(await page.locator('#typeHarvestBaseDate-1').inputValue(), '2024-02-29');
        assert.equal(await page.locator('#typeHarvestBaseDateText-1').textContent(), '24/02/29(\u6728)');
        if (process.env.QA_ARTIFACTS && [320, 390, 1280].includes(width)) {
          await page.screenshot({ path: path.join(process.env.QA_ARTIFACTS, 'single-row-masters-' + (mobile ? 'touch' : 'desktop') + '-' + width + '.png'), fullPage: true });
        }
      }
      await page.setViewportSize({ width: 390, height: 844 });
      const input = page.locator('#typeHarvestBaseDate-0');
      await input.evaluate(input => { window.masterPickerCalls = 0; input.showPicker = () => window.masterPickerCalls++; });
      const frame = await input.boundingBox();
      for (const x of [3, frame.width / 2, frame.width - 3]) await input.click({ position: { x, y: 17 } });
      await page.locator('.type-harvest-date-field > span').first().click();
      assert.equal(await page.evaluate(() => window.masterPickerCalls), 4);
      for (const [date, expected] of [['2024-02-29', '24/02/29(\u6728)'], ['2025-12-31', '25/12/31(\u6c34)'], ['2026-01-01', '26/01/01(\u6728)'], ['', '\u672a\u8a2d\u5b9a']]) {
        await input.fill(date);
        assert.equal(await input.inputValue(), date);
        assert.equal(await page.locator('#typeHarvestBaseDateText-0').textContent(), expected);
        if (date) assert.ok((await input.getAttribute('title')).startsWith(date));
      }
      await input.fill('2026-09-12');
      const types = page.locator('[data-master-section="types"]');
      await types.locator('[data-master-action="add"]').click();
      assert.equal(await types.evaluate(section => section.open), true);
      assert.equal(await page.locator('#typeHarvestBaseDateText-0').textContent(), '26/09/12(\u571f)');
      await page.locator('.type-master-row').last().locator('[data-master-action="remove"]').click();
      await input.evaluate(input => { input.showPicker = () => { throw new Error('Picker API unsupported'); }; });
      await input.click({ position: { x: 3, y: 17 } });
      await page.keyboard.press('Escape');
      await input.evaluate(input => { input.showPicker = undefined; });
      await input.click({ position: { x: 3, y: 17 } });
      await page.keyboard.press('Escape');
      assert.equal(await input.inputValue(), '2026-09-12');
      assert.equal(backend.reads.length, reads);
      assert.equal(backend.writes.length, 0);
      assert.equal(JSON.stringify(backend.db), original);
      assert.deepEqual(backend.errors, []);
    } finally { await context.close(); }
  }
  return true;
}

module.exports = testSingleRowMasters;
if (require.main === module) {
  const { chromium } = require('playwright');
  const { scenario, unlocked } = require('./common-auth.cjs');
  (async () => {
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    try { await testSingleRowMasters(browser, scenario, unlocked); console.log('Single-row masters passed; database writes mocked.'); }
    finally { await browser.close(); }
  })().catch(error => { console.error(error); process.exitCode = 1; });
}
