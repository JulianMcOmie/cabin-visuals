// Profile the LOAD of a project: hydrate → 15s. Reports long tasks over time,
// top CPU self-time, copy counts per track, mounted mesh totals, and whether
// the main thread ever settles (can the user click?).
//   node scripts/perf/load-probe.mjs <project.json> [secs]
import { chromium } from 'playwright'
import { readFileSync } from 'fs'

const [file, secsArg] = process.argv.slice(2)
const secs = Number(secsArg ?? 15)
const BASE = process.env.BASE ?? 'http://localhost:3050'
const proj = JSON.parse(readFileSync(file, 'utf8'))

const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] })
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
await page.route(/supabase\.co\/(rest|auth)/, (r) => r.abort())
await page.goto(`${BASE}/editor`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => !!window.__three && !!window.__cabinStores && !!window.__cabinHydrate, null, { timeout: 90000 })
await page.waitForTimeout(2000)

const cdp = await page.context().newCDPSession(page)
await cdp.send('Profiler.enable')
await cdp.send('Profiler.setSamplingInterval', { interval: 250 })
await page.evaluate(() => {
  window.__lt = []
  new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push({ t: Math.round(e.startTime), d: Math.round(e.duration) }) }).observe({ type: 'longtask' })
  window.__t0 = performance.now()
})
await cdp.send('Profiler.start')
await page.evaluate(async (p) => { await window.__cabinHydrate(p.document, p.name) }, proj)
// Poll responsiveness: a ping every 500ms; slow pings = user can't click.
const pings = []
for (let i = 0; i < secs * 2; i++) {
  const t0 = Date.now()
  await page.evaluate(() => 1).catch(() => {})
  pings.push(Date.now() - t0)
  await page.waitForTimeout(Math.max(0, 500 - (Date.now() - t0)))
}
const { profile } = await cdp.send('Profiler.stop')
const state = await page.evaluate(() => {
  const p = window.__cabinStores.project.getState()
  const copies = []
  for (const [sid, s] of Object.entries(p.scenes)) for (const tid of Object.keys(s.tracks)) {
    const n = window.__cabinVisual.getVisualCopyCount?.(tid) ?? 0
    if (n > 1) copies.push({ track: s.tracks[tid].name || tid.slice(0, 6), inst: s.tracks[tid].instrumentId || s.tracks[tid].splitterId || s.tracks[tid].type, n })
  }
  let meshes = 0, groups = 0
  window.__r3fState?.().scene?.traverse?.(() => {})
  const lt = window.__lt
  return { copies: copies.sort((a, b) => b.n - a.n).slice(0, 12), totalCopies: copies.reduce((a, c) => a + c.n, 0), longTasks: lt.length, longTaskMs: lt.reduce((a, b) => a + b.d, 0), tail: lt.slice(-6) }
})
console.log('responsiveness pings ms (every ~500ms):', pings.join(' '))
console.log('long tasks:', state.longTasks, 'total', state.longTaskMs, 'ms; last:', JSON.stringify(state.tail))
console.log('copies:', JSON.stringify(state.copies), 'total', state.totalCopies)
const nodes = new Map(profile.nodes.map((n) => [n.id, n]))
const self = new Map(); let total = 0
for (let i = 0; i < profile.samples.length; i++) { const n = nodes.get(profile.samples[i]); const d = profile.timeDeltas[i] ?? 0; total += d; const cf = n.callFrame; const key = `${cf.functionName || '(anon)'} @ ${(cf.url || '(native)').split('/').slice(-1)[0].split('?')[0]}:${cf.lineNumber}`; self.set(key, (self.get(key) ?? 0) + d) }
console.log(`\nprofile ${(total / 1000).toFixed(0)}ms sampled; top self:`)
for (const [k, v] of [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 22)) console.log(`${(v / 1000).toFixed(0).padStart(7)}  ${k}`)
await browser.close()
