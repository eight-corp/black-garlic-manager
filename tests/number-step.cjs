const assert = require('node:assert/strict');

module.exports = async function(browser, scenario, unlocked) {
  const {page, context, backend} = await scenario(browser);
  backend.db.black_garlic_age_brackets.push({id:'age', label:'Age', min_days:0, max_days:60, active:true});
  try {
    await page.goto('https://eight-corp.github.io/black-garlic-manager/'); await unlocked(page);
    await page.locator('[data-tab="master"]').click();
    const inputs = await page.locator('input[type="number"]').evaluateAll(inputs => inputs.map(input => {
      const previous = input.value;
      input.value = '2'; input.stepUp(); const up = input.value;
      input.stepDown(); const down = input.value;
      input.value = previous;
      return {step:input.step, up, down};
    }));
    assert.ok(inputs.length >= 12);
    assert.ok(inputs.every(input => input.step === '1' && input.up === '3' && input.down === '2'));
    await page.locator('[data-tab="main"]').click();
    await page.locator('#mainOut').fill('-1'); await page.locator('#mainSubmitBtn').click();
    await page.waitForFunction(() => !document.querySelector('#mainSubmitBtn').disabled);
    assert.equal(backend.writes.length, 0);
    await page.locator('#mainOut').fill('1.25'); await page.locator('#mainIn').fill('2.75');
    await page.locator('#mainEmpty').fill('0.5'); await page.locator('#mainInventory').fill('9.25');
    await page.locator('#mainTemperature').fill('12.3');
    await page.locator('#mainSubmitBtn').click();
    await page.waitForFunction(() => !document.querySelector('#mainSubmitBtn').disabled);
    const row = backend.db.black_garlic_entries.find(row => row.worker_id === 'tester');
    assert.ok(row); assert.equal(row.out_qty, 1.25); assert.equal(row.in_qty, 2.75);
    assert.equal(row.empty_qty, 0.5); assert.equal(row.inventory_qty, 9.25); assert.equal(row.temperature,12.3);
    assert.deepEqual(backend.errors, []);
  } finally {await context.close();}
  return true;
};
