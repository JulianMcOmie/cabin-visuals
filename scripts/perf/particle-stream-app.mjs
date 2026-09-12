// Local editor smoke; uses a fresh browser context and never saves a project.
// BASE=http://127.0.0.1:3217 node scripts/perf/particle-stream-app.mjs
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'

const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  page.on('console', m => { if (m.type() === 'error' && /shader|VALIDATE|WebGLProgram/i.test(m.text())) errors.push(m.text()) })
  await page.route(/supabase\.co\/(rest|auth|storage)/, r => r.abort())
  await page.goto(`${process.env.BASE ?? 'http://127.0.0.1:3217'}/editor`, { waitUntil: 'domcontentloaded', timeout: 120000 })
  await page.waitForFunction(() => !!window.__three && !!window.__cabinStores, null, { timeout: 120000 })
  await page.evaluate(() => {
    const p = window.__cabinStores.project.getState()
    for (const id of Object.keys(p.tracks)) p.deleteTrack(id)
    const gl = window.__three.gl, render = gl.render.bind(gl)
    gl.render = (scene, camera) => {
      scene.traverse(o => { if (o.name === 'Particle Stream') window.__streamMesh = o })
      return render(scene, camera)
    }
    p.addTrack({ id: 'stream-smoke', name: 'Particle Stream', type: 'base', instrumentId: 'particleStream',
      params: {}, stringParams: {}, color: '#7dd3fc', muted: false, solo: false, childIds: [], effects: [],
      blocks: [{ id: 'stream-block', startBar: 0, durationBars: 8,
        notes: [{ id: 'center', pitch: 60, startBeat: 4.13, durationBeats: 0.25, velocity: 100 },
          { id: 'pairs', pitch: 61, startBeat: 8.17, durationBeats: 0.25, velocity: 100 }] }],
    })
    window.__cabinStores.ui.getState().setSelectedTrackId('stream-smoke')
  })
  await page.waitForFunction(() => window.__previewRuntime?.rendering && !window.__previewRuntime.error, null, { timeout: 60000 })
  const worker = await page.evaluate(() => ({ worker: window.__previewRuntime.worker, rendering: window.__previewRuntime.rendering, error: window.__previewRuntime.error }))
  assert.ok(worker.worker && worker.rendering && !worker.error)
  await page.evaluate(async () => {
    const driver = window.__cabinVisual.getFrameDriver()
    driver.pin(960, 540)
    await driver.prepare(0)
    driver.renderFrame(0, 0)
  })
  await page.waitForFunction(() => !!window.__streamMesh, null, { timeout: 60000 })
  await page.getByTestId('particle-stream-panel').waitFor({ state: 'visible' })
  assert.match(await page.getByTestId('particle-stream-panel').innerText(), /STREAMS/)
  const result = await page.evaluate(() => {
    const three = window.__three, stores = window.__cabinStores
    const render = beat => {
      stores.time.getState().setCurrentBeat(beat)
      const driver = window.__cabinVisual.getFrameDriver()
      driver.prepareFrame(beat)
      driver.renderFrame(beat, beat * 500)
      const mesh = window.__streamMesh
      const ctx = three.gl.getContext(), pixels = new Uint8Array(ctx.drawingBufferWidth * ctx.drawingBufferHeight * 4)
      ctx.readPixels(0, 0, ctx.drawingBufferWidth, ctx.drawingBufferHeight, ctx.RGBA, ctx.UNSIGNED_BYTE, pixels)
      let hash = 2166136261
      for (const value of pixels) hash = Math.imul(hash ^ value, 16777619) >>> 0
      const cross = []
      for (let i = 0; i < mesh.count; i++) {
        const offset = i * 16, matrix = mesh.instanceMatrix.array
        if (Math.abs(matrix[offset + 14] + 4) < 1e-4) cross.push([matrix[offset + 12], matrix[offset + 13]])
      }
      return { hash, count: mesh.count, cross, opacity: mesh.material.uniforms.uOpacity.value }
    }
    const frames = [6, 10, 3, 10, 6].map(render)
    render(6.17)
    const beforeZ = Array.from({ length: window.__streamMesh.count }, (_, i) => window.__streamMesh.instanceMatrix.array[i * 16 + 14])
    render(6.18)
    const movingAway = beforeZ.every((z, i) => window.__streamMesh.instanceMatrix.array[i * 16 + 14] < z)
    stores.project.getState().setTrackParam('stream-smoke', 'tfOpacity', 0.25)
    const faded = render(6)
    stores.project.getState().setTrackParam('stream-smoke', 'tfOpacity', 1)
    const restored = render(6)
    stores.project.getState().setTrackParam('stream-smoke', 'count', 16)
    stores.project.getState().setTrackParam('stream-smoke', 'density', 48)
    const dense = render(10)
    stores.project.getState().setTrackParam('stream-smoke', 'count', 1)
    const one = render(10)
    const mesh = window.__streamMesh
    return { frames, movingAway, faded, restored, dense, one, capacity: mesh.instanceMatrix.count,
      programs: three.gl.info.programs.map(p => p.diagnostics?.runnable ?? true) }
  })
  result.worker = worker
  assert.equal(result.movingAway, true, 'fixed slots move into the distance')
  assert.ok(result.frames.every(frame => frame.count === 96), 'MIDI keeps exactly 16 dots on each of six streams')
  assert.equal(result.frames[0].cross.length, 6)
  assert.ok(result.frames[0].cross.every(([x, y]) => Math.hypot(x, y) < 1e-5))
  assert.equal(result.frames[1].cross.length, 6)
  assert.equal(new Set(result.frames[1].cross.map(([x, y]) => `${Math.round(x * 10000)},${Math.round(y * 10000)}`)).size, 3)
  assert.equal(result.frames[0].hash, result.frames[4].hash)
  assert.equal(result.frames[1].hash, result.frames[3].hash)
  assert.notEqual(result.frames[0].hash, result.frames[2].hash)
  assert.equal(result.faded.opacity, 0.25)
  assert.notEqual(result.faded.hash, result.restored.hash)
  assert.equal(result.restored.hash, result.frames[0].hash)
  assert.equal(result.dense.count, 16 * 48)
  assert.equal(result.one.count, 48)
  assert.equal(result.dense.count, result.one.count * 16)
  assert.ok(result.dense.count <= result.capacity)
  assert.ok(result.programs.every(Boolean))
  assert.deepEqual(errors, [])
  await mkdir('artifacts/particle-stream', { recursive: true })
  await page.evaluate(() => {
    const p = window.__cabinStores.project.getState()
    p.setTrackParam('stream-smoke', 'count', 6)
    p.setTrackParam('stream-smoke', 'density', 16)
    window.__cabinStores.time.getState().setCurrentBeat(7.75)
    window.__cabinVisual.getFrameDriver().prepareFrame(7.75)
    window.__cabinVisual.getFrameDriver().renderFrame(7.75, 3875)
  })
  await page.screenshot({ path: 'artifacts/particle-stream/editor.png' })
  await writeFile('artifacts/particle-stream/app-smoke.json', JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result, null, 2))
} finally { await browser.close() }
