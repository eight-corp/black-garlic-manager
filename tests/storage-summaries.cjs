const assert = require('node:assert/strict');
const path = require('node:path');

const appUrl = 'https://eight-corp.github.io/black-garlic-manager/';
const labels = ['\u9031\u6bce(\u5ba4)', '\u9031\u6bce(\u4fdd\u7ba1\u5eab)', '\u6708\u6bce(\u5ba4)', '\u6708\u6bce(\u4fdd\u7ba1\u5eab)', '\u30b0\u30e9\u30d5(\u5ba4)', '\u30b0\u30e9\u30d5(\u4fdd\u7ba1\u5eab)'];
const extraType = '\u9078\u5225(\u826f)';

module.exports = async function storageSummaries(browser, scenario, unlocked, assertTwoWeeklyTables) {
  const { page, context, backend } = await scenario(browser, { mobile: true });
  const types = backend.db.black_garlic_storage_types;
  types[0].display_order = 1;
  types.push({ id: 'storage-2', type_name: extraType, active: true, display_order: 2 },
    { id: 'storage-hidden', type_name: 'Hidden storage', active: false, display_order: 3 });
  const entries = backend.db.black_garlic_storage_entries;
  const template = entries[0];
  for (const [id, date, type, columns, pieces] of [
    ['extra', '2026-09-11', 'storage-2', 3, 10],
    ['hidden', '2026-09-11', 'storage-hidden', 900, 900],
    ['previous', '2026-09-04', 'storage', 5, 1],
    ['future', '2026-09-13', 'storage', 9, 5],
    ['future-extra', '2026-09-13', 'storage-2', 1, 12],
    ['year-boundary', '2026-01-01', 'storage', 6, 2],
    ['leap-day', '2024-02-29', 'storage', 7, 3]
  ]) entries.push({ ...template, id, storage_date: date, storage_type_id: type, columns16: columns, pieces });
  const original = JSON.stringify(backend.db);
  const selectView = async view => {
    await page.locator('[data-summary-view="' + view + '"]').click();
    assert.equal(await page.locator('#' + view + 'Summary').isVisible(), true);
    assert.equal(await page.locator('#summaryPanel .summary-view:visible').count(), 1);
  };
  const assertValues = async (view, date, upper, lower) => {
    const row = page.locator('#' + view + 'Summary [data-summary-date="' + date + '"]');
    assert.deepEqual(await row.locator('.cell-upper').allTextContents(), upper);
    assert.deepEqual(await row.locator('.cell-lower').allTextContents(), lower);
    assert.equal(await row.locator('td').last().evaluate(cell => getComputedStyle(cell).backgroundColor), 'rgb(255, 244, 209)');
  };
  try {
    await page.clock.setSystemTime(new Date('2026-09-12T03:00:00Z'));
    await page.goto(appUrl); await unlocked(page);
    await page.locator('[data-tab="summary"]').click();
    await page.locator('#summaryType').selectOption('type');
    await page.locator('#summaryRoom').selectOption('room');
    await page.locator('input[name="summaryMetric"][value="inventory"] + span').click();
    assert.deepEqual(await page.locator('.summary-bottom-tabs button').allTextContents(), labels);

    for (const view of ['weeklyStorage', 'monthlyStorage']) {
      await selectView(view);
      assert.equal(await page.locator('#summaryTypeFilter').isVisible(), false);
      assert.equal(await page.locator('#summaryRoomFilter').isVisible(), false);
      assert.equal(await page.locator('#summaryMetricControls').isVisible(), false);
      assert.equal(await page.locator('#summaryStartDate').isVisible(), true);
      assert.equal(await page.locator('#summaryRefreshBtn').isVisible(), true);
      const table = page.locator('#' + view + 'Summary table').first();
      assert.deepEqual(await table.locator('thead th').allTextContents(), ['\u65e5\u4ed8', '\u30a8\u30a4\u30c8R7', extraType, '\u5408\u8a08']);
      await assertValues(view, '2026-09-11', ['4', '3', '7'], ['8', '10', '18']);
      await assertValues(view, '2026-09-04', ['5', '', '5'], ['1', '', '1']);
      const noRecord = await page.locator('#' + view + 'Summary [data-summary-date="2026-09-12"] td').allTextContents();
      assert.ok(noRecord[0].trim());
      assert.ok(noRecord.slice(1).every(value => value.trim() === ''), 'no carry forward for storage');
      assert.ok((await page.locator('#' + view + 'Summary [data-summary-date="2026-09-13"] td').allTextContents()).every(value => value.trim() === ''));
      if (view === 'weeklyStorage') await assertTwoWeeklyTables(page, '2026-09-07', view);
      else {
        assert.equal(await page.locator('#monthlyStorageSummary table').count(), 1);
        assert.equal(await table.locator('tbody tr').count(), 30);
      }
      for (const width of [320, 390, 760, 761, 943, 1280]) {
        await page.setViewportSize({ width, height: 844 });
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), view + ':' + width);
        assert.ok(await page.locator('.summary-bottom-tabs').evaluate(nav => {
          const bounds = nav.getBoundingClientRect();
          return [...nav.querySelectorAll('button')].every(button => {
            const r = button.getBoundingClientRect();
            return r.left >= bounds.left && r.right <= bounds.right && r.top >= bounds.top && r.bottom <= bounds.bottom &&
              button.scrollWidth <= button.clientWidth && button.scrollHeight <= button.clientHeight &&
              document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest('button') === button;
          });
        }), 'six readable tabs:' + width);
        assert.ok(await page.locator('.main-summary-controls').evaluate(controls => {
          const bounds = controls.getBoundingClientRect();
          const fields = [...controls.querySelectorAll('input,select,button')].map(field => field.getBoundingClientRect()).filter(r => r.width);
          return fields.length === 4 && controls.scrollWidth <= controls.clientWidth && fields.every((r, index) =>
            r.left >= bounds.left && r.right <= bounds.right + .5 && Math.abs(r.top - fields[0].top) < 1 && (!index || r.left >= fields[index - 1].right));
        }), 'warehouse date controls:' + width);
        assert.ok(await table.evaluate(element => element.scrollWidth <= element.clientWidth));
        if (process.env.QA_ARTIFACTS && [320, 390, 1280].includes(width)) {
          await page.screenshot({ path: path.join(process.env.QA_ARTIFACTS, 'split-summary-' + view + '-' + width + '.png'), fullPage: true });
        }
      }
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      assert.ok(await page.locator('#' + view + 'Summary table').last().evaluate(table => table.getBoundingClientRect().bottom <= document.querySelector('.summary-bottom-tabs').getBoundingClientRect().top));
      await page.emulateMedia({ media: 'print' });
      assert.equal(await page.locator('.summary-bottom-tabs').isVisible(), false);
      assert.equal(await page.locator('#summaryPanel .summary-view:visible').count(), 1);
      assert.equal(await page.locator('#summaryPanel table:visible').count(), view === 'weeklyStorage' ? 2 : 1);
      await page.emulateMedia({ media: 'screen' });
      await page.evaluate(() => window.scrollTo(0, 0));
    }

    await selectView('monthly');
    assert.equal(await page.locator('#monthlySummary table').count(), 1);
    assert.equal(await page.locator('#summaryType').inputValue(), 'type');
    assert.equal(await page.locator('#summaryRoom').inputValue(), 'room');
    assert.equal(await page.locator('input[name="summaryMetric"]:checked').inputValue(), 'inventory');
    assert.equal(await page.locator('#summaryMetricControls').isVisible(), true);
    for (const [date, monday, monthDays, values] of [
      ['2026-09-01', '2026-08-31', 30, null],
      ['2026-01-01', '2025-12-29', 31, ['6', '2']],
      ['2024-02-29', '2024-02-26', 29, ['7', '3']],
      ['2026-02-01', '2026-01-26', 28, null]
    ]) {
      await page.locator('#summaryStartDate').fill(date);
      await selectView('weeklyStorage');
      await assertTwoWeeklyTables(page, monday, 'weeklyStorage');
      if (values) await assertValues('weeklyStorage', date, [values[0], '', values[0]], [values[1], '', values[1]]);
      await selectView('monthlyStorage');
      assert.equal(await page.locator('#monthlyStorageSummary tbody tr').count(), monthDays);
      if (values) await assertValues('monthlyStorage', date, [values[0], '', values[0]], [values[1], '', values[1]]);
    }
    await page.locator('#summaryStartDate').fill('2026-09-12');
    await page.clock.setSystemTime(new Date('2026-09-13T03:00:00Z'));
    for (const view of ['weeklyStorage', 'monthlyStorage']) {
      await selectView(view);
      await assertValues(view, '2026-09-13', ['9', '1', '10'], ['5', '12', '17']);
    }
    await page.locator('#summaryPrevDateBtn').click();
    assert.equal(await page.locator('#summaryStartDate').inputValue(), '2026-09-11');
    await selectView('weekly');
    assert.equal(await page.locator('#summaryStartDate').inputValue(), '2026-09-11');
    await page.locator('[data-tab="main"]').click();
    assert.ok(!await page.locator('body').evaluate(body => body.classList.contains('summary-storage-active')));
    assert.equal(backend.writes.length, 0);
    assert.equal(JSON.stringify(backend.db), original);
    assert.deepEqual(backend.errors, []);
    return true;
  } finally { await context.close(); }
};
