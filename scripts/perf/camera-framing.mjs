// BASE=http://localhost:3289 node scripts/perf/camera-framing.mjs
import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] })
const close = (a, b, label) => assert.ok(Math.abs(a - b) < 0.002, `${label}: ${a} != ${b}`)
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, reducedMotion: 'reduce' })
  const errors = []
  page.on('pageerror', error => errors.push(String(error)))
  await page.goto(`${process.env.BASE ?? 'http://localhost:3289'}/editor`, { waitUntil: 'domcontentloaded', timeout: 120000 })
  await page.waitForFunction(() => window.__previewRuntime?.rendering && window.__three, null, { timeout: 60000 })
  for (const rig of [null, 'cameraControl', 'cameraOrbit']) {
    await page.evaluate(rig => {
      const { project, time } = window.__cabinStores, p = project.getState(), sceneId = p.activeSceneId
      const cube = { id: 'framing-cube', name: 'Cube', instrumentId: 'cube', type: 'base', color: '#fff', muted: false, solo: false, childIds: [], params: { size: 1 }, blocks: [] }
      const camera = { ...cube, id: 'framing-camera', instrumentId: rig, params: { fov: 75 } }
      const tracks = { [cube.id]: cube, ...(rig ? { [camera.id]: camera } : {}) }
      const scene = { ...p.scenes[sceneId], tracks, rootTrackIds: Object.keys(tracks) }
      const mainId = p.sceneOrder.find(id => p.scenes[id].isMain)
      const comp = { ...cube, id: 'framing-comp', instrumentId: 'scene', sceneBindings: [{ sceneId, pitch: 60 }] }
      project.setState({ viewAspect: '16:9', scenes: { ...p.scenes, [sceneId]: scene, [mainId]: { ...p.scenes[mainId], tracks: { [comp.id]: comp }, rootTrackIds: [comp.id] } }, tracks, rootTrackIds: scene.rootTrackIds })
      time.setState({ currentBeat: 1, isPlaying: false })
    }, rig)
    await page.waitForTimeout(2000)
    const projection = () => page.evaluate(() => {
      const m = window.__three.camera.projectionMatrix.elements
      const canvas = [...document.querySelectorAll('.visual-canvas-root canvas')].find(c => c.style.pointerEvents === 'none')
      return { x: m[0], y: m[5], aspect: canvas.width / canvas.height, runtime: window.__previewRuntime.rendering }
    })
    const landscape = await projection()
    close(landscape.x, 1 / (Math.tan((rig ? 75 : 55) * Math.PI / 360) * 16 / 9), `${rig}: landscape FOV`)
    for (const aspect of ['9:16', '16:9', '9:16']) {
      await page.evaluate(aspect => window.__cabinStores.project.getState().setViewAspect(aspect), aspect)
      await page.waitForTimeout(1200)
      const preview = await projection()
      assert.ok(preview.runtime, `${rig}: worker rendering`)
      close(preview.x, landscape.x, `${rig}: width preserved at ${aspect}`)
      close(preview.y / preview.x, aspect === '9:16' ? 9 / 16 : 16 / 9, `${rig}: square pixels`)
      if (!rig) await page.locator('.visual-canvas-smooth').screenshot({ path: `/private/tmp/cabin-framing-${aspect.replace(':', 'x')}.png` })
    }
    const preview = await projection()
    const exported = await page.evaluate(async () => {
      const driver = window.__cabinVisual.getFrameDriver()
      driver.pin(360, 640)
      try {
        await driver.prepare(1)
        driver.renderFrame(1, 0)
        const { camera, viewport } = window.__three
        const first = camera.projectionMatrix.elements.slice()
        driver.renderFrame(1, 0)
        const second = camera.projectionMatrix.elements.slice()
        return { first, second, viewportAspect: viewport.width / viewport.height }
      } finally { driver.unpin() }
    })
    close(exported.first[0], preview.x, `${rig}: export matches preview width`)
    // The small preview rounds fractional CSS dimensions to whole pixels.
    // Compare vertical coverage in frame-width units at the two actual ratios.
    close(exported.first[5] / (9 / 16), preview.y / preview.aspect, `${rig}: export matches preview height`)
    close(exported.viewportAspect, 9 / 16, `${rig}: full-frame viewport`)
    assert.deepEqual(exported.first, exported.second, `${rig}: repeated export is stable`)
    console.log(`${rig ?? 'default camera'}: landscape, portrait, round trip and export passed`)
    await page.waitForTimeout(1000)
  }
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.evaluate(() => window.__cabinStores.project.getState().setViewAspect('16:9'))
  await page.waitForTimeout(700)
  await page.evaluate(() => window.__cabinStores.project.getState().setViewAspect('9:16'))
  await page.waitForTimeout(100)
  assert.equal(await page.locator('.aspect-canvas-pin').count(), 0, 'narrow transition uses live framing instead of cropping')
  await page.waitForTimeout(1000)
  console.log('portrait transition: live framing passed')
  assert.deepEqual(errors, [])
} finally { await browser.close() }
