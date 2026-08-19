// Full-res pixel hashes of the Midi Roll's own canvas at a list of beats, for
// each play style. node mr-hash.mjs <project.json|template:id> <out.json>
import { chromium } from 'playwright'
import { readFileSync, writeFileSync } from 'fs'
import { createHash } from 'crypto'

const [src, out] = process.argv.slice(2)
const BASE = process.env.BASE ?? 'http://localhost:3081'
const isTemplate = src.startsWith('template:')
const proj = isTemplate ? null : JSON.parse(readFileSync(src, 'utf8'))
const BEATS = [0, 0.37, 4, 8, 13, 21, 33.5, 61.25]
const STYLES = [
  { playStyle: 0 },
  { playStyle: 1 },
  { playStyle: 2 },
  { playStyle: 3 },
  { playStyle: 2, backdrop: 0, stars: 0 },
  { playStyle: 3, glow: 0, ripple: 0.4, rounded: 1 },
]

const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
await page.route(/supabase\.co\/(rest|auth|storage)/, (r) => r.abort())
await page.goto(`${BASE}/editor${isTemplate ? `?template=${src.slice(9)}` : ''}`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => !!window.__three && !!window.__cabinStores && !!window.__cabinHydrate, null, { timeout: 90000 })
if (proj) await page.evaluate(async (p) => { await window.__cabinHydrate(p.document, p.name) }, proj)
await page.waitForTimeout(3000)
const trackId = await page.evaluate(() => Object.values(window.__cabinStores.project.getState().tracks).find((t) => t.instrumentId === 'midiRoll')?.id)
const result = {}
for (const style of STYLES) {
  await page.evaluate(({ trackId, style }) => { const s = window.__cabinStores.project.getState(); for (const [k, v] of Object.entries(style)) s.setTrackParam(trackId, k, v) }, { trackId, style })
  await page.waitForTimeout(400)
  const key = JSON.stringify(style)
  result[key] = {}
  for (const b of BEATS) {
    await page.evaluate((b) => { window.__cabinStores.time.getState().setCurrentBeat(b) }, b)
    await page.waitForTimeout(350)
    const data = await page.evaluate(() => window.__midiRollDebug.main.toDataURL('image/png'))
    result[key][b] = createHash('md5').update(data).digest('hex')
  }
  // Return the knobs to defaults-ish so the next style starts clean.
  await page.evaluate(({ trackId }) => { const s = window.__cabinStores.project.getState(); s.setTrackParam(trackId, 'backdrop', 1); s.setTrackParam(trackId, 'stars', 0.85); s.setTrackParam(trackId, 'glow', 0.55); s.setTrackParam(trackId, 'ripple', 0.6); s.setTrackParam(trackId, 'rounded', 0) }, { trackId })
}
const size = await page.evaluate(() => [window.__midiRollDebug.main.width, window.__midiRollDebug.main.height])
console.log('canvas', size)
writeFileSync(out, JSON.stringify(result, null, 1))
console.log(JSON.stringify(result, null, 1))
await browser.close()
