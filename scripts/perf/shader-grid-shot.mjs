// Screenshot a hand-built shader-chain scene: a Cube with kaleidoscope + pixelate
// under a 4x4 Grid splitter (16 ShaderWrapper copies), at a beat - the worst case
// for per-object render targets. node shader-grid-shot.mjs <beat> <out.png>
// Prints gl.info.memory so target counts can be compared across changes.
import { chromium } from 'playwright'
const [beatArg, out] = process.argv.slice(2)
const BASE = process.env.BASE ?? 'http://localhost:3050'
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
page.on('pageerror', e => console.log('[pageerror]', String(e).slice(0,500)))
await page.route(/supabase\.co\/(rest|auth|storage)/, (r) => r.abort())
await page.goto(`${BASE}/editor`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => !!window.__three && !!window.__cabinStores, null, { timeout: 60000 })
await page.waitForTimeout(1500)
await page.evaluate(() => {
  const p = window.__cabinStores.project.getState()
  const notes = []
  for (let i = 0; i < 16; i++) notes.push({ id: 'n' + i, startBeat: i, durationBeats: 0.75, pitch: 60 + (i % 5), velocity: 100 })
  const track = {
    id: 'shader-cube', name: 'Cube', type: 'base', instrumentId: 'cube', params: {}, color: '#f472b6',
    muted: false, solo: false, childIds: [], blocks: [{ id: 'b1', startBar: 0, durationBars: 8, notes }],
    effects: [
      { id: 'fx-k', pluginId: 'kaleidoscope', enabled: true, settings: { segments: 4, zoom: 2.5, rotation: 0.2, spinSpeed: 0.3, hueShift: 0.1 } },
      { id: 'fx-p', pluginId: 'pixelate', enabled: true, settings: { pixelSize: 3 } },
    ],
  }
  p.addTrack(track)
  p.addTrack({
    id: 'grid-split', name: 'Grid', type: 'splitter', splitterId: 'grid', instrumentId: '', parentId: 'shader-cube',
    params: {}, inputValues: { rows: 4, columns: 4, depth: 1, spacing: 3 }, color: '#22d3ee',
    muted: false, solo: false, childIds: [], blocks: [], effects: [],
  })
})
await page.waitForTimeout(1500)
await page.evaluate((b) => { window.__cabinStores.time.getState().setCurrentBeat(Number(b)) }, beatArg)
await page.waitForTimeout(1500)
const info = await page.evaluate(() => {
  const s = window.__three.scene
  let n = 0
  s.traverse((o) => { if (o.material && o.material.fragmentShader && o.material.fragmentShader.includes('lin2srgb')) n++ })
  return { overlays: n, gl: window.__three.gl.info.memory }
})
console.log('shader overlays', JSON.stringify(info))
const clip = await page.evaluate(() => { const r = window.__three.gl.domElement.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } })
await page.screenshot({ path: out, clip })
console.log('saved', out, clip)
await browser.close()
