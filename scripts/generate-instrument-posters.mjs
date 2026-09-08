// Read-only backfill from the public clips. No service key or uploads needed.
// npm run previews:posters [-- cube laserSphere]
// --local also captures missing stills from PREVIEW_BASE_URL (a dev server).
import { config } from 'dotenv'
import { createInstrumentPoster, readInstrumentPosters, writeInstrumentPosters } from './lib/instrument-posters.mjs'

config({ path: new URL('../.env.local', import.meta.url), quiet: true })
const base = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/instrument-previews`
const response = await fetch(`${base}/manifest.json`)
if (!response.ok) throw new Error(`Manifest: HTTP ${response.status}`)
const versions = await response.json()
const posters = await readInstrumentPosters()
const ids = process.argv.slice(2).filter(id => !id.startsWith('--'))
const pending = Object.entries(versions).filter(([id, version]) => ids.length ? ids.includes(id) : posters[id]?.version !== version)
let failed = false
await Promise.all(Array.from({ length: 3 }, async () => {
  for (let entry; (entry = pending.shift());) {
    const [id, version] = entry
    try {
      const clip = await fetch(`${base}/${id}.mp4?v=${encodeURIComponent(version)}`)
      if (!clip.ok) throw new Error(`HTTP ${clip.status}`)
      posters[id] = await createInstrumentPoster(id, Buffer.from(await clip.arrayBuffer()), version)
      console.log(`${id}: ready`)
    } catch (error) {
      failed = true
      console.error(`${id}: ${error.message}`)
    }
  }
}))
await writeInstrumentPosters(posters)
if (process.argv.includes('--local')) {
  const { chromium } = await import('playwright')
  const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] })
  try {
    const page = await browser.newPage()
    await page.goto(`${process.env.PREVIEW_BASE_URL || 'http://localhost:3000'}/dev/instrument-previews`, { timeout: 120000 })
    await page.waitForFunction(() => !!window.__captureInstrumentPreview, { timeout: 60000 })
    const capturable = await page.evaluate(() => window.__instrumentPreviewIds)
    for (const id of capturable.filter(id => !versions[id] && (ids.length ? ids.includes(id) : !posters[id]))) {
      const b64 = await page.evaluate(id => window.__captureInstrumentPreview(id), id)
      if (!b64) throw new Error(`No capture returned for ${id}`)
      // No public clip exists: an empty version keeps this card still-only.
      posters[id] = await createInstrumentPoster(id, Buffer.from(b64, 'base64'), '')
      await writeInstrumentPosters(posters)
      console.log(`${id}: local still ready`)
    }
  } finally { await browser.close() }
}
if (failed) process.exitCode = 1
