// Drag the vertical divider; check the panel follows live and the store commits on release.
import { chromium } from 'playwright'
const BASE = process.env.BASE ?? 'http://localhost:3050'
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } })
await page.route(/supabase\.co\/(rest|auth|storage)/, (r) => r.abort())
await page.goto(`${BASE}/editor`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => !!window.__three && !!window.__cabinStores, null, { timeout: 60000 })
const grab = page.locator('div.cursor-ns-resize').first()
const box = await grab.boundingBox()
const before = await page.evaluate(() => window.__cabinStores.ui.getState().topPanelFraction)
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
await page.mouse.down()
let mid = null
for (let i = 1; i <= 10; i++) { await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + i * 15); await page.waitForTimeout(16); if (i === 5) mid = await page.evaluate(() => window.__cabinStores.ui.getState().topPanelFraction) }
const liveTop = await page.evaluate(() => { const c = document.querySelector('.visual-canvas-root'); return c ? c.getBoundingClientRect().height : -1 })
await page.mouse.up()
await page.waitForTimeout(100)
const after = await page.evaluate(() => window.__cabinStores.ui.getState().topPanelFraction)
console.log({ before, midDragStore: mid, after, storeChangedDuringDrag: mid !== before, committedOnRelease: after > before, canvasHeightDuring: liveTop })
await browser.close()
