const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const commonRoot = process.env.COMMON_MENU_REPO || path.resolve(root, '../garlic-liff-scanner-repo');
const appUrl = 'https://eight-corp.github.io/black-garlic-manager/';
const menuUrl = 'https://eight-corp.github.io/garlic-liff-scanner/menu.html';
const token = 'a'.repeat(64);
const workerName = '\u30c6\u30b9\u30c8\u4f5c\u696d\u8005';
const artifacts = process.env.QA_ARTIFACTS;

async function scenario(browser, options = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
  const backend = {
    role: options.role ?? 'admin', loggedIn: options.loggedIn ?? true,
    reads: [], readQueries: [], writes: [], logins: 0, logouts: 0, errors: [],
    db: {
      workers: [{ worker_id: 'other', worker_name: 'Other', active: true, note: 'PIN:111111' }, { worker_id: 'tester', worker_name: workerName, active: false, note: 'PIN:999999' }],
      black_garlic_rooms: [{ id: 'room', room_name: '\u516d\u6238\u2460', active: true }],
      black_garlic_types: [{ id: 'type', type_name: '\u30a8\u30a4\u30c8', active: true }],
      black_garlic_storage_types: [{ id: 'storage', type_name: '\u30a8\u30a4\u30c8R7', active: true }],
      black_garlic_harvest_lots: [{ id: 'lot', lot_name: '\u672a\u6307\u5b9a', harvest_date: '2026-01-01', active: true }],
      black_garlic_age_brackets: [], black_garlic_maturation_rules: [], black_garlic_settings: [],
      black_garlic_entries: [{ id: 'old-main', entry_date: '2026-09-11', recorded_at: '2026-09-11T03:00:00Z', room_id: 'room', type_id: 'type', harvest_lot_id: 'lot', worker_id: 'other', inventory_qty: 8, inventory_manual: true, out_qty: 2, in_qty: 10, empty_qty: 1, note: '' }],
      black_garlic_storage_entries: [{ id: 'old-storage', storage_date: '2026-09-11', recorded_at: '2026-09-11T03:00:00Z', storage_type_id: 'storage', worker_id: 'other', columns16: 4, pieces: 8, note: '' }]
    }
  };
  await context.addInitScript(({ initialToken }) => {
    if (location.origin !== 'https://eight-corp.github.io') return;
    if (localStorage.getItem('test.seeded')) return;
    localStorage.setItem('test.seeded', '1');
    if (initialToken) localStorage.setItem('business.session.v1', initialToken);
    localStorage.setItem('blackGarlicWorkerId', 'other');
    localStorage.setItem('blackGarlicSavedPins', JSON.stringify({ other: '111111' }));
  }, { initialToken: options.token ?? token });
  const files = new Map([
    ['/black-garlic-manager/', path.join(root, 'index.html')],
    ...['index.html', 'styles.css', 'app.js', 'config.js'].map(file => ['/black-garlic-manager/' + file, path.join(root, file)]),
    ...['menu.html', 'menu.js', 'shared/business-auth.js', 'shared/business-config.js'].map(file => ['/garlic-liff-scanner/' + file, path.join(commonRoot, file)])
  ]);
  await context.route('https://eight-corp.github.io/**', route => {
    const pathname = new URL(route.request().url()).pathname;
    const file = files.get(pathname);
    if (options.missingAuth && pathname.endsWith('/business-auth.js')) return route.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
    if (process.env.USE_PUBLISHED_SOURCE) return route.continue();
    assert.ok(file, 'Unexpected source request: ' + pathname);
    const contentType = file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html';
    return route.fulfill({ path: file, contentType });
  });
  await context.route('https://example.invalid/**', route => {
    assert.equal(route.request().headers()['x-business-session'], undefined);
    return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' }, body: 'ok' });
  });
  const reply = (route, value, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
  const matches = (row, url) => [...url.searchParams].every(([key, value]) => !value.startsWith('eq.') || String(row[key]) === value.slice(3));
  await context.route('**/rest/v1/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const resource = url.pathname.split('/rest/v1/')[1];
    const suppliedToken = request.headers()['x-business-session'];
    const valid = backend.loggedIn && suppliedToken === token;
    if (resource.startsWith('rpc/')) {
      const name = resource.slice(4);
      assert.equal(request.method(), 'POST');
      if (name === 'business_login_users') return reply(route, request.postDataJSON().p_app_id === 'black_garlic' ? [{ workerId: 'tester', workerName }] : []);
      if (name === 'business_login') {
        assert.deepEqual(request.postDataJSON(), { p_worker_id: 'tester', p_pin: '012345', p_app_id: 'black_garlic' });
        backend.loggedIn = true; backend.logins++;
        return reply(route, { ok: true, token });
      }
      if (name === 'business_logout') {
        backend.loggedIn = false; backend.logouts++;
        if (options.logoutFailure) return route.abort('failed');
        return reply(route, { ok: true });
      }
      assert.equal(name, 'business_session');
      if (!valid) return reply(route, { ok: false, error: 'Login required' });
      return reply(route, { ok: true, workerId: 'tester', workerName, systemAdmin: false, permissions: backend.role ? { ...options.menuPermissions, black_garlic: backend.role } : { garlic_fridge: 'viewer' } });
    }
    assert.ok(backend.db[resource], 'Unexpected database request: ' + resource);
    assert.equal(suppliedToken, token);
    if (request.method() === 'GET') {
      backend.reads.push(resource);
      backend.readQueries.push({ resource, params: Object.fromEntries(url.searchParams) });
      const rows = backend.db[resource].filter(row => matches(row, url));
      const order = url.searchParams.get('order');
      if (order) rows.sort((a, b) => {
        for (const item of order.split(',')) {
          const [key, direction] = item.split('.');
          const difference = String(a[key] ?? '').localeCompare(String(b[key] ?? ''));
          if (difference) return direction === 'desc' ? -difference : difference;
        }
        return 0;
      });
      const offset = Number(url.searchParams.get('offset') || 0);
      const limit = Math.min(Number(url.searchParams.get('limit') || rows.length), options.pageLimit ?? 1000);
      const data = rows.slice(offset, offset + limit);
      return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-expose-headers': 'content-range', 'content-range': data.length ? offset + '-' + (offset + data.length - 1) + '/' + rows.length : '*/' + rows.length }, body: JSON.stringify(data) });
    }
    assert.ok(valid);
    const master = !['black_garlic_entries', 'black_garlic_storage_entries', 'black_garlic_settings'].includes(resource);
    assert.ok(master ? backend.role === 'admin' : ['admin', 'operator'].includes(backend.role));
    const payload = request.postDataJSON();
    backend.writes.push({ resource, method: request.method(), payload });
    if (request.method() === 'DELETE') backend.db[resource] = backend.db[resource].filter(row => !matches(row, url));
    else if (request.method() === 'PATCH') backend.db[resource].filter(row => matches(row, url)).forEach(row => Object.assign(row, payload));
    else {
      assert.equal(request.method(), 'POST');
      const key = resource === 'black_garlic_entries' ? ['entry_date', 'room_id', 'type_id', 'harvest_lot_id'] : resource === 'black_garlic_storage_entries' ? ['storage_date', 'storage_type_id'] : ['setting_key'];
      const existing = backend.db[resource].find(row => key.every(field => row[field] === payload[field]));
      if (existing) Object.assign(existing, payload);
      else backend.db[resource].push({ ...payload, id: 'new-' + backend.writes.length });
    }
    return reply(route, []);
  });
  context.on('page', page => {
    page.on('pageerror', error => backend.errors.push(error.message));
    page.on('dialog', dialog => dialog.dismiss());
  });
  const page = await context.newPage();
  return { context, backend, page };
}

const unlocked = page => page.waitForFunction(() => document.body && !document.body.classList.contains('login-locked') && document.querySelector('#currentWorker')?.textContent);
async function openFromMenu(page, context) {
  const popup = context.waitForEvent('page');
  await page.locator('#blackGarlicGithubLink').click();
  const app = await popup;
  await unlocked(app);
  assert.ok(app.url().startsWith(appUrl));
  return app;
}

async function chooseSummaryMetric(page, metric) {
  await page.locator('input[name="summaryMetric"][value="' + metric + '"] + span').click();
  assert.equal(await page.locator('input[name="summaryMetric"]:checked').inputValue(), metric);
}

async function assertFourWeeklyTables(page, monday) {
  const tables = page.locator('#weeklySummary table');
  const periods = page.locator('#weeklySummary .summary-period');
  assert.equal(await tables.count(), 4);
  assert.equal(await periods.count(), 4);
  const dates = [];
  for (let week = 0; week < 4; week++) {
    const expected = Array.from({ length: 7 }, (_, day) => {
      const date = new Date(monday + 'T00:00:00Z');
      date.setUTCDate(date.getUTCDate() - week * 7 + day);
      return date.toISOString().slice(0, 10);
    });
    const actual = await tables.nth(week).locator('tbody tr').evaluateAll(rows => rows.map(row => row.dataset.summaryDate));
    assert.deepEqual(actual, expected);
    assert.equal(await periods.nth(week).textContent(), expected[0] + '\u301c' + expected[6]);
    assert.equal(await tables.nth(week).locator('tbody tr').last().locator('td').first().evaluate(cell => getComputedStyle(cell).backgroundColor), 'rgb(255, 240, 240)');
    dates.push(...actual);
  }
  assert.equal(new Set(dates).size, 28);
}

async function run() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const results = {};
  try {
    const current = await scenario(browser, { token: '', loggedIn: false, menuPermissions: { garlic_fridge: 'viewer', garlic_drying: 'viewer', frozen_ingredients: 'viewer', rice_shipping: 'viewer' } });
    const { context, backend, page: menu } = current;
    await menu.goto(menuUrl);
    assert.equal(await menu.locator('#blackGarlicGithubLink').isVisible(), false);
    await menu.locator('#loginPin').fill('012345');
    await menu.locator('#loginForm button').click();
    await menu.locator('#menuPanel').waitFor({ state: 'visible' });
    assert.equal(await menu.locator('[data-app="black_garlic"]:not([data-min-role])').getAttribute('href'), 'https://script.google.com/macros/s/AKfycbwmd8R9b6DG6-XYUxAa1gguvaFb71WGXbXPatdiaD2MKSR9wJ3mAEOEYOHyL7SDDpSc/exec?openExternalBrowser=1');
    assert.equal(await menu.locator('[data-app="rice_shipping"]').evaluate(card => card.nextElementSibling.id), 'blackGarlicGithubLink');
    assert.equal(await menu.locator('#blackGarlicGithubLink').isVisible(), true);
    assert.ok((await menu.locator('#blackGarlicGithubLink').getAttribute('href')).startsWith(appUrl));
    for (const width of [320, 390, 943, 1280]) {
      await menu.setViewportSize({ width, height: 844 });
      assert.ok(await menu.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      if (artifacts) await menu.screenshot({ path: path.join(artifacts, 'menu-gas-github-admin-' + width + '.png'), fullPage: true });
    }
    let app = await openFromMenu(menu, context);
    assert.equal(backend.logins, 1);
    assert.equal(await app.locator('#currentWorker').textContent(), workerName);
    assert.equal(await app.locator('#workerSelect,#loginBtn,#loginPin,#setupPanel').count(), 0);
    assert.ok(await app.evaluate(() => !localStorage.getItem('blackGarlicSavedPins') && !localStorage.getItem('blackGarlicWorkerId')));
    const writesBeforeSummary = backend.writes.length;
    await app.locator('[data-tab="summary"]').click();
    assert.equal(await app.locator('#dailySummary,[data-summary-view="daily"]').count(), 0);
    assert.equal(await app.locator('#weeklySummary').isVisible(), true);
    assert.equal(await app.locator('input[name="summaryMetric"]:checked').inputValue(), 'out');
    const summaryMax = await app.locator('#summaryStartDate').getAttribute('max');
    assert.equal(await app.locator('#summaryStartDate').inputValue(), summaryMax);
    assert.equal(await app.locator('#summaryNextDateBtn').isDisabled(), true);
    await app.locator('#summaryStartDate').fill('2026-09-12');
    assert.equal(await app.locator('#summaryStartDateWeekday').textContent(), '\uff08\u571f\u66dc\u65e5\uff09');
    await app.locator('#summaryPrevDateBtn').click();
    assert.equal(await app.locator('#summaryStartDate').inputValue(), '2026-09-11');
    assert.equal(await app.locator('#summaryStartDateWeekday').textContent(), '\uff08\u91d1\u66dc\u65e5\uff09');
    assert.equal(await app.locator('#summaryNextDateBtn').isDisabled(), false);
    assert.ok((await app.locator('#weeklySummary .summary-period').first().textContent()).startsWith('2026-09-07'));
    await app.locator('#summaryNextDateBtn').click();
    assert.equal(await app.locator('#summaryStartDate').inputValue(), '2026-09-12');
    assert.equal(await app.locator('#summaryStartDateWeekday').textContent(), '\uff08\u571f\u66dc\u65e5\uff09');
    for (const [date, previous] of [['2026-09-01', '2026-08-31'], ['2026-01-01', '2025-12-31'], ['2024-03-01', '2024-02-29']]) {
      await app.locator('#summaryStartDate').fill(date);
      await app.locator('#summaryPrevDateBtn').click();
      assert.equal(await app.locator('#summaryStartDate').inputValue(), previous);
      await app.locator('#summaryNextDateBtn').click();
      assert.equal(await app.locator('#summaryStartDate').inputValue(), date);
    }
    await app.locator('#summaryStartDate').evaluate(input => {
      const nextDay = new Date(input.max + 'T12:00:00');
      nextDay.setDate(nextDay.getDate() + 1);
      input.value = nextDay.getFullYear() + '-' + String(nextDay.getMonth() + 1).padStart(2, '0') + '-' + String(nextDay.getDate()).padStart(2, '0');
      input.dispatchEvent(new Event('change'));
    });
    assert.equal(await app.locator('#summaryStartDate').inputValue(), summaryMax);
    assert.equal(await app.locator('#summaryNextDateBtn').isDisabled(), true);
    await app.locator('#summaryNextDateBtn').evaluate(button => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    assert.equal(await app.locator('#summaryStartDate').inputValue(), summaryMax);
    await app.locator('#summaryStartDate').fill('');
    assert.equal(await app.locator('#summaryStartDate').inputValue(), summaryMax);
    await app.locator('#summaryStartDate').fill('2026-09-12');
    for (const view of ['weekly', 'monthly', 'graph']) {
      await app.locator('[data-summary-view="' + view + '"]').click();
      assert.equal(await app.locator('#summaryMetricControls').isVisible(), view !== 'graph');
      for (const width of [320, 390, 760, 761, 943, 1280]) {
        await app.setViewportSize({ width, height: 844 });
        await app.waitForFunction(() => {
          const bar = document.querySelector('.summary-bottom-tabs').getBoundingClientRect();
          const main = document.querySelector('.tabs').getBoundingClientRect();
          return bar.height > 0 && Math.abs(bar.bottom - main.top) < 1;
        });
        assert.ok(await app.locator('.summary-bottom-tabs').evaluate(element => {
          const bounds = element.getBoundingClientRect();
          const main = document.querySelector('.tabs').getBoundingClientRect();
          const buttons = [...element.querySelectorAll('button')];
          return getComputedStyle(element).position === 'fixed' && bounds.top > innerHeight * .6 && bounds.bottom <= main.top + .5 &&
            Math.abs(main.bottom - innerHeight) < 1 && buttons.length === 3 && element.querySelectorAll('.active').length === 1 &&
            buttons.every(button => { const r = button.getBoundingClientRect(); return r.left >= bounds.left && r.right <= bounds.right && r.top >= bounds.top && r.bottom <= bounds.bottom && button.scrollWidth <= button.clientWidth && document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest('button') === button; });
        }), 'bottom tabs:' + view + ':' + width);
        assert.ok(await app.locator('.main-summary-controls').evaluate(element => {
          const bounds = element.getBoundingClientRect();
          const fields = [...element.querySelectorAll('input,select,button')].filter(field => field.getBoundingClientRect().width);
          const date = element.querySelector('#summaryStartDate').getBoundingClientRect();
          const previous = element.querySelector('#summaryPrevDateBtn').getBoundingClientRect();
          const next = element.querySelector('#summaryNextDateBtn').getBoundingClientRect();
          const weekday = element.querySelector('#summaryStartDateWeekday').getBoundingClientRect();
          const dateGroup = element.querySelector('.summary-date-controls').getBoundingClientRect();
          return fields.length === 6 && element.scrollWidth <= element.clientWidth && date.width >= 106 && weekday.right <= dateGroup.right &&
            previous.left >= date.right && next.left >= previous.right && Math.abs(previous.top - date.top) < 1 && Math.abs(next.top - date.top) < 1 &&
            fields.every((field, index) => { const r = field.getBoundingClientRect(); return r.left >= bounds.left && r.right <= bounds.right + .5 && Math.abs(r.top - date.top) < 1 && (!index || r.left >= fields[index - 1].getBoundingClientRect().right); });
        }), view + ':' + width);
        if (view !== 'graph') {
          assert.ok(await app.locator('.summary-metric-options').evaluate(element => {
            const bounds = element.getBoundingClientRect();
            const segments = [...element.querySelectorAll('span')];
            return element.scrollWidth <= element.clientWidth && segments.every(segment => {
              const r = segment.getBoundingClientRect();
              return r.left >= bounds.left && r.right <= bounds.right && r.height >= 36 && segment.scrollWidth <= segment.clientWidth;
            });
          }), 'metric controls:' + view + ':' + width);
        }
        if (artifacts && [390, 943].includes(width)) await app.screenshot({ path: path.join(artifacts, 'summary-metrics-' + view + '-' + width + '.png'), fullPage: true });
      }
    }
    await app.locator('[data-summary-view="weekly"]').click();
    results.summaryWeekdayDateButtonsBoundariesFutureLimitAndResponsiveViews = true;
    for (const type of ['All', 'type']) {
      await app.locator('#summaryType').selectOption(type);
      for (const view of ['weekly', 'monthly']) {
        await app.locator('[data-summary-view="' + view + '"]').click();
        const table = app.locator('#' + view + 'Summary table').first();
        assert.deepEqual(await table.locator('thead th').allTextContents(), ['\u65e5\u4ed8', '\u516d\u6238\u2460', '\u5408\u8a08']);
        assert.equal(await table.locator('tbody tr').count(), view === 'weekly' ? 7 : 30);
        for (const [metric, value, color] of [['out', '2', 'rgb(217, 83, 79)'], ['in', '10', 'rgb(0, 123, 255)'], ['empty', '1', null], ['inventory', '8', null]]) {
          await chooseSummaryMetric(app, metric);
          const cells = app.locator('#' + view + 'Summary [data-summary-date="2026-09-11"] td');
          assert.deepEqual((await cells.allTextContents()).slice(1), [value, value]);
          if (color) assert.equal(await cells.nth(1).evaluate(cell => getComputedStyle(cell).color), color);
          assert.equal(await cells.last().evaluate(cell => getComputedStyle(cell).backgroundColor), 'rgb(255, 244, 209)');
          const nextDay = app.locator('#' + view + 'Summary [data-summary-date="2026-09-12"] td');
          assert.deepEqual((await nextDay.allTextContents()).slice(1), metric === 'inventory' ? ['8', '8'] : ['0', '0']);
        }
        if (view === 'weekly') {
          await assertFourWeeklyTables(app, '2026-09-07');
          assert.equal(await table.locator('tbody tr').first().getAttribute('data-summary-date'), '2026-09-07');
          assert.equal(await table.locator('tbody tr').last().getAttribute('data-summary-date'), '2026-09-13');
          assert.equal(await table.locator('tbody tr').last().locator('td').first().evaluate(cell => getComputedStyle(cell).backgroundColor), 'rgb(255, 240, 240)');
        } else {
          assert.equal(await app.locator('#monthlySummary table').count(), 2);
          const storage = app.locator('#monthlySummary table').last().locator('tbody tr').nth(10);
          assert.deepEqual(await storage.locator('.cell-upper').allTextContents(), ['4', '4']);
          assert.deepEqual(await storage.locator('.cell-lower').allTextContents(), ['8', '8']);
        }
      }
    }
    for (const [date, monday, sunday, monthDays] of [
      ['2026-09-01', '2026-08-31', '2026-09-06', 30],
      ['2026-01-01', '2025-12-29', '2026-01-04', 31],
      ['2024-02-29', '2024-02-26', '2024-03-03', 29],
      ['2026-02-01', '2026-01-26', '2026-02-01', 28]
    ]) {
      await app.locator('[data-summary-view="weekly"]').click();
      await app.locator('#summaryStartDate').fill(date);
      await assertFourWeeklyTables(app, monday);
      const days = app.locator('#weeklySummary table').first().locator('tbody tr');
      assert.equal(await days.first().getAttribute('data-summary-date'), monday);
      assert.equal(await days.last().getAttribute('data-summary-date'), sunday);
      await app.locator('[data-summary-view="monthly"]').click();
      assert.equal(await app.locator('#monthlySummary table').first().locator('tbody tr').count(), monthDays);
    }
    results.fourWeeksNewestFirstMondayToSundayMonthYearAndLeapBoundaries = true;
    await app.locator('#summaryStartDate').fill('2026-09-12');
    await app.locator('[data-summary-view="weekly"]').click();
    for (const width of [320, 390, 943, 1280]) {
      await app.setViewportSize({ width, height: 844 });
      assert.ok(await app.locator('#weeklySummary').evaluate(element => element.scrollWidth <= element.clientWidth));
      if (artifacts) await app.screenshot({ path: path.join(artifacts, 'weekly-selected-stock-' + width + '.png'), fullPage: true });
    }
    await app.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    assert.ok(await app.locator('#weeklySummary table').last().evaluate(element => element.getBoundingClientRect().bottom <= document.querySelector('.summary-bottom-tabs').getBoundingClientRect().top));
    await app.emulateMedia({ media: 'print' });
    assert.equal(await app.locator('.summary-bottom-tabs').isVisible(), false);
    assert.equal(await app.locator('.tabs').isVisible(), false);
    assert.equal(await app.locator('#summaryMetricControls').isVisible(), false);
    assert.equal(await app.locator('main').evaluate(element => getComputedStyle(element).paddingBottom), '0px');
    await app.emulateMedia({ media: 'screen' });
    results.bottomSummaryTabsClickableAllViewsLastTableAccessibleAndHiddenInPrint = true;
    assert.equal(backend.writes.length, writesBeforeSummary);
    results.weeklyAndMonthlyMetricMatricesTotalsColorsPeriodsAndStoragePreserved = true;
    await app.locator('[data-tab="main"]').click();
    assert.equal(await app.locator('.summary-bottom-tabs').isVisible(), false);
    await app.locator('#mainDate').fill('2026-09-12');
    await app.locator('#mainOut').fill('2');
    await app.locator('#mainIn').fill('10');
    await app.evaluate(() => localStorage.setItem('blackGarlicWorkerId', 'other'));
    await app.locator('#mainSubmitBtn').click();
    await app.waitForFunction(() => document.querySelector('#mainStatus').textContent === '\u4fdd\u5b58\u6e08\u307f');
    const mainWrite = backend.writes.find(item => item.resource === 'black_garlic_entries' && item.method === 'POST');
    assert.equal(mainWrite.payload.worker_id, 'tester');
    assert.equal(backend.db.black_garlic_entries.at(-1).inventory_qty, 16);
    assert.equal(await app.locator('#mainOut').inputValue(), '');
    await app.locator('[data-tab="storage"]').click();
    await app.locator('#storageDate').fill('2026-09-12');
    await app.locator('#storageColumns').fill('26');
    await app.locator('#storagePieces').fill('8');
    await app.locator('#storageForm button[type="submit"]').click();
    await app.waitForFunction(() => document.querySelector('#storageStatus').textContent === '\u4fdd\u5b58\u6e08\u307f');
    assert.equal(backend.writes.find(item => item.resource === 'black_garlic_storage_entries').payload.worker_id, 'tester');
    assert.equal(await app.locator('#storageDateWeekday').textContent(), '\uff08\u571f\u66dc\u65e5\uff09');
    for (const width of [320, 390, 943, 1280]) {
      await app.setViewportSize({ width, height: 844 });
      assert.ok(await app.locator('.header-row').evaluate(element => {
        const bounds = element.getBoundingClientRect();
        return [...element.querySelectorAll('button,.current-worker')].every(child => {
          const r = child.getBoundingClientRect();
          return r.left >= bounds.left && r.right <= bounds.right + .5;
        });
      }));
      if (artifacts) await app.screenshot({ path: path.join(artifacts, 'menu-auth-storage-' + width + '.png'), fullPage: true });
    }
    await app.evaluate(() => BusinessAuth.authorizedFetch('https://example.invalid/no-session-leak'));
    await app.locator('[data-tab="master"]').click();
    backend.role = 'operator';
    await app.locator('#reloadBtn').click();
    await app.locator('[data-tab="master"]').waitFor({ state: 'hidden' });
    assert.equal(await app.locator('#mainPanel').isVisible(), true);
    const beforeMaster = backend.writes.length;
    await app.locator('#masterSaveBtn').evaluate(button => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await app.locator('#toast').waitFor({ state: 'visible' });
    assert.equal(backend.writes.length, beforeMaster);
    backend.role = 'viewer';
    await app.locator('#reloadBtn').click();
    await app.locator('#mainForm').waitFor({ state: 'hidden' });
    for (const prefix of ['main', 'storage']) {
      await app.locator('[data-tab="' + prefix + '"]').click();
      await app.locator('#' + prefix + 'HistoryDate').fill('2026-09-11');
      assert.ok(await app.locator('#' + prefix + 'History .row-delete-btn').evaluateAll(buttons => buttons.length > 0 && buttons.every(button => button.disabled)));
      await app.locator('#' + prefix + 'HistoryType').selectOption('All');
      assert.ok(await app.locator('#' + prefix + 'History .row-delete-btn').evaluateAll(buttons => buttons.every(button => button.disabled)));
    }
    const beforeViewer = backend.writes.length;
    await app.locator('[data-tab="prediction"]').click();
    await app.locator('#predictionRefreshBtn').click();
    await app.locator('#predictionRefreshBtn').waitFor({ state: 'visible' });
    await app.waitForFunction(() => !document.querySelector('#predictionRefreshBtn').disabled);
    assert.equal(backend.writes.length, beforeViewer);
    assert.equal(await app.locator('#avgUsage').evaluate(input => input.readOnly), true);
    backend.role = 'admin';
    await app.locator('#reloadBtn').click();
    await app.waitForFunction(() => !document.querySelector('[data-tab="master"]').classList.contains('hidden'));
    await app.locator('[data-tab="main"]').click();
    await app.locator('#mainForm').waitFor({ state: 'visible' });
    await app.locator('#menuBtn').click();
    await app.waitForURL(url => url.pathname.endsWith('/menu.html'));
    await app.locator('#menuPanel').waitFor({ state: 'visible' });
    assert.equal(await app.evaluate(() => localStorage.getItem('business.session.v1')), token);
    app = await openFromMenu(app, context);
    await app.locator('#logoutBtn').click();
    await app.waitForURL(url => url.pathname.endsWith('/menu.html'));
    await app.locator('#loginPanel').waitFor({ state: 'visible' });
    assert.equal(await app.evaluate(() => localStorage.getItem('business.session.v1')), null);
    assert.equal(backend.logouts, 1);
    assert.deepEqual(backend.errors, []);
    results.menuLoginNewTabRegistrationRolesMenuReturnLogout = true;
    await context.close();

    const rooms = await scenario(browser);
    const roomName2 = '\u516d\u6238\u2461';
    rooms.backend.db.black_garlic_rooms.push({ id: 'room2', room_name: roomName2, active: true }, { id: 'hidden-room', room_name: 'Hidden room', active: false });
    rooms.backend.db.black_garlic_types.push({ id: 'type2', type_name: '\u9752\u5e78', active: true }, { id: 'hidden-type', type_name: 'Hidden type', active: false });
    const sample = rooms.backend.db.black_garlic_entries[0];
    rooms.backend.db.black_garlic_entries.push(
      { ...sample, id: 'previous-week', entry_date: '2026-09-04', inventory_qty: 6, out_qty: 3, in_qty: 4, empty_qty: 2 },
      { ...sample, id: 'previous-inventory', entry_date: '2026-09-10', inventory_qty: 20, out_qty: 0, in_qty: 0, empty_qty: 0 },
      { ...sample, id: 'room2-entry', room_id: 'room2', out_qty: 1, in_qty: 6, empty_qty: 2, inventory_qty: 5 },
      { ...sample, id: 'type2-entry', type_id: 'type2', out_qty: 4, in_qty: 7, empty_qty: 3, inventory_qty: 3 },
      { ...sample, id: 'hidden-room-entry', room_id: 'hidden-room', out_qty: 100, in_qty: 200, empty_qty: 50, inventory_qty: 100 },
      { ...sample, id: 'hidden-type-entry', type_id: 'hidden-type', out_qty: 100, in_qty: 300, empty_qty: 100, inventory_qty: 200 }
    );
    await rooms.page.goto(appUrl); await unlocked(rooms.page);
    await rooms.page.locator('[data-tab="summary"]').click();
    await rooms.page.locator('#summaryStartDate').fill('2026-09-11');
    assert.equal(await rooms.page.locator('#summaryRoomFilter').isVisible(), true);
    assert.deepEqual(await rooms.page.locator('#summaryRoom option').evaluateAll(options => options.map(option => option.value)), ['All', 'room', 'room2']);
    for (const [type, room, count, totals] of [
      ['All', 'All', 2, ['7', '23', '6', '16']],
      ['All', 'room', 1, ['6', '17', '4', '11']],
      ['type', 'All', 2, ['3', '16', '3', '13']],
      ['type', 'room2', 1, ['1', '6', '2', '5']],
      ['type2', 'room2', 1, ['0', '0', '0', '0']]
    ]) {
      await rooms.page.locator('#summaryType').selectOption(type);
      await rooms.page.locator('#summaryRoom').selectOption(room);
      for (const view of ['weekly', 'monthly']) {
        await rooms.page.locator('[data-summary-view="' + view + '"]').click();
        const table = rooms.page.locator('#' + view + 'Summary table').first();
        assert.equal(await table.locator('thead th').count(), count + 2);
        assert.equal(await table.locator('tbody tr').count(), view === 'weekly' ? 7 : 30);
        if (view === 'weekly') assert.equal(await rooms.page.locator('#weeklySummary table').count(), 4);
        for (const [index, metric] of ['out', 'in', 'empty', 'inventory'].entries()) {
          await chooseSummaryMetric(rooms.page, metric);
          await rooms.page.locator('#summaryRefreshBtn').click();
          const row = rooms.page.locator('#' + view + 'Summary [data-summary-date="2026-09-11"]');
          const cells = await row.locator('td').allTextContents();
          assert.equal(cells.at(-1), totals[index], view + ':' + metric + ':' + type + ':' + room);
          assert.equal(cells.length, count + 2);
          assert.equal(await row.locator('.total-col').count(), 1);
          assert.ok(!(await table.locator('thead').textContent()).includes('Hidden'));
          assert.equal(cells.slice(1, -1).reduce((total, value) => total + Number(value), 0), Number(totals[index]));
          const previousWeek = rooms.page.locator('#' + view + 'Summary [data-summary-date="2026-09-04"] td').last();
          const previousValue = room !== 'room2' && ['All', 'type'].includes(type) ? ['3', '4', '2', '6'][index] : '0';
          assert.equal(await previousWeek.textContent(), previousValue, 'previous week:' + view + ':' + metric + ':' + type + ':' + room);
        }
        if (room === 'room2') {
          assert.equal(await table.locator('thead th').nth(1).textContent(), roomName2);
          assert.ok((await rooms.page.locator('#' + view + 'Summary .print-title').first().textContent()).includes(roomName2));
        }
      }
    }
    await rooms.page.locator('#summaryType').selectOption('type');
    await rooms.page.locator('#summaryRoom').selectOption('room2');
    await rooms.page.locator('[data-summary-view="weekly"]').click();
    await rooms.page.locator('[data-summary-view="monthly"]').click();
    assert.equal(await rooms.page.locator('#summaryRoom').inputValue(), 'room2');
    assert.equal(await rooms.page.locator('#summaryType').inputValue(), 'type');
    assert.equal(await rooms.page.locator('input[name="summaryMetric"]:checked').inputValue(), 'inventory');
    await rooms.page.locator('#summaryNextDateBtn').click();
    for (const view of ['weekly', 'monthly']) {
      await rooms.page.locator('[data-summary-view="' + view + '"]').click();
      for (const metric of ['out', 'in', 'empty', 'inventory']) {
        await chooseSummaryMetric(rooms.page, metric);
        const carried = await rooms.page.locator('#' + view + 'Summary [data-summary-date="2026-09-12"] td').allTextContents();
        assert.deepEqual(carried.slice(1), metric === 'inventory' ? ['5', '5'] : ['0', '0']);
      }
      for (const width of [320, 390, 943]) {
        await rooms.page.setViewportSize({ width, height: 844 });
        assert.ok(await rooms.page.locator('#' + view + 'Summary').evaluate(element => element.scrollWidth <= element.clientWidth));
        if (artifacts) await rooms.page.screenshot({ path: path.join(artifacts, 'summary-filtered-' + view + '-' + width + '.png'), fullPage: true });
      }
    }
    await rooms.page.locator('#summaryRoom').selectOption('All');
    await rooms.page.locator('#summaryType').selectOption('All');
    assert.deepEqual((await rooms.page.locator('#monthlySummary [data-summary-date="2026-09-10"] td').allTextContents()).slice(1), ['20', '0', '20']);
    for (const metric of ['out', 'in', 'empty', 'inventory']) {
      await chooseSummaryMetric(rooms.page, metric);
      for (const view of ['weekly', 'monthly', 'graph', 'weekly']) {
        await rooms.page.locator('[data-summary-view="' + view + '"]').click();
        assert.equal(await rooms.page.locator('input[name="summaryMetric"]:checked').inputValue(), metric);
      }
    }
    assert.equal(rooms.backend.writes.length, 0);
    assert.deepEqual(rooms.backend.errors, []);
    results.metricRoomAndTypeFiltersTotalsHiddenMastersStockSnapshotsAndCarryForward = true;
    await rooms.context.close();

    const paginated = await scenario(browser, { pageLimit: 700 });
    const template = paginated.backend.db.black_garlic_entries[0];
    const firstDate = new Date('2023-01-01T00:00:00Z');
    paginated.backend.db.black_garlic_entries = Array.from({ length: 1164 }, (_, index) => {
      const date = new Date(firstDate);
      date.setUTCDate(date.getUTCDate() + index);
      return { ...template, id: 'page-' + String(index).padStart(4, '0'), entry_date: date.toISOString().slice(0, 10), inventory_qty: index, out_qty: 1, in_qty: 2, empty_qty: 3 };
    });
    await paginated.page.goto(appUrl); await unlocked(paginated.page);
    const mainPages = paginated.backend.readQueries.filter(query => query.resource === 'black_garlic_entries' && !query.params.room_id);
    assert.deepEqual(mainPages.map(query => Number(query.params.offset || 0)), [0, 700]);
    for (const index of [0, 699, 700, 1163]) {
      await paginated.page.locator('#mainHistoryDate').fill(paginated.backend.db.black_garlic_entries[index].entry_date);
      assert.equal(await paginated.page.locator('#mainHistory [data-main-id]').count(), 1);
      assert.equal(await paginated.page.locator('#mainHistory [data-main-id]').getAttribute('data-main-id'), 'page-' + String(index).padStart(4, '0'));
    }
    await paginated.page.locator('[data-tab="summary"]').click();
    await paginated.page.locator('#summaryStartDate').fill(paginated.backend.db.black_garlic_entries[1163].entry_date);
    await chooseSummaryMetric(paginated.page, 'inventory');
    assert.equal(await paginated.page.locator('#weeklySummary [data-summary-date="' + paginated.backend.db.black_garlic_entries[1163].entry_date + '"] .total-col').textContent(), '1,163');
    assert.equal(paginated.backend.writes.length, 0);
    assert.deepEqual(paginated.backend.errors, []);
    results.all1164RowsLoadedDespiteServerPageLimit700 = true;
    await paginated.context.close();

    for (const role of ['operator', 'viewer']) {
      const test = await scenario(browser, { role });
      await test.page.goto(menuUrl);
      await test.page.locator('#menuPanel').waitFor({ state: 'visible' });
      assert.equal(await test.page.locator('[data-app="black_garlic"]:not([data-min-role])').isVisible(), true);
      assert.equal(await test.page.locator('#blackGarlicGithubLink').isVisible(), false);
      assert.equal(await test.page.locator('#noApps').isVisible(), false);
      assert.deepEqual(test.backend.errors, []);
      results['gasMenuOnlyFor' + role] = true;
      await test.context.close();
    }

    for (const [name, options] of [
      ['noSessionDespiteLegacyPin', { token: '', loggedIn: false }],
      ['expiredSession', { loggedIn: false }],
      ['noAppPermission', { role: '' }]
    ]) {
      const test = await scenario(browser, options);
      await test.page.goto(appUrl);
      await test.page.waitForURL(url => url.pathname.endsWith('/menu.html'));
      assert.equal(test.backend.reads.length, 0);
      assert.equal(test.backend.writes.length, 0);
      assert.deepEqual(test.backend.errors, []);
      if (name === 'noAppPermission') {
        await test.page.locator('#menuPanel').waitFor({ state: 'visible' });
        assert.equal(await test.page.evaluate(() => localStorage.getItem('business.session.v1')), token);
        assert.equal(await test.page.locator('[data-app="black_garlic"]:not([data-min-role])').isVisible(), false);
        assert.equal(await test.page.locator('#blackGarlicGithubLink').isVisible(), false);
      }
      results[name] = true;
      await test.context.close();
    }
    const revoked = await scenario(browser);
    await revoked.page.goto(appUrl); await unlocked(revoked.page);
    await revoked.page.locator('#mainIn').fill('5');
    revoked.backend.loggedIn = false;
    await revoked.page.locator('#mainSubmitBtn').click();
    await revoked.page.waitForURL(url => url.pathname.endsWith('/menu.html'));
    assert.equal(revoked.backend.writes.length, 0);
    results.revokedSessionRejectedBeforeSave = true;
    await revoked.context.close();
    const unavailable = await scenario(browser, { missingAuth: true });
    await unavailable.page.goto(appUrl);
    await unavailable.page.waitForFunction(() => document.querySelector('#loginMessage').textContent.includes('\u5171\u901a\u8a8d\u8a3c'));
    assert.equal(await unavailable.page.locator('body').evaluate(body => body.classList.contains('login-locked')), true);
    assert.equal(unavailable.backend.reads.length, 0);
    results.missingAuthFailsClosed = true;
    await unavailable.context.close();
    const offline = await scenario(browser, { logoutFailure: true });
    await offline.page.goto(appUrl); await unlocked(offline.page);
    await offline.page.locator('#logoutBtn').click();
    await offline.page.waitForURL(url => url.pathname.endsWith('/menu.html'));
    await offline.page.locator('#loginPanel').waitFor({ state: 'visible' });
    assert.equal(await offline.page.evaluate(() => localStorage.getItem('business.session.v1')), null);
    results.logoutClearsSessionEvenWhenOffline = true;
    await offline.context.close();
    console.log(JSON.stringify({ results, databaseWritesAreMocked: true, source: process.env.USE_PUBLISHED_SOURCE ? 'published' : 'local' }, null, 2));
  } finally { await browser.close(); }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
