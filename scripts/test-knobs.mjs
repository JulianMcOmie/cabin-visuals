// Real React components in Chromium; unrelated GPU previews and instrument frame hooks are omitted.
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'
import { chromium } from 'playwright'
import { createServer } from 'node:http'
import { resolve } from 'node:path'

const bundle = await build({ entryPoints: ['scripts/fixtures/knobs.tsx'], bundle: true, write: false, platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"test"' }, plugins: [{
  name: 'omit-gpu-preview', setup(builder) {
    builder.onResolve({ filter: /(^|\/)instrumentFrame$/ }, () => ({ path: 'frame', namespace: 'frame-stub' }))
    builder.onLoad({ filter: /.*/, namespace: 'frame-stub' }, () => ({ contents: 'export const useInstrumentFrame = () => {}; export const seededRand = () => { throw new Error("Instrument visuals must not mount in the knob fixture") }' }))
    builder.onResolve({ filter: /(^|\/)PreviewCanvas$/ }, () => ({ path: 'preview', namespace: 'stub' }))
    builder.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export const PreviewCanvas = () => null' }))
  },
}] })
const css = (await postcss([tailwind()]).process('@import "tailwindcss";', { from: resolve('scripts/fixtures/knobs.css') })).css
const server = createServer((req, res) => {
  if (req.url === '/bundle.js') { res.setHeader('Content-Type', 'text/javascript; charset=utf-8'); res.end(bundle.outputFiles[0].text) }
  else { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(`<html><head><style>${css} body{background:#10141b;color:white} #outside{display:block;margin-top:20px}</style></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>`) }
})
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
let browser
try {
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  page.setDefaultTimeout(10000)
  const errors = []
  page.on('pageerror', error => { errors.push(error.message); console.error(error) })
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  assert.deepEqual(errors, [], 'fixture must load')
  const mount = async name => { await page.evaluate(name => window.mountKnobs(name), name); await page.locator('#outside').waitFor(); await page.waitForTimeout(30) }
  const value = key => page.evaluate(key => window.knobValues[key], key)
  const readout = label => page.getByRole('button', { name: `Edit ${label} value`, exact: true })
  const input = label => page.getByRole('textbox', { name: `${label} exact value`, exact: true })
  const edit = async (label, text, key, expected) => {
    await readout(label).dblclick()
    await input(label).fill(text)
    await input(label).press('Enter')
    if (Math.abs(await value(key) - expected) >= 1e-12) console.error(await page.locator('#root').innerHTML())
    assert.ok(Math.abs(await value(key) - expected) < 1e-12, `${label}: ${text} should store ${expected}, got ${await value(key)}`)
    assert.equal(await input(label).count(), 0)
    assert.equal(await readout(label).evaluate(el => document.activeElement === el), true)
  }
  for (const [name, label, text, expected] of [
    ['plain', 'VALUE', '0.123456789', 0.123456789], ['curved', 'VALUE', '1e-9', 1e-9],
    ['percent', 'VALUE', '103.25%', 1.0325], ['degrees', 'VALUE', '90.5°', 90.5 / 360],
    ['growth', 'VALUE', '×1.2345', Math.log2(1.2345)], ['period', 'VALUE', '−8b', -45],
    ['notes', 'VALUE', '1/10', 2.5], ['bound', 'value', '0.456789', 0.456789], ['bipolar', 'Signed rate', '-2.12345', -2.12345],
  ]) { await mount(name); await edit(label, text, 'value', expected) }
  console.log('PASS: plain, curved, percent, degrees, multiplier, beat period, note division, bound, large/bipolar/blank-label variants')

  await mount('plain')
  await readout('VALUE').focus(); await readout('VALUE').press('Enter')
  await input('VALUE').pressSequentially('0.34567')
  assert.equal(await input('VALUE').inputValue(), '0.34567', 'typing must not re-select after every keystroke')
  assert.equal(await value('value'), 0, 'draft must not alter instrument state')
  await input('VALUE').press('Escape'); assert.equal(await value('value'), 0)
  await readout('VALUE').dblclick(); await input('VALUE').fill('0.456789'); await input('VALUE').press('Tab')
  assert.equal(await value('value'), 0.456789)
  await readout('VALUE').dblclick(); await input('VALUE').fill('999'); await input('VALUE').press('Enter')
  assert.equal(await input('VALUE').getAttribute('aria-invalid'), 'true')
  assert.equal(await value('value'), 0.456789)
  await page.locator('#outside').click(); assert.equal(await input('VALUE').count(), 0)
  await readout('VALUE').dblclick(); await input('VALUE').fill('NaN'); await input('VALUE').press('Escape')
  assert.equal(await value('value'), 0.456789)
  const before = await page.evaluate(() => window.knobChanges)
  await readout('VALUE').dblclick(); await input('VALUE').press('Enter')
  assert.equal(await page.evaluate(() => window.knobChanges), before, 'unchanged draft must not emit')
  await page.getByRole('slider').dblclick(); assert.equal(await value('value'), 1)
  await page.getByRole('slider').press('ArrowUp'); assert.equal(await value('value'), 1.6)
  await page.getByRole('slider').press('Home'); assert.equal(await value('value'), -10)
  await page.getByRole('slider').press('End'); assert.equal(await value('value'), 10)
  console.log('PASS: double-click/reset separation, keyboard entry, multi-character typing, Escape, blur/Tab, invalid input, focus restoration and unchanged-draft behavior')

  await mount('disabled')
  assert.equal(await readout('VALUE').isDisabled(), true)
  await page.getByRole('slider').dispatchEvent('dblclick'); await page.getByRole('slider').dispatchEvent('keydown', { key: 'ArrowUp' })
  assert.equal(await value('value'), 0)
  await mount('plain')
  const slider = page.getByRole('slider')
  const rect = await slider.boundingBox()
  await page.mouse.move(rect.x + 20, rect.y + 20); await page.mouse.down(); await page.mouse.move(rect.x + 20, rect.y + 6); await page.mouse.up()
  assert.equal(await value('value'), 2, '140px drag travel is preserved')
  await slider.dispatchEvent('pointerdown', { pointerId: 7, clientY: 100, button: 0 })
  await slider.dispatchEvent('pointercancel', { pointerId: 7 })
  await slider.dispatchEvent('pointermove', { pointerId: 7, clientY: 0 })
  assert.equal(await value('value'), 2, 'cancelled pointer cannot keep dragging')
  console.log('PASS: disabled behavior, real pointer dragging and pointer cancellation')

  for (const [name, label, text, key, expected] of [
    ['shock', 'Impact', '105.5%', 'impact', 1.055], ['shock', 'Recover (beats)', '1.2345 beats', 'recoverBeats', 1.2345],
    ['pixel', 'Blast Speed', '3.12345', 'speed', 3.12345], ['rotate', 'offsetX', '37.25°', 'offsetX', 37.25],
    ['rotate', 'speedX', '1.2345×', 'speedX', 1.2345], ['kaleidoscope', 'rotation', '1.2345rad', 'rotation', 1.2345],
    ['camera', 'Position X', '1.2345', 'posX', 1.2345], ['orbit', 'Center X', '1.2345', 'centerX', 1.2345],
    ['radial', 'outer spin z', '22.75°', 'spinZ0', 22.75], ['tunnel', 'Sync rate, beats per ring', '1/3b', 'syncRingsPerBeat', 3],
    ['grain', 'Rate', '1/10', 'rate', 2.5],
    ['filters', 'amount', '12.345%', 'amount', 0.12345], ['spec', 'amount', '12.345%', 'amount', 0.12345],
  ]) { await mount(name); await edit(label, text, key, expected) }
  console.log('PASS: actual Shock/overdrive, Pixel Meter, orientation dial, spin pill, Kaleidoscope, Color Filters and declarative panel components')

  for (const name of ['camera', 'orbit', 'symmetry', 'radial', 'tunnel']) {
    await mount(name)
    const buttons = await page.locator('button[data-knob-value]').all()
    assert.ok(buttons.length, `${name} has editable values`)
    // Every visible variant can open and cancel without writing its document.
    for (const button of buttons) {
      if (!await button.isVisible() || await button.isDisabled()) continue
      await button.dblclick()
      const field = page.getByRole('textbox')
      assert.equal(await field.count(), 1, `${name} readout double-click must edit, not reset`)
      await field.press('Escape')
    }
    assert.equal(await page.evaluate(() => window.knobChanges), 0, `${name}: opening/cancelling must not reset or emit`)
    console.log(`PASS: ${name} — ${buttons.length} numeric readouts open/cancel`)
  }
  await mount('shock')
  await edit('Impact', '98%', 'impact', 0.98)
  const impact = page.getByRole('slider', { name: 'Impact', exact: true })
  await impact.press('ArrowUp'); assert.equal(await value('impact'), 1, 'keyboard catches at 100%')
  await impact.press('ArrowUp'); assert.ok(await value('impact') > 1, 'next nudge passes detent')
  await edit('Impact', '98%', 'impact', 0.98)
  const box = await impact.boundingBox()
  const x = box.x + box.width / 2, y = box.y + box.height / 2
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x, y - 8)
  assert.equal(await value('impact'), 1)
  await page.mouse.move(x, y - 20); assert.equal(await value('impact'), 1, 'detent holds for 16px')
  await page.mouse.move(x, y - 28); await page.mouse.move(x, y - 32); await page.mouse.up()
  assert.ok(await value('impact') > 1, 'pointer resumes after detent breakaway')
  await mount('rotate')
  const orientation = page.getByRole('slider', { name: 'offsetX', exact: true })
  const dial = await orientation.boundingBox()
  await page.mouse.move(dial.x + dial.width / 2, dial.y + 4); await page.mouse.down()
  await page.mouse.move(dial.x + dial.width - 4, dial.y + dial.height / 2); await page.mouse.up()
  assert.equal(await value('offsetX'), 90, 'angular dial still turns by pointer angle')
  await mount('camera')
  const cell = readout('Position X'), cellBox = await cell.boundingBox()
  await page.mouse.move(cellBox.x + cellBox.width / 2, cellBox.y + 4); await page.mouse.down()
  await page.mouse.move(cellBox.x + cellBox.width / 2, cellBox.y - 12); await page.mouse.up()
  assert.equal(await value('posX'), 10, 'numeric cell keeps its 160px vertical drag')
  await mount('symmetry')
  await readout('Mirrors').dblclick(); await input('Mirrors').fill('2.5'); await input('Mirrors').press('Enter')
  assert.equal(await input('Mirrors').getAttribute('aria-invalid'), 'true', 'integer contracts reject fractional counts')
  await input('Mirrors').press('Escape')
  console.log('PASS: overdrive catch/breakaway, angular dial motion, numeric-cell drag, and integer validation')
  assert.deepEqual(errors, [], 'no browser runtime errors')
  await page.screenshot({ path: '/tmp/shared-knobs-browser.png', fullPage: true })
  console.log('All knob browser checks passed.')
} finally {
  await browser?.close()
  await new Promise(resolve => server.close(resolve))
}
