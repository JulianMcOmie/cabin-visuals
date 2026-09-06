// CPU-profile the editor while a real project document plays.
//   node scripts/perf/profile-play.mjs <project.json|template:id> [seconds] [--paused]
// project.json = { name, document } (a saved row). Prints top self-time
// functions/files, long tasks, and frame stats. Headless swiftshader: GPU time
// is not representative (canvas copies can force software readbacks).
// HEADED=1 opens a browser window using the real GPU for playback profiling.
import { chromium } from 'playwright'
import { readFileSync } from 'fs'

const [file, secsArg, ...flags] = process.argv.slice(2)
const secs = Number(secsArg ?? 8)
const paused = flags.includes('--paused')
const drag = flags.includes('--drag')
const scrub = flags.includes('--scrub')
const BASE = process.env.BASE ?? 'http://localhost:3050'
const isTemplate = file.startsWith('template:')
const proj = isTemplate ? { name: file } : JSON.parse(readFileSync(file, 'utf8'))

const browser = await chromium.launch({ headless: !process.env.HEADED, args: [...(process.env.HEADED ? [] : ['--enable-unsafe-swiftshader']), '--autoplay-policy=no-user-gesture-required'] })
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
await page.route(/supabase\.co\/(rest|auth)/, (r) => r.abort())
await page.goto(`${BASE}/editor${isTemplate ? '?template=' + file.slice(9) : ''}`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => !!window.__three && !!window.__cabinStores && !!window.__cabinHydrate, null, { timeout: 90000 })
if (!isTemplate) await page.evaluate(async (p) => { await window.__cabinHydrate(p.document, p.name) }, proj)
await page.waitForTimeout(4000) // let instruments/textures/audio settle
const info = await page.evaluate(() => { const p = window.__cabinStores.project.getState(); const tracks = Object.values(p.tracks); return { tracks: tracks.length, blocks: tracks.reduce((a, t) => a + t.blocks.length, 0), notes: tracks.reduce((a, t) => a + t.blocks.reduce((b, k) => b + k.notes.length, 0), 0), scenes: Object.keys(p.scenes).length, copies: window.__cabinVisual?.getVisualCopyCount?.() } })
console.log('project:', proj.name, info)

const cdp = await page.context().newCDPSession(page)
await cdp.send('Profiler.enable')
await cdp.send('Profiler.setSamplingInterval', { interval: 250 })
await page.evaluate(() => { window.__frames = []; window.__lt = []; let last = performance.now(); const tick = () => { const n = performance.now(); window.__frames.push(n - last); last = n; requestAnimationFrame(tick) }; requestAnimationFrame(tick); new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push(e.duration) }).observe({ type: 'longtask' }) })
if (!paused) await page.evaluate(() => { window.__cabinStores.time.getState().setCurrentBeat(0) })
await cdp.send('Profiler.start')
if (drag) {
  // Drag the first block back and forth for `secs` seconds (paused transport).
  const el = page.locator('[data-block-id]').first()
  const box = await el.boundingBox()
  await page.mouse.move(box.x + 20, box.y + box.height / 2); await page.mouse.down()
  const t0 = Date.now(); let i = 0
  while (Date.now() - t0 < secs * 1000) { await page.mouse.move(box.x + 20 + 120 * Math.sin(i / 8), box.y + box.height / 2 + 30 * Math.sin(i / 13)); i++; await page.waitForTimeout(8) }
  await page.mouse.up()
} else if (scrub) {
  const t0 = Date.now(); let i = 0
  while (Date.now() - t0 < secs * 1000) { await page.evaluate((b) => window.__cabinStores.time.getState().setCurrentBeat(b), (i % 64) / 4); i++; await page.waitForTimeout(16) }
} else if (!paused) {
  await page.keyboard.press('Space')
  await page.waitForTimeout(secs * 1000)
  await page.keyboard.press('Space')
} else {
  await page.waitForTimeout(secs * 1000)
}
const { profile } = await cdp.send('Profiler.stop')
const stats = await page.evaluate(() => { const f = window.__frames.slice().sort((a, b) => a - b); return { frames: f.length, p50: f[Math.floor(f.length * 0.5)]?.toFixed(1), p95: f[Math.floor(f.length * 0.95)]?.toFixed(1), max: f[f.length - 1]?.toFixed(1), longTasks: window.__lt.length, longTaskMs: window.__lt.reduce((a, b) => a + b, 0).toFixed(0) } })
console.log('frames:', stats)

// Aggregate self time by function and by URL
const nodes = new Map(profile.nodes.map((n) => [n.id, n]))
const self = new Map(); const byUrl = new Map(); let total = 0
const dt = profile.timeDeltas
for (let i = 0; i < profile.samples.length; i++) {
  const n = nodes.get(profile.samples[i]); const d = dt[i] ?? 0; total += d
  const cf = n.callFrame
  const url = (cf.url || '(native)').split('/').slice(-2).join('/').split('?')[0]
  const key = `${cf.functionName || '(anon)'} @ ${url}:${cf.lineNumber}`
  self.set(key, (self.get(key) ?? 0) + d)
  byUrl.set(url, (byUrl.get(url) ?? 0) + d)
}
const top = (m, n) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n)
console.log(`\nprofile ${(total / 1000).toFixed(0)} ms sampled over ${secs}s (${((total / 1000) / (secs * 1000) * 100).toFixed(0)}% of wall)`)
console.log('\nTop functions (self ms):')
for (const [k, v] of top(self, 30)) console.log(`${(v / 1000).toFixed(0).padStart(6)}  ${k}`)
console.log('\nTop files (self ms):')
for (const [k, v] of top(byUrl, 15)) console.log(`${(v / 1000).toFixed(0).padStart(6)}  ${k}`)
await browser.close()
