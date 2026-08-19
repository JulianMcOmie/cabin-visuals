// Main-thread PAINT/STYLE/RASTER cost during playback, via CDP timeline tracing.
//   BASE=http://localhost:3050 node scripts/perf/paint-breakdown.mjs [templateId]
//
// The companion to render-probe.mjs, which counts GL work. Under headless
// swiftshader a regression in COMPOSITING is invisible to GL counts and to
// rAF cadence - fewer draw calls can still be slower - so a change that costs
// a compositor layer (dropping `will-change` from an animated filter/opacity,
// adding a blend mode, promoting hundreds of elements) only shows up here, in
// RasterTask. That is exactly how the 2026-08-18 timeline-block regression was
// found: 5x the raster time with every other number unchanged. Compare
// RasterTask across two dev servers rather than reading it in isolation.
import { chromium } from 'playwright'

const BASE = process.env.BASE ?? 'http://localhost:3050'
const template = process.argv[2] ?? 'crazyedit'

const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] })
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
await page.route(/supabase\.co\/(rest|auth)/, (r) => r.abort())
await page.goto(`${BASE}/editor?template=${template}`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => !!window.__three && !!window.__cabinStores, null, { timeout: 120000 })
await page.waitForTimeout(6000)

const blocks = await page.evaluate(() => document.querySelectorAll('[data-block-id]').length)

const client = await page.context().newCDPSession(page)
await page.keyboard.press('Space') // play
await page.waitForTimeout(1000)

const events = []
client.on('Tracing.dataCollected', ({ value }) => events.push(...value))
const done = new Promise((r) => client.once('Tracing.tracingComplete', r))
await client.send('Tracing.start', {
  traceConfig: { includedCategories: ['disabled-by-default-devtools.timeline', 'devtools.timeline'] },
  transferMode: 'ReportEvents',
})
await page.waitForTimeout(6000)
await client.send('Tracing.end')
await done
await page.keyboard.press('Space')

const totals = {}
for (const e of events) {
  if (e.ph !== 'X' || typeof e.dur !== 'number') continue
  totals[e.name] = (totals[e.name] ?? 0) + e.dur / 1000
}
const interesting = ['Paint', 'PrePaint', 'UpdateLayerTree', 'UpdateLayoutTree', 'Layerize', 'Layout', 'RasterTask', 'CompositeLayers', 'Commit', 'FunctionCall', 'EventDispatch', 'RunTask']
const out = {}
for (const k of interesting) if (totals[k]) out[k] = +totals[k].toFixed(1)
console.log(`BASE=${BASE} blocks=${blocks}`)
console.log('ms over 6s of playback:', out)
const paintish = ['Paint', 'PrePaint', 'UpdateLayerTree', 'UpdateLayoutTree', 'Layout', 'RasterTask'].reduce((a, k) => a + (totals[k] ?? 0), 0)
console.log('paint+style+layout total ms:', +paintish.toFixed(1))
await browser.close()
