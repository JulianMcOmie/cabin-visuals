// Timeline gesture smoke: select, shift-select, drag, marquee on a template project.
import { chromium } from 'playwright'

const BASE = process.env.BASE ?? 'http://localhost:3050'
const template = process.argv[2] ?? 'wormhole'
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
await page.route(/supabase\.co\/(rest|auth|storage)/, (r) => r.abort())
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)) })
await page.goto(`${BASE}/editor?template=${template}`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => !!window.__three && !!window.__cabinStores, null, { timeout: 60000 })
await page.waitForFunction(() => document.querySelectorAll('[data-block-id]').length > 0, null, { timeout: 30000 })

const state = () => page.evaluate(() => {
  const p = window.__cabinStores.project.getState(); const u = window.__cabinStores.ui.getState()
  const blocks = []
  for (const t of Object.values(p.tracks)) for (const b of t.blocks) blocks.push({ id: b.id, trackId: t.id, startBar: b.startBar, durationBars: b.durationBars })
  return { blockCount: blocks.length, selected: [...u.selectedBlockIds], selectedTrackId: u.selectedTrackId, blocks }
})
const s0 = await state()
console.log('blocks:', s0.blockCount, 'tracks:', Object.keys(await page.evaluate(() => window.__cabinStores.project.getState().tracks)).length)

const blockEls = page.locator('[data-block-id]')
const n = await blockEls.count()
const b0 = blockEls.nth(0), b1 = blockEls.nth(Math.min(1, n - 1))
const id0 = await b0.getAttribute('data-block-id'), id1 = await b1.getAttribute('data-block-id')

// 1. click selects
await b0.click({ position: { x: 20, y: 10 } })
let s = await state(); console.log('click select:', s.selected.includes(id0) && s.selected.length === 1 ? 'OK' : `FAIL ${JSON.stringify(s.selected)}`)
// 2. shift-click adds
await b1.click({ position: { x: 20, y: 10 }, modifiers: ['Shift'] })
s = await state(); console.log('shift add:', s.selected.includes(id0) && s.selected.includes(id1) ? 'OK' : `FAIL ${JSON.stringify(s.selected)}`)
// 3. shift-click removes
await b1.click({ position: { x: 20, y: 10 }, modifiers: ['Shift'] })
s = await state(); console.log('shift remove:', s.selected.includes(id0) && !s.selected.includes(id1) ? 'OK' : `FAIL ${JSON.stringify(s.selected)}`)
// 4. drag block 0 right by ~2 bars
const before = (await state()).blocks.find((b) => b.id === id0)
const box = await b0.boundingBox()
const barPx = await page.evaluate(() => { const b = document.querySelector('[data-block-id]'); const w = b.getBoundingClientRect().width; const bl = window.__cabinStores.project.getState(); let dur = 1; for (const t of Object.values(bl.tracks)) { const f = t.blocks.find((x) => x.id === b.dataset.blockId); if (f) dur = f.durationBars } return w / dur })
await page.mouse.move(box.x + 20, box.y + box.height / 2)
await page.mouse.down()
for (let i = 1; i <= 20; i++) { await page.mouse.move(box.x + 20 + (barPx * 2 * i) / 20, box.y + box.height / 2); await page.waitForTimeout(10) }
await page.mouse.up()
const after = (await state()).blocks.find((b) => b.id === id0)
console.log('drag:', before.startBar, '→', after.startBar, after.startBar > before.startBar ? 'OK' : 'FAIL')
// 5. drag back (same path) - should also work and land near original
await page.waitForTimeout(100)
const box2 = await b0.boundingBox()
await page.mouse.move(box2.x + 20, box2.y + box2.height / 2)
await page.mouse.down()
for (let i = 1; i <= 20; i++) { await page.mouse.move(box2.x + 20 - (barPx * 2 * i) / 20, box2.y + box2.height / 2); await page.waitForTimeout(10) }
await page.mouse.up()
const back = (await state()).blocks.find((b) => b.id === id0)
console.log('drag back:', after.startBar, '→', back.startBar, back.startBar < after.startBar ? 'OK' : 'FAIL')
// 6. marquee over empty lane area from far right of first row to include block 0
await page.keyboard.press('Escape')
const lane = await b0.evaluate((el) => { const r = el.closest('[data-track-id],[data-lane]')?.getBoundingClientRect() ?? el.parentElement.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height } })
const bb = await b0.boundingBox()
const startX = bb.x + bb.width + 60, startY = bb.y + 4
await page.mouse.move(startX, startY)
await page.mouse.down()
for (let i = 1; i <= 15; i++) { await page.mouse.move(startX - ((bb.width + 80) * i) / 15, startY + (bb.height * 0.6 * i) / 15); await page.waitForTimeout(10) }
s = await state()
const during = s.selected.includes(id0)
await page.mouse.up()
s = await state()
console.log('marquee:', during && s.selected.includes(id0) ? 'OK' : `FAIL during=${during} after=${JSON.stringify(s.selected)}`)
console.log('errors:', errors.length ? errors : 'none')
await browser.close()
