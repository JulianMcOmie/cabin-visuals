// Count React commits and per-component renders during editor scenarios.
//   node scripts/perf/react-probe.mjs <project.json|template:id> [scenario]
// scenario: idle | play | blockdrag | select | panel | library | tabswitch (default: play)
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
    // A fiber RENDERED this commit iff it carries PerformedWork (flags bit 1 -
    // what React DevTools' didFiberRender checks) AND was cloned this commit
    // (fresh actualStartTime). Either alone over-counts: flags persist on
    // untouched subtrees from older commits, and actualStartTime is refreshed
    // for the whole cloned ancestor spine plus memo fibers whose comparator
    // bailed (which made memoized trees look hot).
    if (fiber.actualDuration !== undefined && (fiber.flags & 1) !== 0 && fiber.actualStartTime > window.__lastCommit) {
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

// Track LABELS carry no data attribute (the lane does: [data-track-lane]), and
// selection is the label's job — the lane never selects. The label is the row's
// first child (see Track.tsx). Click the NAME span, not a fixed inset: a fixed
// x lands on the collapse chevron / icon for indented rows and toggles collapse
// instead of selecting. Returns viewport points, top rows first.
const trackLabelPoints = () => page.evaluate(() => {
  const pts = []
  for (const lane of document.querySelectorAll('[data-track-lane]')) {
    const label = lane.parentElement?.firstElementChild
    if (!label) continue
    const name = label.querySelector('.font-medium.truncate') ?? label
    const r = name.getBoundingClientRect()
    if (r.width > 0 && r.height > 0 && r.top > 0) pts.push({ x: r.left + Math.min(20, r.width / 2), y: r.top + r.height / 2 })
  }
  return pts
})
// Click through track labels until the inspector shows a draggable knob
// ([role=slider] with vertical drag — the console kit's LaserKnob).
const selectTrackWithKnob = async () => {
  const pts = await trackLabelPoints()
  for (const p of pts.slice(0, 12)) {
    await page.mouse.click(p.x, p.y)
    await page.waitForTimeout(250)
    const knob = await page.evaluate(() => {
      const panel = document.querySelector('.visualizer-glass-surface')
      if (!panel) return null
      for (const el of panel.querySelectorAll('[role="slider"]')) {
        const r = el.getBoundingClientRect()
        if (r.width > 20 && r.height > 20) return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
      }
      return null
    })
    if (knob) return knob
  }
  return null
}
const libraryTab = (label) => page.locator(`button[aria-label="${label}"]`).first()

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
} else if (scenario === 'select') {
  const pts = await trackLabelPoints()
  if (pts.length === 0) throw new Error('select: no track labels found')
  const cycle = pts.slice(0, Math.min(pts.length, 6))
  const t0 = Date.now(); let i = 0
  while (Date.now() - t0 < secs * 1000) {
    const p = cycle[i % cycle.length]
    await page.mouse.click(p.x, p.y)
    i++; await page.waitForTimeout(300)
  }
} else if (scenario === 'panel') {
  // Selection is setup, not the measurement: re-arm after the knob is found.
  const knob = await selectTrackWithKnob()
  if (!knob) throw new Error('panel: no track with an inspector knob found')
  await page.waitForTimeout(400)
  await page.evaluate(() => window.__reactProbe.start())
  await page.mouse.move(knob.x, knob.y); await page.mouse.down()
  const t0 = Date.now(); let i = 0
  while (Date.now() - t0 < 3000) { await page.mouse.move(knob.x, knob.y - 40 * Math.sin(i / 12), { steps: 1 }); i++; await page.waitForTimeout(12) }
  await page.mouse.up()
} else if (scenario === 'library') {
  // Instruments tab: drill into a folder, scroll the list, come back out.
  await libraryTab('Instruments').click()
  await page.waitForTimeout(300)
  const t0 = Date.now()
  while (Date.now() - t0 < secs * 1000) {
    const folder = page.locator('[data-library-scroll] div', { hasText: /^Motion$/ }).last()
    await folder.click({ timeout: 2000 }).catch(() => {})
    await page.waitForTimeout(400)
    for (let s = 0; s < 6; s++) {
      await page.evaluate((dy) => { document.querySelector('[data-library-scroll]')?.scrollBy(0, dy) }, s < 3 ? 300 : -300)
      await page.waitForTimeout(150)
    }
    const back = page.locator('[data-library-scroll] button[aria-label^="Back to"]')
    await back.click({ timeout: 2000 }).catch(() => {})
    await page.waitForTimeout(400)
  }
} else if (scenario === 'tabswitch') {
  const tabs = ['Loops', 'Templates', 'Instruments']
  const t0 = Date.now(); let i = 0
  while (Date.now() - t0 < secs * 1000) {
    await libraryTab(tabs[i % tabs.length]).click({ timeout: 2000 }).catch(() => {})
    i++; await page.waitForTimeout(350)
  }
}
const r = await page.evaluate(() => window.__reactProbe.report())
console.log(`scenario=${scenario} commits=${r.commits} over ${secs}s`)
for (const [k, n] of r.top) console.log(String(n).padStart(6), k)
await browser.close()
