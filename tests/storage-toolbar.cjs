const assert = require('node:assert/strict');
const path = require('node:path');

module.exports = async function testStorageToolbar(browser, scenario, unlocked) {
  const { page, context, backend } = await scenario(browser, { mobile: false });
  try {
    await page.goto('https://eight-corp.github.io/black-garlic-manager/'); await unlocked(page);
    await page.locator('[data-tab="summary"]').click();
    await page.locator('[data-summary-view="storageGraph"]').click();
    const reads = backend.reads.length;
    for (const mode of ['line', 'stacked']) {
      await page.locator('#storageGraphMode').selectOption(mode);
      for (const width of [320, 360, 390, 760, 844, 1280]) {
        await page.setViewportSize({ width, height: 844 });
        await page.waitForFunction(width => innerWidth === width, width);
        await page.waitForFunction(() => {
          const toolbar = document.querySelector('.storage-graph-toolbar');
          const elements = [...toolbar.querySelectorAll('select,input,button')];
          const frames = elements.map(element => element.getBoundingClientRect());
          const canvas = document.createElement('canvas').getContext('2d');
          const select = elements[0];
          const style = getComputedStyle(select);
          canvas.font = style.font;
          return elements[0].id === 'storageGraphMode' && elements[1].id === 'storageGraphStartDate' && frames.length === 5 &&
            frames.every((frame, index) => Math.abs(frame.top - frames[0].top) < 1 && frame.right <= innerWidth && (!index || frame.left >= frames[index - 1].right)) &&
            canvas.measureText(select.selectedOptions[0].textContent).width <= select.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) &&
            document.documentElement.scrollWidth <= innerWidth;
        });
        if (process.env.QA_ARTIFACTS && [320, 1280].includes(width)) await page.screenshot({ path: path.join(process.env.QA_ARTIFACTS, 'storage-toolbar-' + mode + '-' + width + '.png') });
      }
    }
    assert.equal(backend.reads.length, reads);
    assert.equal(backend.writes.length, 0);
    assert.deepEqual(backend.errors, []);
  } finally { await context.close(); }
  return true;
};
