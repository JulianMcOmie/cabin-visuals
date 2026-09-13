// Real export-driver probe. Keep Chrome on the native GPU; SwiftShader timings
// do not represent the particle workloads this measures.
// Start a dev server, then node scripts/perf/export-render-probe.mjs.
// --base URL --counts 32,32x4 --samples 60 --effect none|baseline|disabled-glow
// --output artifacts/export-performance/render-profile.json
// Counts are radial copies^depth; copies must be <=32. Baseline uses an unknown
// enabled visual no-op to reproduce the former per-copy renderer without
// reverting source. Results include encode flush, but not mounts/audio/muxing.
//   node scripts/perf/export-render-probe.mjs --counts 32,32x4
//   node scripts/perf/export-render-probe.mjs --counts 32 --effect baseline --samples 30 --output artifacts/export-performance/effect-baseline.json
//   node scripts/perf/export-render-probe.mjs --counts 32 --effect disabled-glow --samples 30 --output artifacts/export-performance/effect-optimized.json
// Radial copy counts cap at 32: 32x4 means four stages (1,048,576 particles).
// Baseline's unknown enabled effect is a visual no-op which forces the former
// per-copy renderer, without reverting application source in the shared tree.
// Timed encode phases include render, capture, queue backpressure and flush;
// they exclude initial mounts, audio, watermark and MP4 muxing. Readback phases
// use a single pixel as a GPU fence because Chrome's gl.finish is asynchronous.
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'

const args = process.argv.slice(2)
const option = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback
const base = option('--base', process.env.BASE ?? 'http://127.0.0.1:3068')
const samples = Number(option('--samples', process.env.SAMPLES ?? 60))
const counts = option('--counts', process.env.COUNTS ?? '32,32x4').split(',').map(value => { const [copies, depth = 3] = value.split('x').map(Number); return { copies, depth } })
const effect = option('--effect', process.env.EFFECT ?? 'none')
const output = option('--output', process.env.OUTPUT ?? 'artifacts/export-performance/render-profile.json')
if (!Number.isInteger(samples) || samples < 1 || !counts.every(({ copies, depth }) =>
  Number.isInteger(copies) && copies >= 1 && copies <= 32 && Number.isInteger(depth) && depth >= 1 && depth <= 16)) {
  throw new Error('Use positive sample counts and 1–32 radial copies across 1–16 stages')
}
if (!['none', 'baseline', 'disabled-glow'].includes(effect)) throw new Error('Unknown effect fixture')
const browser = await chromium.launch({ headless: false, args: ['--use-angle=metal', '--autoplay-policy=no-user-gesture-required'] })
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
const errors = []
page.on('pageerror', e => errors.push(String(e)))
await page.route(/supabase\.co\/(rest|auth)/, r => r.abort())
try {
  await page.goto(`${base}/editor`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => window.__cabinVisual?.getFrameDriver() && window.__r3fState, null, { timeout: 120000 })
  const fixtures = []
  for (const { copies, depth } of counts) {
    if (fixtures.length) {
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.waitForFunction(() => window.__cabinVisual?.getFrameDriver() && window.__r3fState, null, { timeout: 120000 })
    }
    await page.evaluate(({ copies, depth, effect }) => {
      const { project, ui, time } = window.__cabinStores
      const p = project.getState()
      const sceneId = p.sceneOrder.find(id => !p.scenes[id].isMain)
      const mainId = p.sceneOrder.find(id => p.scenes[id].isMain)
      const track = (id, fields) => ({ id, name: id, type: 'base', instrumentId: '', color: '#7dd3fc', childIds: [], muted: false, solo: false, blocks: [], ...fields })
      const childIds = Array.from({ length: depth }, (_, i) => 'r' + i)
      childIds.splice(1, 0, 'move')
      const effects = effect === 'baseline' ? [{ id: 'bench', pluginId: '__reference__', enabled: true, settings: {} }] : effect === 'disabled-glow' ? [{ id: 'bench', pluginId: 'glow', enabled: false, settings: {} }] : []
      const tracks = { particle: track('particle', { instrumentId: 'particle', childIds, params: { size: .007 }, effects }) }
      for (let i = 0; i < depth; i++) tracks['r' + i] = track('r' + i, { parentId: 'particle', type: 'splitter', splitterId: 'radial', inputValues: { copies, radius: [4, 1.2, .25, .08][i], plane: i % 3, size: 1 } })
      tracks.move = track('move', { parentId: 'particle', type: 'mover', moverId: 'mover', inputValues: { motion: 1, mode: 1, drive: 0, angleX: 17, angleY: 29, angleZ: 45, angle: 1, pivotX: .3, pivotY: -.2, pivotZ: .1 } })
      const scene = { ...p.scenes[sceneId], tracks, rootTrackIds: ['particle'], backgroundColor: '#000000' }
      project.setState({ activeSceneId: sceneId, scenes: { [sceneId]: scene, [mainId]: p.scenes[mainId] }, tracks, rootTrackIds: ['particle'] })
      ui.getState().setCanvasView('scene')
      time.setState({ currentBeat: 2, isPlaying: false })
    }, { copies, depth, effect })
    await page.waitForTimeout(1500)
    const result = await page.evaluate(async ({ copies, depth, effect, samples }) => {
      const driver = window.__cabinVisual.getFrameDriver()
      driver.pin(1920, 1080)
      await driver.prepare(2)
      const state = window.__r3fState()
      const gl = state.gl.getContext()
      const debug = gl.getExtension('WEBGL_debug_renderer_info')
      const gpu = { vendor: debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : null, renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : null, version: gl.getParameter(gl.VERSION), maxPointSize: [...gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE)], antialias: gl.getContextAttributes().antialias }
      const task = () => new Promise(resolve => { const ch = new MessageChannel(); ch.port1.onmessage = () => { ch.port1.close(); ch.port2.close(); resolve() }; ch.port2.postMessage(null) })
      const stats = a => { const ordered = [...a].sort((a, b) => a - b); return { mean: a.reduce((a, b) => a + b, 0) / a.length, p50: ordered[Math.floor(a.length * .5)], p95: ordered[Math.floor(a.length * .95)] } }
      const callbacks = state.internal.subscribers.map((sub, index) => { const orig = sub.ref.current; const r = { index, priority: sub.priority, source: orig.toString().slice(0, 450), ms: 0, calls: 0 }; sub.ref.current = (...a) => { const t = performance.now(); const v = orig(...a); r.ms += performance.now() - t; r.calls++; return v }; return { sub, orig, r } })
      const origRender = state.gl.render
      const renderCalls = []
      state.gl.render = function(scene, camera) { const t = performance.now(); const priorDraws = state.gl.info.render.calls; const value = origRender.call(this, scene, camera); renderCalls.push({ ms: performance.now() - t, children: scene.children.length, scene: scene.uuid, draws: state.gl.info.render.calls - priorDraws }); return value }
      const phases = []
      try {
        const pixel = new Uint8Array(4)
        const fence = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel)
        for (let i = 0; i < 12; i++) { driver.renderFrame(2 + i / 30, i * 1000 / 60); gl.finish() }
        const meshes = []
        for (const scene of window.__cabinVisual.getMountedRenderScenes().values()) scene.traverse(o => { if (o.name.includes('Particle')) meshes.push({ name: o.name, particles: o.isPoints ? o.geometry.drawRange.count : o.geometry?.instanceCount, points: !!o.isPoints, geometry: o.geometry?.type, material: o.material?.name, matrixSlots: o.material?.uniforms.uLayouts?.value.image.data.length / 16 }) })
        if (effect !== 'baseline' && meshes.some(m => m.particles !== copies ** depth)) throw new Error(`Fixture mesh count mismatch: ${JSON.stringify(meshes)}`)
        if (effect === 'baseline' && meshes.length !== copies ** depth) throw new Error(`Baseline should mount ${copies ** depth} particles, got ${meshes.length}`)
        const pixelSamples = []
        for (const beat of [2, 3, 2]) {
          driver.renderFrame(beat, beat * 500)
          const pixels = new Uint8Array(1920 * 1080 * 4)
          gl.readPixels(0, 0, 1920, 1080, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
          let hash = 0, lit = 0
          for (let i = 0; i < pixels.length; i += 4) { hash = ((hash << 5) - hash + pixels[i] + pixels[i + 1] * 17 + pixels[i + 2] * 31) | 0; if (pixels[i] + pixels[i + 1] + pixels[i + 2] > 20) lit++ }
          pixelSamples.push({ beat, hash, lit, png: driver.getCanvas().toDataURL('image/png') })
        }
        if (!pixelSamples[0].lit || pixelSamples[0].hash === pixelSamples[1].hash || pixelSamples[0].hash !== pixelSamples[2].hash) throw new Error('Fixture must draw, animate, and reconstruct the same frame when seeking back')
        for (const mode of ['render-readback', 'capture-readback', 'encode-software', 'encode-hardware']) {
          const render = [], capture = [], finish = [], submit = [], wait = []
          let bytes = 0, chunks = 0, encoder
          if (mode.startsWith('encode')) {
            encoder = new VideoEncoder({ output: c => { chunks++; bytes += c.byteLength }, error: e => { throw e } })
            encoder.configure({ codec: 'avc1.64002a', width: 1920, height: 1080, bitrate: 20000000, framerate: 60, hardwareAcceleration: mode.endsWith('hardware') ? 'prefer-hardware' : 'prefer-software', latencyMode: 'quality', avc: { format: 'avc' } })
          }
          for (const c of callbacks) { c.r.ms = 0; c.r.calls = 0 }
          renderCalls.length = 0
          const start = performance.now()
          for (let i = 0; i < samples; i++) {
            let t = performance.now(); driver.renderFrame(2 + i / 30, i * 1000 / 60); render.push(performance.now() - t)
            if (mode !== 'render-readback') {
              t = performance.now(); const frame = new VideoFrame(driver.getCanvas(), { timestamp: Math.round(i * 1e6 / 60), duration: Math.round(1e6 / 60) }); capture.push(performance.now() - t)
              if (encoder) { t = performance.now(); encoder.encode(frame, { keyFrame: i % 120 === 0 }); submit.push(performance.now() - t) }
              frame.close()
            }
            if (encoder) {
              const t = performance.now()
              while (encoder.encodeQueueSize > 8) await new Promise(resolve => encoder.addEventListener('dequeue', resolve, { once: true }))
              wait.push(performance.now() - t)
            } else { const t = performance.now(); fence(); finish.push(performance.now() - t) }
            if (i % 60 === 0) await task()
          }
          const flushStart = performance.now()
          if (encoder) {
            await encoder.flush(); encoder.close()
            if (chunks !== samples) throw new Error(`Expected ${samples} encoded frames, received ${chunks}`)
          }
          const wallMs = performance.now() - start
          phases.push({ mode, wallMs, fps: samples / wallMs * 1000, render: stats(render), capture: capture.length ? stats(capture) : null, finish: finish.length ? stats(finish) : null, submit: submit.length ? stats(submit) : null, backpressure: wait.length ? stats(wait) : null, flushMs: performance.now() - flushStart, callbacks: callbacks.map(c => ({ ...c.r, msPerFrame: c.r.ms / samples })), rendererCallsPerFrame: renderCalls.length / samples, drawCallsPerFrame: renderCalls.reduce((sum, c) => sum + c.draws, 0) / samples, rendererMsPerFrame: renderCalls.reduce((sum, c) => sum + c.ms, 0) / samples, bytes, chunks })
        }
        return { copies, depth, effect, particles: copies ** depth, gpu, samples, canvas: [driver.getCanvas().width, driver.getCanvas().height], meshCount: meshes.length, meshes: meshes.slice(0, 8), pixelSamples, phases }
      } finally {
        callbacks.forEach(({ sub, orig }) => sub.ref.current = orig)
        state.gl.render = origRender
        driver.unpin()
      }
    }, { copies, depth, effect, samples })
    for (let index = 0; index < result.pixelSamples.length; index++) {
      const sample = result.pixelSamples[index]
      await mkdir('artifacts/export-performance', { recursive: true })
      sample.image = `artifacts/export-performance/${copies ** depth}-${effect}-frame-${index}.png`
      await writeFile(sample.image, Buffer.from(sample.png.split(',')[1], 'base64'))
      delete sample.png
    }
    fixtures.push(result)
    console.log(JSON.stringify({ particles: result.particles, effect, gpu: result.gpu.renderer, pixelSamples: result.pixelSamples, meshCount: result.meshCount, meshes: result.meshes, phases: result.phases.map(({ mode, fps, render, capture, finish, drawCallsPerFrame }) => ({ mode, fps, render, capture, finish, drawCallsPerFrame })) }))
    await mkdir('artifacts/export-performance', { recursive: true })
    await writeFile(output, JSON.stringify({ fixtures, errors }, null, 2))
  }
  await mkdir('artifacts/export-performance', { recursive: true })
  await writeFile(output, JSON.stringify({ fixtures, errors }, null, 2))
} finally { await browser.close() }
