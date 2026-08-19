// Which code issues the gl.render() passes each frame? Groups by caller stack line.
import { chromium } from 'playwright'
import { readFileSync } from 'fs'
const [src, secsArg] = process.argv.slice(2); const secs = Number(secsArg ?? 3)
const BASE = process.env.BASE ?? 'http://localhost:3050'
const isTemplate = src.startsWith('template:'); const proj = isTemplate ? null : JSON.parse(readFileSync(src, 'utf8'))
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] })
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
await page.route(/supabase\.co\/(rest|auth)/, (r) => r.abort())
await page.goto(`${BASE}/editor${isTemplate ? `?template=${src.slice(9)}` : ''}`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => !!window.__three && !!window.__cabinStores && !!window.__cabinHydrate, null, { timeout: 90000 })
if (proj) await page.evaluate(async (p) => { await window.__cabinHydrate(p.document, p.name) }, proj)
await page.waitForTimeout(4000)
await page.evaluate(() => {
  const st = window.__r3fState(); const gl = st.gl
  window.__passes = new Map(); window.__frames = 0
  const orig = gl.render.bind(gl)
  gl.render = (scene, camera) => {
    const stack = (new Error().stack || '').split('\n').slice(2, 6).map((l) => l.trim().replace(/\(.*\/(.*?)\)$/, '$1').replace(/^at /, '')).join(' < ')
    const target = gl.getRenderTarget(); const key = `${scene?.name || scene?.type || '?'}[${scene?.children?.length ?? '?'}ch] -> ${target ? `${target.width}x${target.height}` : 'screen'} :: ${stack.slice(0, 160)}`
    window.__passes.set(key, (window.__passes.get(key) ?? 0) + 1)
    return orig(scene, camera)
  }
  const tick = () => { window.__frames++; requestAnimationFrame(tick) }; requestAnimationFrame(tick)
  window.__cabinStores.time.getState().setCurrentBeat(0)
})
await page.keyboard.press('Space'); await page.waitForTimeout(secs * 1000); await page.keyboard.press('Space')
const out = await page.evaluate(() => ({ frames: window.__frames, passes: [...window.__passes.entries()].sort((a, b) => b[1] - a[1]) }))
console.log('frames', out.frames)
for (const [k, v] of out.passes) console.log((v / out.frames).toFixed(2).padStart(6), 'per frame  ', k)
await browser.close()
