// Frame-by-frame capture of the Crazy Edit template for source comparison:
//
//   node scripts/capture-crazyedit-frames.mjs <outDir> [baseUrl] [start] [count]
//
// Drives a REAL browser (headed, same rationale as generate-previews.mjs)
// against a running dev server, opens /editor?template=crazyedit, and pulls
// every rendered frame as a lossless PNG through the dev-only
// window.__captureFrames hook (PreviewCaptureButton). Frames land in <outDir>
// as r0001.png..r0558.png, index-aligned with the source video's frames, so
// a pixel diff against the extracted source frames is a plain file-pair walk.
//
// Nothing is uploaded anywhere; this is a local comparison tool.

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'

const outDir = process.argv[2]
if (!outDir) {
  console.error('usage: node scripts/capture-crazyedit-frames.mjs <outDir> [baseUrl] [start] [count]')
  process.exit(1)
}
const baseUrl = process.argv[3] ?? 'http://localhost:3001'
const startFrame = Number(process.argv[4] ?? 0)
const totalFrames = Number(process.argv[5] ?? 558)
const BATCH = 20

mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch({
  headless: false,
  args: ['--autoplay-policy=no-user-gesture-required'],
})
const page = await browser.newPage({ viewport: { width: 1000, height: 900 } })
page.on('console', (m) => { if (m.type() === 'error') console.error('[page]', m.text()) })

await page.goto(`${baseUrl}/editor?template=crazyedit`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => typeof window.__captureFrames === 'function', null, { timeout: 60_000 })

// Warm up: a throwaway capture so canvases/sprites settle before the walk.
await page.waitForTimeout(500)
await page.evaluate(() => window.__captureFrames(0, 2, { fps: 30, width: 422, height: 254 }))

let written = 0
for (let s = startFrame; s < startFrame + totalFrames; s += BATCH) {
  const count = Math.min(BATCH, startFrame + totalFrames - s)
  const frames = await page.evaluate(
    ([from, n]) => window.__captureFrames(from, n, { fps: 30, width: 422, height: 254 }),
    [s, count],
  )
  if (!frames) throw new Error(`capture returned null at frame ${s}`)
  frames.forEach((dataUrl, i) => {
    const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
    writeFileSync(join(outDir, `r${String(s + i + 1).padStart(4, '0')}.png`), Buffer.from(b64, 'base64'))
  })
  written += frames.length
  console.log(`captured ${written}/${totalFrames}`)
}

await browser.close()
console.log('done')
