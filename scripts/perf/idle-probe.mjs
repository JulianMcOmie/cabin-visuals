// Idle-cost probe: how much per-frame work runs while the editor is paused.
import { chromium } from 'playwright'

const BASE = process.env.BASE ?? 'http://localhost:3050'
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] })
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } })
await page.route(/supabase\.co\/(rest|auth)/, (r) => r.abort())
await page.addInitScript(() => {
  window.__bleedDraws = 0
  window.__glFrames = 0
  const orig = CanvasRenderingContext2D.prototype.drawImage
  CanvasRenderingContext2D.prototype.drawImage = function (...args) {
    if (this.canvas.width === 192 && this.canvas.height === 108) window.__bleedDraws++
    return orig.apply(this, args)
  }
})
await page.goto(`${BASE}/editor`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => !!window.__three, null, { timeout: 60000 })
// count r3f frames via the dev hook
await page.evaluate(() => {
  const s = window.__r3fState?.()
  if (s) { const orig = s.gl.render.bind(s.gl); s.gl.render = (...a) => { window.__glFrames++; return orig(...a) } }
})
await page.waitForTimeout(2500)
await page.evaluate(() => { window.__bleedDraws = 0; window.__glFrames = 0 })
await page.waitForTimeout(3000)
const idle = await page.evaluate(() => ({ bleedDrawsPer3s: window.__bleedDraws, glFramesPer3s: window.__glFrames, frameloop: window.__r3fState?.().frameloop }))
console.log('paused/idle 3s:', idle)
// press play (space) and measure
await page.keyboard.press('Space')
await page.waitForTimeout(500)
await page.evaluate(() => { window.__bleedDraws = 0; window.__glFrames = 0 })
await page.waitForTimeout(3000)
const playing = await page.evaluate(() => ({ bleedDrawsPer3s: window.__bleedDraws, glFramesPer3s: window.__glFrames, frameloop: window.__r3fState?.().frameloop, isPlaying: window.__cabinStores?.time?.getState?.().isPlaying }))
console.log('playing 3s:', playing)
await browser.close()
