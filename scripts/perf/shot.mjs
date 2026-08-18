// Screenshot the WebGL canvas of a template at a beat. node shot.mjs <template> <beat> <out.png>
import { chromium } from 'playwright'
const [template, beatArg, out] = process.argv.slice(2)
const BASE = process.env.BASE ?? 'http://localhost:3050'
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
await page.route(/supabase\.co\/(rest|auth|storage)/, (r) => r.abort())
await page.goto(`${BASE}/editor?template=${template}`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => !!window.__three && !!window.__cabinStores, null, { timeout: 60000 })
await page.waitForTimeout(1500)
await page.evaluate((b) => { window.__cabinStores.time.getState().setCurrentBeat(Number(b)) }, beatArg)
await page.waitForTimeout(1200)
const clip = await page.evaluate(() => { const r = window.__three.gl.domElement.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } })
await page.screenshot({ path: out, clip })
console.log('saved', out, clip)
await browser.close()
