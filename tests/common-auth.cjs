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
    reads: [], writes: [], logins: 0, logouts: 0, errors: [],
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
      return reply(route, { ok: true, workerId: 'tester', workerName, systemAdmin: false, permissions: backend.role ? { black_garlic: backend.role } : { garlic_fridge: 'viewer' } });
    }
    assert.ok(backend.db[resource], 'Unexpected database request: ' + resource);
    assert.equal(suppliedToken, token);
    if (request.method() === 'GET') {
      backend.reads.push(resource);
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
      return reply(route, rows);
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
  await page.locator('[data-app="black_garlic"]').click();
  const app = await popup;
  await unlocked(app);
  assert.ok(app.url().startsWith(appUrl));
  return app;
}

async function run() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const results = {};
  try {
    const current = await scenario(browser, { token: '', loggedIn: false });
    const { context, backend, page: menu } = current;
    await menu.goto(menuUrl);
    await menu.locator('#loginPin').fill('012345');
    await menu.locator('#loginForm button').click();
    await menu.locator('#menuPanel').waitFor({ state: 'visible' });
    let app = await openFromMenu(menu, context);
    assert.equal(backend.logins, 1);
    assert.equal(await app.locator('#currentWorker').textContent(), workerName);
    assert.equal(await app.locator('#workerSelect,#loginBtn,#loginPin,#setupPanel').count(), 0);
    assert.ok(await app.evaluate(() => !localStorage.getItem('blackGarlicSavedPins') && !localStorage.getItem('blackGarlicWorkerId')));
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
      if (name === 'noAppPermission') assert.equal(await test.page.evaluate(() => localStorage.getItem('business.session.v1')), token);
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
    console.log(JSON.stringify({ results, databaseWritesAreMocked: true, publishedMenuSourceIsNotModified: true }, null, 2));
  } finally { await browser.close(); }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
