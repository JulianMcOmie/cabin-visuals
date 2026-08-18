// CPU-profile one piano-roll note drag (30 pointermoves) and print where the
// time goes, aggregated by function name (self time) - the diagnostic behind
// roll-rows-check.mjs's totals.   node scripts/perf/roll-drag-profile.mjs <template>
import { chromium } from 'playwright'

const BASE = process.env.BASE ?? 'http://localhost:3072'
const template = process.argv[2] ?? 'wormhole'
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
await page.route(/supabase\.co\/(rest|auth|storage)/, (r) => r.abort())
await page.goto(`${BASE}/editor?template=${template}`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => !!window.__three && !!window.__cabinStores, null, { timeout: 60000 })
await page.waitForFunction(() => document.querySelectorAll('[data-block-id]').length > 0, null, { timeout: 30000 })
await page.evaluate(() => { const p = window.__cabinStores.project.getState(); for (const t of Object.values(p.tracks)) for (const b of t.blocks) if (b.notes.length > 0) { window.__cabinStores.ui.getState().setEditingBlock({ trackId: t.id, blockId: b.id }); return } })
await page.waitForFunction(() => document.querySelectorAll('[data-note-id]').length > 0, null, { timeout: 15000 })
await page.waitForTimeout(1000)
const noteEl = page.locator('[data-note-id]').first()
const box = await noteEl.boundingBox()
const rowH = await page.evaluate(() => document.querySelector('[data-note-id]').getBoundingClientRect().height + 4)
const client = await page.context().newCDPSession(page)
await client.send('Profiler.enable')
await client.send('Profiler.setSamplingInterval', { interval: 200 })
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
await page.mouse.down()
await client.send('Profiler.start')
for (let i = 1; i <= 30; i++) {
  await page.mouse.move(box.x + box.width / 2 + i * Math.max(4, box.width / 4), box.y + box.height / 2 - rowH * i)
  await page.waitForTimeout(12)
}
const { profile } = await client.send('Profiler.stop')
await page.mouse.up()
// Aggregate self time by function name (+ url basename).
const byId = new Map(profile.nodes.map((n) => [n.id, n]))
const self = new Map()
const dt = profile.timeDeltas
for (let i = 0; i < profile.samples.length; i++) {
  const n = byId.get(profile.samples[i])
  const cf = n.callFrame
  const key = `${cf.functionName || '(anon)'} @ ${cf.url.split('/').pop().split('?')[0]}:${cf.lineNumber}`
  self.set(key, (self.get(key) ?? 0) + (dt[i] ?? 0))
}
const total = [...self.values()].reduce((a, b) => a + b, 0)
console.log(`total sampled: ${(total / 1000).toFixed(0)}ms`)
for (const [k, v] of [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30)) {
  console.log(`${(v / 1000).toFixed(1).padStart(7)}ms  ${k}`)
}
// Same samples attributed to the nearest enclosing frame in OUR source (src/),
// so library time (jsxDEV, react-dom) lands on the component that caused it.
const parentOf = new Map()
for (const n of profile.nodes) for (const c of n.children ?? []) parentOf.set(c, n.id)
const ours = new Map()
for (let i = 0; i < profile.samples.length; i++) {
  let id = profile.samples[i]
  let key = '(none of ours)'
  while (id != null) {
    const n = byId.get(id)
    if (n.callFrame.url.includes('src_editor') || n.callFrame.url.includes('/src/')) { key = `${n.callFrame.functionName || '(anon)'}:${n.callFrame.lineNumber}`; break }
    id = parentOf.get(id)
  }
  ours.set(key, (ours.get(key) ?? 0) + (dt[i] ?? 0))
}
// And who calls jsxDEV: the first ancestor outside the jsx runtime chunk.
const jsxCallers = new Map()
for (let i = 0; i < profile.samples.length; i++) {
  const leaf = byId.get(profile.samples[i])
  if (!/jsxDEV|ReactElement|createTask|getTaskName|defineKeyPropWarningGetter/.test(leaf.callFrame.functionName)) continue
  let id = parentOf.get(profile.samples[i])
  let key = '(root)'
  while (id != null) {
    const n = byId.get(id)
    if (!/jsxDEV|ReactElement|createTask|getTaskName|defineKeyPropWarningGetter|jsxDEVImpl/.test(n.callFrame.functionName)) { key = `${n.callFrame.functionName || '(anon)'} @ ${n.callFrame.url}:${n.callFrame.lineNumber}`; break }
    id = parentOf.get(id)
  }
  jsxCallers.set(key, (jsxCallers.get(key) ?? 0) + (dt[i] ?? 0))
}
console.log('--- jsx element creation, by caller ---')
for (const [k, v] of [...jsxCallers.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
  console.log(`${(v / 1000).toFixed(1).padStart(7)}ms  ${k}`)
}
// Inclusive time of a few landmarks: React's root work (render + commit of the
// roll per move), the gesture's own pointermove handler, and the posthog
// session recorder (which snapshots the WebGL canvas and is pure noise here).
const landmarks = { performWorkOnRoot: 0, commitRoot: 0, handleMove: 0, posthog: 0 }
for (let i = 0; i < profile.samples.length; i++) {
  let id = profile.samples[i]
  const seen = new Set()
  while (id != null) {
    const n = byId.get(id)
    const fn = n.callFrame.functionName
    if (fn === 'performWorkOnRoot' || fn === 'performSyncWorkOnRoot' || fn === 'performConcurrentWorkOnRoot') seen.add('performWorkOnRoot')
    if (fn === 'commitRoot' || fn === 'commitRootImpl') seen.add('commitRoot')
    if (/handleMove/.test(fn)) seen.add('handleMove')
    if (n.callFrame.url.includes('posthog')) seen.add('posthog')
    id = parentOf.get(id)
  }
  for (const k of seen) landmarks[k] += dt[i] ?? 0
}
console.log('--- inclusive landmarks ---')
for (const [k, v] of Object.entries(landmarks)) console.log(`${(v / 1000).toFixed(1).padStart(7)}ms  ${k}`)
console.log('--- by nearest src/ frame ---')
for (const [k, v] of [...ours.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
  console.log(`${(v / 1000).toFixed(1).padStart(7)}ms  ${k}`)
}
await browser.close()
