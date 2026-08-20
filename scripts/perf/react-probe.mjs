// Count React commits and per-component renders during editor scenarios.
//   node scripts/perf/react-probe.mjs <project.json|template:id> [scenario]
// scenario: idle | play | blockdrag | knob | select (default: play)
// Uses the React DevTools hook: onCommitFiberRoot walks the fiber tree and
// counts fibers whose alternate rendered this commit (actualDuration > 0 works
// in dev). Dev-server React only (localhost:3050).
import { chromium } from 'playwright'
import { readFileSync } from 'fs'

const [src, scenario = 'play'] = process.argv.slice(2)
const BASE = process.env.BASE ?? 'http://localhost:3050'
const isTemplate = src.startsWith('template:')
const proj = isTemplate ? null : JSON.parse(readFileSync(src, 'utf8'))

const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] })
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
await page.route(/supabase\.co\/(rest|auth)/, (r) => r.abort())
await page.addInitScript(() => {
  const counts = new Map()
  let commits = 0
  let renderMs = 0
  const countFiber = (fiber) => {
    // actualDuration is set on fibers that rendered in this commit (profiling
    // fields exist in dev). treeBaseTime alone would count everything.
    // PerformedWork flag (1): set only when the component function actually
    // ran this commit. actualStartTime alone counts default-memo() fibers
    // whose shallow compare BAILED (beginWork visits them), inflating
    // memoized trees by rows x commits.
    if (fiber.actualDuration !== undefined && fiber.actualStartTime > window.__lastCommit && (fiber.flags & 1) && !(fiber.elementType && fiber.elementType.compare)) {
      const t = fiber.elementType || fiber.type
      let name = typeof t === 'function' ? (t.displayName || t.name || '(anon fn)') : typeof t === 'string' ? null : t && t.$$typeof ? (t.displayName || (t.type && (t.type.displayName || t.type.name)) || String(t.$$typeof).slice(7, 30)) : null
      if (name) {
        const c = counts.get(name) || { n: 0, ms: 0 }
        c.n++
        c.ms += fiber.actualDuration - (fiber.child ? childDur(fiber) : 0) > 0 ? fiber.selfBaseDuration || 0 : 0
        counts.set(name, c)
      }
    }
    if (fiber.child) countFiber(fiber.child)
    if (fiber.sibling) countFiber(fiber.sibling)
  }
  const childDur = (f) => { let d = 0; let c = f.child; while (c) { d += c.actualDuration || 0; c = c.sibling } return d }
  window.__lastCommit = 0
  let armed = false
  window.__reactProbe = { start() { counts.clear(); commits = 0; renderMs = 0; window.__lastCommit = performance.now(); armed = true }, report() { armed = false; return { commits, renderMs: Math.round(renderMs), top: [...counts.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 25).map(([k, v]) => [k, v.n]) } } }
  const hook = { renderers: new Map(), supportsFiber: true, inject(r) { const id = hook.renderers.size + 1; hook.renderers.set(id, r); return id }, onScheduleFiberRoot() {}, onCommitFiberUnmount() {}, onCommitFiberRoot(id, root) { if (!armed) { window.__lastCommit = performance.now(); return } commits++; const t0 = performance.now(); if (root.current) countFiber(root.current); renderMs += performance.now() - t0; window.__lastCommit = t0 } }
  Object.defineProperty(window, '__REACT_DEVTOOLS_GLOBAL_HOOK__', { value: hook })
})
await page.goto(`${BASE}/editor${isTemplate ? `?template=${src.slice(9)}` : ''}`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => !!window.__three && !!window.__cabinStores && !!window.__cabinHydrate, null, { timeout: 90000 })
if (proj) await page.evaluate(async (p) => { await window.__cabinHydrate(p.document, p.name) }, proj)
await page.waitForTimeout(4000)

const secs = 6
await page.evaluate(() => window.__reactProbe.start())
if (scenario === 'play') {
  await page.keyboard.press('Space'); await page.waitForTimeout(secs * 1000); await page.keyboard.press('Space')
} else if (scenario === 'idle') {
  await page.waitForTimeout(secs * 1000)
} else if (scenario === 'blockdrag') {
  const el = page.locator('[data-block-id]').first(); const box = await el.boundingBox()
  await page.mouse.move(box.x + 20, box.y + box.height / 2); await page.mouse.down()
  const t0 = Date.now(); let i = 0
  while (Date.now() - t0 < secs * 1000) { await page.mouse.move(box.x + 20 + 150 * Math.sin(i / 9), box.y + box.height / 2); i++; await page.waitForTimeout(12) }
  await page.mouse.up()
} else if (scenario === 'knob') {
  // open the transform panel? simpler: drag the BPM control if present - skip
} else if (scenario === 'select') {
  const rows = await page.locator('[data-track-id]').count()
  const t0 = Date.now(); let i = 0
  while (Date.now() - t0 < secs * 1000) { await page.locator('[data-track-id]').nth(i % Math.min(rows, 6)).click({ position: { x: 10, y: 8 }, force: true }).catch(() => {}); i++; await page.waitForTimeout(300) }
}
const r = await page.evaluate(() => window.__reactProbe.report())
console.log(`scenario=${scenario} commits=${r.commits} over ${secs}s`)
for (const [k, n] of r.top) console.log(String(n).padStart(6), k)
await browser.close()
