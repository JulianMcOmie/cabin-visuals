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
        notes: [60, 61, 62, 63, 64].map((pitch, i) => ({ id: `route-${pitch}`, pitch, startBeat: 4.13 + i * 0.04, durationBeats: 0.02, velocity: 100 })) }],
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
    const frames = [4.13, 4.17, 3, 4.17, 4.13].map(render)
    const positions = () => Array.from({ length: window.__streamMesh.count }, (_, i) =>
      Array.from(window.__streamMesh.instanceMatrix.array.slice(i * 16 + 12, i * 16 + 15)))
    const hits = [4.13, 4.17, 4.21, 4.25, 4.29].map(beat => {
      render(beat - 0.0001)
      const before = positions()
      const frame = render(beat)
      const exact = positions()
      render(beat + 0.0001)
      return { frame, before, exact, after: positions() }
    })
    render(4.12)
    const sequenced = positions()
    const notes = stores.project.getState().tracks['stream-smoke'].blocks[0].notes
    stores.project.getState().updateBlockNotes('stream-smoke', 'stream-block', [])
    render(4.12)
    const withoutScore = positions()
    stores.project.getState().updateBlockNotes('stream-smoke', 'stream-block', notes)
    render(4.12)
    const sequencedAgain = positions()
    render(6.17)
    const beforeZ = positions().map(p => p[2])
    render(6.18)
    const movingAway = beforeZ.every((z, i) => {
      const next = window.__streamMesh.instanceMatrix.array[i * 16 + 14]
      return next < z || (z < -22 && next > 14)
    })
    stores.project.getState().setTrackParam('stream-smoke', 'tfOpacity', 0.25)
    const faded = render(4.13)
    stores.project.getState().setTrackParam('stream-smoke', 'tfOpacity', 1)
    const restored = render(4.13)
    stores.project.getState().setTrackParam('stream-smoke', 'count', 16)
    stores.project.getState().setTrackParam('stream-smoke', 'density', 48)
    const dense = render(10)
    stores.project.getState().setTrackParam('stream-smoke', 'count', 1)
    const one = render(10)
    const mesh = window.__streamMesh
    return { frames, hits, sequenced, withoutScore, sequencedAgain, movingAway, faded, restored, dense, one, capacity: mesh.instanceMatrix.count,
      programs: three.gl.info.programs.map(p => p.diagnostics?.runnable ?? true) }
  })
  result.worker = worker
  for (let hit = 0; hit < result.hits.length; hit++) {
    const { frame, before, exact, after } = result.hits[hit]
    assert.equal(frame.count, 96, 'closely spaced MIDI notes never add particles')
    assert.equal(frame.cross.length, 6, 'every off-grid MIDI beat has six visible arrivals')
    const arrivals = exact.flatMap((p, i) => Math.abs(p[2] + 4) < 1e-4 ? [i] : [])
    for (const i of arrivals) {
      assert.ok(before[i][2] > -4, 'the same particle approaches before the MIDI beat')
      assert.ok(after[i][2] < -4, 'the same particle passes through after the MIDI beat')
    }
    if (hit === 2 || hit === 3) {
      const x = hit === 2 ? -2.2 : 2.2
      assert.ok(frame.cross.every(([px, py]) => Math.hypot(px - x, py) < 1e-4))
    }
    if (hit === 4) assert.ok(frame.cross.every(([x, y]) => Math.abs(Math.hypot(x, y) - 4) < 1e-4))
  }
  assert.notDeepEqual(result.sequenced, result.withoutScore, 'future notes shape the approach before the first note plays')
  assert.deepEqual(result.sequencedAgain, result.sequenced, 'editing and restoring the score reproduces its choreography')
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
