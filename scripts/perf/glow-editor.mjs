import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
mkdirSync('artifacts/glow', { recursive: true })
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
// SwiftShader can take longer to drain its GPU queue for a screenshot.
page.setDefaultTimeout(120000)
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
})
await page.goto('http://localhost:3197/editor', { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => !!window.__cabinStores && !!window.__three, null, { timeout: 90000 })
await page.evaluate(() => {
  const p = window.__cabinStores.project.getState()
  p.setViewAspect('16:9')
  function add(id, instrumentId, x, y, params = {}, color = '#185b89') {
    p.addTrack({
      id,
      name: id,
      type: 'base',
      instrumentId,
      color,
      muted: false,
      solo: false,
      blocks: [],
      childIds: [],
      params: { tfX: x, tfY: y, ...params },
      stringParams: { color, baseColor: color },
    })
    p.addEffect(id, 'glow')
  }
  add(
    'Glow Line',
    'laserLine',
    -3,
    1.4,
    { length: 3, thickness: 0.012, glow: 1.5, whiteCore: 0, light: 0 },
    '#783019',
  )
  add('Glow Solid', 'cube', -3, -1.4, { size: 0.8 }, '#164d31')
  add('Glow Particle', 'particle', 3, 1.4, { size: 0.16, glow: 0.1 }, '#853161')
  add('Glow Wire', 'wireframe', 3, -1.4, { size: 1 }, '#34217e')
  add('Glow Text', 'textDisplay', 0, 0, {}, '#17668b')
  p.addBlock('Glow Text', {
    id: 'text-note',
    startBar: 0,
    durationBars: 2,
    loop: false,
    notes: [{ id: 'word', startBeat: 0, durationBeats: 6, pitch: 60, velocity: 100 }],
  })
  p.sliceLyricsIntoClips('Glow Text', 'GLOW', 0)
  p.addMoverTrack('Glow Particle', 'line', 'Duplicate')
  const copies = window.__cabinStores.project.getState().tracks['Glow Particle'].childIds[0]
  p.setMoverInput(copies, 'copies', 8)
  p.setMoverInput(copies, 'spacing', 0.28)
  p.setMoverInput(copies, 'angle', 90)
  window.__cabinStores.time.getState().setCurrentBeat(0.5)
  window.__cabinStores.ui.getState().setSelectedTrackId('Glow Solid')
})
await page.waitForTimeout(4000)
console.log(
  'scene',
  await page.evaluate(() => ({
    objects: window.__cabinVisual?.getCompositionLayers?.(),
    state: window.__cabinVisual?.getObjectState?.('Glow Solid'),
    selection: window.__cabinStores.selection ? Object.keys(window.__cabinStores.selection.getState()) : null,
  })),
)
await page.screenshot({ path: 'artifacts/glow/editor-instruments.png' })
await page.getByRole('button', { name: 'Effects', exact: true }).click()
await page.waitForTimeout(1000)
await page.screenshot({ path: 'artifacts/glow/editor-panel.png' })
console.log(
  'panel',
  await page
    .locator('body')
    .innerText()
    .then((t) => t.slice(0, 1500)),
)
// Actual canvas readback, same task as manual frame advance (no wall clock input).
const capture = () =>
  page.evaluate(() => {
    const renderer = window.__three.gl,
      render = renderer.render.bind(renderer)
    let renders = 0,
      extractions = 0,
      blurs = 0
    renderer.render = (scene, camera) => {
      renders++
      for (const o of scene.children) {
        if (o.material?.name === 'Glow extract') extractions++
        if (o.material?.name === 'Glow blur') blurs++
      }
      return render(scene, camera)
    }
    const begin = performance.now()
    window.__three.advance(begin, true)
    const cpuMs = performance.now() - begin
    renderer.render = render
    const gl = window.__three.gl,
      ctx = gl.getContext(),
      w = ctx.drawingBufferWidth,
      h = ctx.drawingBufferHeight,
      data = new Uint8Array(w * h * 4)
    // Live track previews may have an asynchronous pixel-pack read pending.
    // Typed-array readPixels requires no pack buffer, then restore that binding.
    const pack = ctx.getParameter(ctx.PIXEL_PACK_BUFFER_BINDING)
    ctx.bindBuffer(ctx.PIXEL_PACK_BUFFER, null)
    ctx.readPixels(0, 0, w, h, ctx.RGBA, ctx.UNSIGNED_BYTE, data)
    ctx.bindBuffer(ctx.PIXEL_PACK_BUFFER, pack)
    let sum = 0,
      hash = 2166136261
    for (const n of data) {
      sum += n
      hash = Math.imul(hash ^ n, 16777619)
    }
    return { w, h, sum, hash: hash >>> 0, renders, extractions, blurs, cpuMs }
  })
const a = await capture(),
  b = await capture()
await page.evaluate(() => window.__cabinStores.time.getState().setCurrentBeat(2))
await page.waitForTimeout(300)
await capture()
await page.evaluate(() => window.__cabinStores.time.getState().setCurrentBeat(0.5))
await page.waitForTimeout(300)
const scrubReturn = await capture()
await page.evaluate(() => document.activeElement?.blur())
await page.keyboard.press('Space')
await page.waitForTimeout(400)
await page.keyboard.press('Space')
await page.evaluate(() => window.__cabinStores.time.getState().setCurrentBeat(0.5))
await page.waitForTimeout(300)
const playbackReturn = await capture()
await page.evaluate(() => window.__cabinVisual.getFrameDriver().pin(1920, 1080))
await page.waitForTimeout(400)
const exported = await page.evaluate(() => {
  const d = window.__cabinVisual.getFrameDriver(),
    g = window.__three.gl.getContext()
  function frame(t) {
    d.renderFrame(0.5, t)
    const bytes = new Uint8Array(g.drawingBufferWidth * g.drawingBufferHeight * 4)
    const pack = g.getParameter(g.PIXEL_PACK_BUFFER_BINDING)
    g.bindBuffer(g.PIXEL_PACK_BUFFER, null)
    g.readPixels(0, 0, g.drawingBufferWidth, g.drawingBufferHeight, g.RGBA, g.UNSIGNED_BYTE, bytes)
    g.bindBuffer(g.PIXEL_PACK_BUFFER, pack)
    let hash = 2166136261
    for (const n of bytes) hash = Math.imul(hash ^ n, 16777619)
    return hash >>> 0
  }
  const first = frame(0),
    second = frame(1000),
    png = d.getCanvas().toDataURL()
  return { first, second, width: g.drawingBufferWidth, height: g.drawingBufferHeight, png }
})
writeFileSync('artifacts/glow/export-1080.png', Buffer.from(exported.png.split(',')[1], 'base64'))
delete exported.png
await page.evaluate(() => window.__cabinVisual.getFrameDriver().unpin())
await page.waitForTimeout(400)
// Reordering an ordinary pixel pass across Glow must change the rendered chain.
await page.evaluate(() => {
  const p = window.__cabinStores.project.getState()
  p.addEffect('Glow Solid', 'pixelate')
  const fx = window.__cabinStores.project.getState().tracks['Glow Solid'].effects.at(-1)
  p.setEffectSetting('Glow Solid', fx.id, 'pixelSize', 28)
})
await page.waitForTimeout(800)
const glowThenPixel = await capture()
await page.evaluate(() => {
  const p = window.__cabinStores.project.getState(),
    fx = p.tracks['Glow Solid'].effects.find((e) => e.pluginId === 'pixelate')
  p.reorderEffect('Glow Solid', fx.id, -1)
})
await page.waitForTimeout(800)
const pixelThenGlow = await capture()
await page.evaluate(() => {
  const p = window.__cabinStores.project.getState(),
    fx = p.tracks['Glow Solid'].effects.find((e) => e.pluginId === 'pixelate')
  p.removeEffect('Glow Solid', fx.id)
})
await page.waitForTimeout(800)
// Presets use the same editable values and renderer as the knobs.
await page.getByRole('button', { name: 'Dreamy', exact: true }).click()
await page.waitForTimeout(500)
await capture()
await page.screenshot({ path: 'artifacts/glow/editor-dreamy.png' })
await page.getByRole('button', { name: 'SOURCE · COLOR · CORE · SHAPE', exact: true }).click()
await page.screenshot({ path: 'artifacts/glow/editor-advanced.png' })
const preset = await page.evaluate(
  () => window.__cabinStores.project.getState().tracks['Glow Solid'].effects[0].settings,
)
await page.evaluate(() => {
  const p = window.__cabinStores.project.getState()
  for (const t of Object.values(p.tracks))
    for (const e of t.effects ?? []) if (e.pluginId === 'glow') p.setEffectSetting(t.id, e.id, 'strength', 0)
})
await page.waitForTimeout(500)
const off = await capture()
await page.screenshot({ path: 'artifacts/glow/editor-disabled.png' })
console.log('pixels', {
  a,
  b,
  off,
  glowThenPixel,
  pixelThenGlow,
  preset,
  scrubReturn,
  playbackReturn,
  exported,
})
if (
  a.hash !== b.hash ||
  a.hash !== scrubReturn.hash ||
  a.hash !== playbackReturn.hash ||
  exported.first !== exported.second ||
  exported.width !== 1920 ||
  off.sum <= off.w * off.h * 255 ||
  a.hash === off.hash ||
  glowThenPixel.hash === pixelThenGlow.hash ||
  errors.length
)
  process.exitCode = 1
console.log('errors', errors)
writeFileSync('artifacts/glow/editor-errors.json', JSON.stringify(errors, null, 2))
writeFileSync(
  'artifacts/glow/editor-results.json',
  JSON.stringify(
    { a, b, off, glowThenPixel, pixelThenGlow, preset, scrubReturn, playbackReturn, exported, errors },
    null,
    2,
  ),
)
await browser.close()
