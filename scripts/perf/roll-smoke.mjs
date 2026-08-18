// Piano roll gesture smoke: open a block, drag a note right by 2 beats and up 2 rows, resize it; check store.
import { chromium } from 'playwright'
const BASE = process.env.BASE ?? 'http://localhost:3050'
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
await page.route(/supabase\.co\/(rest|auth|storage)/, (r) => r.abort())
const errors = []; page.on('pageerror', (e) => errors.push(String(e)))
await page.goto(`${BASE}/editor?template=${process.argv[2] ?? 'wormhole'}`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => !!window.__three && !!window.__cabinStores, null, { timeout: 60000 })
await page.waitForFunction(() => document.querySelectorAll('[data-block-id]').length > 0, null, { timeout: 30000 })
// pick a block with notes
await page.evaluate(() => { const p = window.__cabinStores.project.getState(); for (const t of Object.values(p.tracks)) for (const b of t.blocks) if (b.notes.length > 0) { window.__cabinStores.ui.getState().setEditingBlock({ trackId: t.id, blockId: b.id }); return } })
await page.waitForTimeout(1500)
const dbg = await page.evaluate(() => ({ editing: window.__cabinStores.ui.getState().editingBlock, notes: document.querySelectorAll('[data-note-id]').length, absDivs: document.querySelectorAll('div[style*="position: absolute"]').length, tail: document.body.innerText.slice(-200) }))
console.log('opened:', dbg)
await page.waitForFunction(() => document.querySelectorAll('[data-note-id]').length > 0, null, { timeout: 15000 })
const noteEl = page.locator('[data-note-id]').first()
const noteId = await noteEl.getAttribute('data-note-id')
const before = await page.evaluate((id) => { const p = window.__cabinStores.project.getState(); for (const t of Object.values(p.tracks)) for (const b of t.blocks) { const n = b.notes.find((n) => n.id === id); if (n) return { startBeat: n.startBeat, pitch: n.pitch, durationBeats: n.durationBeats } } }, noteId)
const box = await noteEl.boundingBox()
const ppb = await page.evaluate(() => window.__cabinStores.ui.getState().midiPixelsPerBeat ?? null)
// drag body right by ~2 beats-worth of pixels (use note width / duration), up 2 rows
const beatPx = box.width / before.durationBeats
const rowH = await page.evaluate(() => { const els = [...document.querySelectorAll('[data-note-id]')]; return els.length ? els[0].getBoundingClientRect().height + 4 : 20 })
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
await page.mouse.down()
for (let i = 1; i <= 25; i++) { await page.mouse.move(box.x + box.width / 2 + (beatPx * 2 * i) / 25, box.y + box.height / 2 - (rowH * 2 * i) / 25); await page.waitForTimeout(8) }
await page.mouse.up()
await page.waitForTimeout(150)
const after = await page.evaluate((id) => { const p = window.__cabinStores.project.getState(); for (const t of Object.values(p.tracks)) for (const b of t.blocks) { const n = b.notes.find((n) => n.id === id); if (n) return { startBeat: n.startBeat, pitch: n.pitch, durationBeats: n.durationBeats } } }, noteId)
console.log('move:', before, '→', after, after.startBeat > before.startBeat && after.pitch !== before.pitch ? 'OK' : 'FAIL')
// resize: grab right edge
const box2 = await noteEl.boundingBox()
await page.mouse.move(box2.x + box2.width - 2, box2.y + box2.height / 2)
await page.mouse.down()
for (let i = 1; i <= 15; i++) { await page.mouse.move(box2.x + box2.width - 2 + (beatPx * i) / 15, box2.y + box2.height / 2); await page.waitForTimeout(8) }
await page.mouse.up()
await page.waitForTimeout(150)
const after2 = await page.evaluate((id) => { const p = window.__cabinStores.project.getState(); for (const t of Object.values(p.tracks)) for (const b of t.blocks) { const n = b.notes.find((n) => n.id === id); if (n) return { startBeat: n.startBeat, pitch: n.pitch, durationBeats: n.durationBeats } } }, noteId)
console.log('resize:', after.durationBeats, '→', after2.durationBeats, after2.durationBeats > after.durationBeats ? 'OK' : 'FAIL')
console.log('errors:', errors.length ? errors : 'none')
await browser.close()
