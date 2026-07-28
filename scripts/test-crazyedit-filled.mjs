// Smoke test: fill the Crazy Edit template's main photo slots with a test
// photo and capture a few frames - proves the slots render user photos in
// place of their placeholders.
//
//   node scripts/test-crazyedit-filled.mjs <outDir> [baseUrl]

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'

const outDir = process.argv[2]
const baseUrl = process.argv[3] ?? 'http://localhost:3001'
mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch({ headless: false, args: ['--autoplay-policy=no-user-gesture-required'] })
const page = await browser.newPage({ viewport: { width: 1000, height: 900 } })
await page.goto(`${baseUrl}/editor?template=crazyedit`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => typeof window.__captureFrames === 'function', null, { timeout: 60_000 })
await page.waitForTimeout(1000)

// Give every photoSlot track a small photo bank pointing at the test asset.
const filled = await page.evaluate(() =>
  typeof window.__fillPhotoSlots === 'function' ? window.__fillPhotoSlots(['/__slot_test.jpg']) : null,
)
if (filled === null) {
  console.error('no __fillPhotoSlots hook - add it to PreviewCaptureButton (dev-only)')
  await browser.close()
  process.exit(1)
}
console.log('filled tracks:', filled)
await page.waitForTimeout(800)

for (const f of [30, 100, 200, 250, 420, 510]) {
  const frames = await page.evaluate(
    ([from]) => window.__captureFrames(from, 1, { fps: 30, width: 422, height: 254 }),
    [f],
  )
  const b64 = frames[0].slice(frames[0].indexOf(',') + 1)
  writeFileSync(join(outDir, `filled${String(f + 1).padStart(4, '0')}.png`), Buffer.from(b64, 'base64'))
}
await browser.close()
console.log('done')
