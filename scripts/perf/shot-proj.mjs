// Screenshot a hydrated PROJECT's canvas at a set of beats, in both canvas
// views. node shot-proj.mjs <project.json> <outdir> <tag> [--handbuilt]
//   --handbuilt: strip the doc to ONE overlapShape track + a 4x4 grid splitter,
//     overlapMode=Color, keeping the scene track's hue-rotate mover so per-copy
//     colorShift is exercised on both fills.
import { chromium } from 'playwright'
import { readFileSync } from 'fs'

const args = process.argv.slice(2)
const handbuilt = args.includes('--handbuilt')
const [file, outdir, tag] = args.filter((a) => a !== '--handbuilt')
const BASE = process.env.BASE ?? 'http://localhost:3087'
const BEATS = [0, 4, 8, 16, 32]
const proj = JSON.parse(readFileSync(file, 'utf8'))

if (handbuilt) {
  const doc = proj.document
  const scene = Object.values(doc.scenes).find((s) => !s.isMain)
  const keepRoot = scene.rootTrackIds.find((id) => scene.tracks[id].instrumentId === 'overlapShape')
  const track = scene.tracks[keepRoot]
  const grid = track.childIds.map((id) => scene.tracks[id]).find((t) => t.splitterId === 'grid')
  const keep = new Set([keepRoot, grid.id])
  track.childIds = [grid.id]
  grid.childIds = []
  grid.inputValues = { rows: 4, columns: 4, spacing: 2 }
  track.params = { ...track.params, overlapMode: 1, size: 1.4 }
  scene.rootTrackIds = [keepRoot]
  for (const id of Object.keys(scene.tracks)) if (!keep.has(id)) delete scene.tracks[id]
}

const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
await page.route(/supabase\.co\/(rest|auth|storage)/, (r) => r.abort())
await page.goto(`${BASE}/editor`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => !!window.__three && !!window.__cabinStores && !!window.__cabinHydrate, null, { timeout: 120000 })
await page.waitForTimeout(1500)
await page.evaluate(async (p) => { await window.__cabinHydrate(p.document, p.name ?? 'shot') }, proj)
await page.waitForTimeout(3000)
const clip = await page.evaluate(() => { const r = window.__three.gl.domElement.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } })
for (const view of ['scene', 'main']) {
  await page.evaluate((v) => { window.__cabinStores.ui.getState().setCanvasView(v) }, view)
  await page.waitForTimeout(600)
  for (const beat of BEATS) {
    await page.evaluate((b) => { window.__cabinStores.time.getState().setCurrentBeat(b) }, beat)
    await page.waitForTimeout(1000)
    const out = `${outdir}/${tag}-${view}-b${beat}.png`
    await page.screenshot({ path: out, clip })
    console.log('saved', out)
  }
}
await browser.close()
