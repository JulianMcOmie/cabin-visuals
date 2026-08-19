// Main-thread + paint cost while playing with the timeline visible: CDP tracing
// (devtools.timeline) sums Paint / Layout / Commit etc per second, plus rAF frame gaps.
//   node scripts/perf/paint-probe.mjs <project.json> [secs]     (HEADED=1 → real GPU, a window opens)
import { chromium } from 'playwright'
import { readFileSync } from 'fs'
const [file, secsArg] = process.argv.slice(2); const secs = Number(secsArg ?? 6)
const BASE = process.env.BASE ?? 'http://localhost:3050'
const proj = JSON.parse(readFileSync(file, 'utf8'))
const browser = await chromium.launch({ headless: process.env.HEADED ? false : true, args: process.env.HEADED ? ['--autoplay-policy=no-user-gesture-required'] : ['--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] })
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
await page.route(/supabase\.co\/(rest|auth)/, (r) => r.abort())
await page.goto(`${BASE}/editor`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => !!window.__three && !!window.__cabinStores && !!window.__cabinHydrate, null, { timeout: 90000 })
await page.evaluate(async (p) => { await window.__cabinHydrate(p.document, p.name) }, proj)
await page.waitForTimeout(4000)
const blocks = await page.evaluate(() => document.querySelectorAll('[data-block-id]').length)
const cdp = await page.context().newCDPSession(page)
const events = []
cdp.on('Tracing.dataCollected', (d) => events.push(...d.value))
await cdp.send('Tracing.start', { categories: 'disabled-by-default-devtools.timeline,devtools.timeline', options: 'sampling-frequency=1000' })
await page.evaluate(() => { window.__cabinStores.time.getState().setCurrentBeat(0); window.__gaps = []; let last = performance.now(); const t = () => { const n = performance.now(); window.__gaps.push(n - last); last = n; requestAnimationFrame(t) }; requestAnimationFrame(t) })
await page.keyboard.press('Space'); await page.waitForTimeout(secs * 1000); await page.keyboard.press('Space')
await cdp.send('Tracing.end'); await new Promise((r) => cdp.once('Tracing.tracingComplete', r))
const gaps = await page.evaluate(() => window.__gaps.slice().sort((a, b) => a - b))
const sum = {}
for (const e of events) { if (e.ph === 'X' && e.dur) sum[e.name] = (sum[e.name] ?? 0) + e.dur / 1000 }
// RasterTask and Layerize are load-bearing here, not extras: a COMPOSITING
// regression moves those two and almost nothing else. The 2026-08-18 timeline
// -block one ran 250ms -> 1370ms of raster per 6s while Paint, PrePaint,
// UpdateLayoutTree and Layout stayed flat to within noise - so a list without
// RasterTask reports "no change" on exactly the bug this probe exists to catch.
const pick = ['Paint', 'Layout', 'UpdateLayoutTree', 'UpdateLayerTree', 'Layerize', 'PrePaint', 'RasterTask', 'CompositeLayers', 'Commit', 'FunctionCall', 'RunTask']
console.log(`blocks visible: ${blocks}; frames ${gaps.length}, p50 ${gaps[Math.floor(gaps.length / 2)]?.toFixed(1)}ms p95 ${gaps[Math.floor(gaps.length * 0.95)]?.toFixed(1)}ms`)
console.log(Object.fromEntries(pick.filter((k) => sum[k]).map((k) => [k, `${(sum[k] / secs).toFixed(0)} ms/s`])))
await browser.close()
