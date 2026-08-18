// Piano roll render-identity check + drag cost probe.
//
//   node scripts/perf/roll-rows-check.mjs <template> <out.json> [compare.json]
//
// Opens the first few blocks with notes (one per track) in the piano roll and
// records, per block: every row label's title/text/height/background, and every
// note element's id + inline geometry + fill. Written to <out.json>. Given a
// <compare.json> from another build it asserts the two are identical, so a
// refactor of the roll can prove it changed nothing the DOM shows.
//
// Also drives one real note drag (30 pointermoves) on the first block and
// reports CDP task/script durations for it - the "how much work per move"
// number a memoization pass is meant to shrink.
import { chromium } from 'playwright'
import { readFileSync, writeFileSync } from 'node:fs'

const BASE = process.env.BASE ?? 'http://localhost:3072'
const [template = 'wormhole', outFile = 'roll-rows.json', compareFile] = process.argv.slice(2)
const MAX_BLOCKS = 5

const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
await page.route(/supabase\.co\/(rest|auth|storage)/, (r) => r.abort())
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
await page.goto(`${BASE}/editor?template=${template}`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => !!window.__three && !!window.__cabinStores, null, { timeout: 60000 })
await page.waitForFunction(() => document.querySelectorAll('[data-block-id]').length > 0, null, { timeout: 30000 })

const targets = await page.evaluate((max) => {
  const p = window.__cabinStores.project.getState()
  const out = []
  for (const id of p.rootTrackIds) {
    const walk = (tid) => {
      const t = p.tracks[tid]
      if (!t) return
      const b = t.blocks?.find((b) => b.notes.length > 0)
      if (b && out.length < max) out.push({ trackId: t.id, blockId: b.id, kind: `${t.type}:${t.instrumentId ?? t.moverId ?? t.splitterId ?? ''}` })
      for (const c of t.childIds ?? []) walk(c)
    }
    walk(id)
  }
  return out
}, MAX_BLOCKS)

const snapshot = { template, blocks: [] }
for (const target of targets) {
  await page.evaluate((t) => window.__cabinStores.ui.getState().setEditingBlock(null), target)
  await page.waitForTimeout(250)
  await page.evaluate((t) => window.__cabinStores.ui.getState().setEditingBlock({ trackId: t.trackId, blockId: t.blockId }), target)
  await page.waitForTimeout(900)
  await page.waitForFunction(() => document.querySelectorAll('[data-note-id]').length > 0, null, { timeout: 15000 })
  const snap = await page.evaluate(() => {
    const guide = document.querySelector('[data-midi-note-drag-guide]')
    const root = guide?.parentElement
    const col = root?.querySelector('div[style*="position: sticky"]')
    const rows = col
      ? [...col.children].filter((c) => c.hasAttribute('title')).map((c) => {
          const span = c.querySelector('span')
          const cs = getComputedStyle(c)
          return {
            title: c.getAttribute('title'),
            text: c.textContent,
            height: c.getBoundingClientRect().height,
            bg: cs.backgroundColor,
            labelColor: span ? getComputedStyle(span).color : null,
            labelFontSize: span ? getComputedStyle(span).fontSize : null,
            role: c.getAttribute('role'),
          }
        })
      : null
    const notes = [...document.querySelectorAll('[data-note-id]')].map((n) => ({
      id: n.getAttribute('data-note-id'),
      left: n.style.left, top: n.style.top, width: n.style.width, height: n.style.height,
      bg: n.style.backgroundColor, z: n.style.zIndex, shadow: n.style.boxShadow, text: n.textContent,
    }))
    // Row stripes in the grid: count + geometry of the pointer-inert bands.
    const grid = root?.querySelector('[data-midi-block-region]')?.parentElement
    const stripes = grid
      ? [...grid.children].filter((c) => c.style.pointerEvents === 'none' && c.style.borderBottom && c.style.right === '0px' && !c.style.backgroundImage).map((c) => `${c.style.top}|${c.style.height}|${c.style.backgroundColor}`)
      : null
    return { rows, notes, stripes }
  })
  snapshot.blocks.push({ ...target, ...snap })
  console.log(`${target.kind}: ${snap.rows?.length ?? '?'} rows, ${snap.notes.length} notes, ${snap.stripes?.length ?? '?'} stripes`)
}

// Drag cost: 30 pointermoves on the first block's first note.
{
  const t = targets[0]
  await page.evaluate(() => window.__cabinStores.ui.getState().setEditingBlock(null))
  await page.waitForTimeout(250)
  await page.evaluate((t) => window.__cabinStores.ui.getState().setEditingBlock({ trackId: t.trackId, blockId: t.blockId }), t)
  await page.waitForTimeout(900)
  await page.waitForFunction(() => document.querySelectorAll('[data-note-id]').length > 0, null, { timeout: 15000 })
  const client = await page.context().newCDPSession(page)
  await client.send('Performance.enable')
  const noteEl = page.locator('[data-note-id]').first()
  const box = await noteEl.boundingBox()
  const rowH = await page.evaluate(() => document.querySelector('[data-note-id]').getBoundingClientRect().height + 4)
  const runs = []
  for (let run = 0; run < 3; run++) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    const m0 = await client.send('Performance.getMetrics')
    const t0 = Date.now()
    for (let i = 1; i <= 30; i++) {
      // Every move lands on a NEW snapped position (a whole row + a fraction of
      // the note per step) so each one really rebuilds the note array.
      await page.mouse.move(box.x + box.width / 2 + i * Math.max(4, box.width / 4), box.y + box.height / 2 - rowH * i)
      await page.waitForTimeout(12)
    }
    const m1 = await client.send('Performance.getMetrics')
    const wall = Date.now() - t0
    // Drag back to the start so the note lands where it began (no store change).
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.waitForTimeout(30)
    await page.mouse.up()
    await page.waitForTimeout(150)
    const pick = (m, k) => m.metrics.find((x) => x.name === k)?.value ?? 0
    runs.push({
      taskMs: Math.round((pick(m1, 'TaskDuration') - pick(m0, 'TaskDuration')) * 1000),
      scriptMs: Math.round((pick(m1, 'ScriptDuration') - pick(m0, 'ScriptDuration')) * 1000),
      layoutMs: Math.round((pick(m1, 'LayoutDuration') - pick(m0, 'LayoutDuration')) * 1000),
      styleMs: Math.round((pick(m1, 'RecalcStyleDuration') - pick(m0, 'RecalcStyleDuration')) * 1000),
      wallMs: wall,
    })
  }
  snapshot.drag = runs
  console.log('drag (30 moves) x3:', JSON.stringify(runs))
}

writeFileSync(outFile, JSON.stringify(snapshot, null, 1))
console.log('errors:', errors.length ? errors : 'none')

if (compareFile) {
  const other = JSON.parse(readFileSync(compareFile, 'utf8'))
  let same = other.blocks.length === snapshot.blocks.length
  const diffs = []
  for (let i = 0; i < Math.min(other.blocks.length, snapshot.blocks.length); i++) {
    const a = other.blocks[i], b = snapshot.blocks[i]
    for (const key of ['rows', 'notes', 'stripes']) {
      const ja = JSON.stringify(a[key]), jb = JSON.stringify(b[key])
      if (ja !== jb) { same = false; diffs.push(`${b.kind} ${key}: ${ja.length} vs ${jb.length} chars`) }
    }
  }
  console.log(same ? 'IDENTICAL to ' + compareFile : 'DIFFERENT: ' + diffs.join('; '))
  if (!same) process.exitCode = 1
}
await browser.close()
