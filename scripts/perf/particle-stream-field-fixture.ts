import { Color, Matrix4, PerspectiveCamera, Raycaster, Scene, Vector2, Vector3, WebGLRenderer, WebGLRenderTarget } from 'three'
import { createParticleFieldMesh } from '../../src/editor/instruments/particleFieldRenderer'
import { createParticleStreamSampler } from '../../src/editor/instruments/particleStreamFrame'
import { createParticlePool, disposeParticlePool } from '../../src/editor/instruments/particleCore'
import { STREAM_CAPACITY } from '../../src/editor/instruments/particleStreamCore'
import type { InstancedCopyFrame } from '../../src/editor/core/visual/instancedFrame'
import type { ObjectState } from '../../src/editor/core/visual/types'

const output = document.querySelector('pre')!
const button = document.querySelector('button')!
const errors: string[] = []
const originalError = console.error
console.error = (...args) => { errors.push(args.map(String).join(' ')); originalError(...args) }
button.onclick = async () => {
  button.disabled = true
  const renderer = new WebGLRenderer({ antialias: false })
  renderer.setSize(1280, 720)
  document.body.appendChild(renderer.domElement)
  const gl = renderer.getContext() as WebGL2RenderingContext
  const camera = new PerspectiveCamera(55, 1280 / 720, .1, 200)
  camera.position.set(0, 0, 35); camera.updateMatrixWorld()
  const target = new WebGLRenderTarget(384, 216)
  const sample = createParticleStreamSampler(), field = createParticleFieldMesh(STREAM_CAPACITY, renderer.capabilities.maxTextureSize)
  const scene = new Scene().add(field.mesh), reference = new Scene()
  const params = { count: 6, density: 16, speed: 1, twist: .35, spread: 4, meetX: 1.2, meetY: -.7, pattern: 1 }
  const state = { params, notes: [2.133, 2.163, 2.177, 4.241, 7.26].map((beat, i) => ({ beat, pitch: 60 + i, velocity: 100, durationBeats: .25, blockStartBeat: 0, blockEndBeat: 10 })), beat: 2.133, opacity: 1, blackedOut: false, secPerBeat: .5, beatsPerBar: 4, energy: 0, world: new Matrix4(), meshScale: 1, stringParams: {}, abilityEvents: new Map(), automations: [], baseParams: params, activeNotes: [] } satisfies ObjectState
  let copyCount = 8
  const frame: InstancedCopyFrame = {
    state, copies: Array.from({ length: copyCount }, () => ({ transform: new Matrix4(), opacity: 1, colorShift: { hue: 0, saturation: 0, lightness: 0, tint: null, tintAmount: 0 } })),
    composePlacement: out => out.identity(),
    composeCopyMatrix: (i, out) => out.makeRotationZ(i * .5 + state.beat * .03).scale(new Vector3(.7, .5, .6)).setPosition(Math.cos(i) * 3, Math.sin(i) * 3, -i * .3),
    copyFade: i => i === 2 ? 0 : .2 + i / copyCount * .3,
    copyColor: (i, _source, out) => out.setHSL(i / copyCount, .8, .5),
  }
  const refs = Array.from({ length: 8 }, () => {
    const pool = createParticlePool(STREAM_CAPACITY, true)
    pool.mesh.matrixAutoUpdate = false
    reference.add(pool.mesh)
    return pool
  })
  const read = (which: Scene) => {
    renderer.setRenderTarget(target); renderer.render(which, camera)
    const bytes = new Uint8Array(384 * 216 * 4)
    renderer.readRenderTargetPixels(target, 0, 0, 384, 216, bytes)
    return bytes
  }
  const parity = []
  const matrix = new Matrix4(), color = new Color()
  for (const beat of [0, 2.133, 7.26, -10, 2.133]) {
    state.beat = beat
    const local = sample(state)
    field.update(frame, local, '#ffffff', .15, .4)
    refs.forEach((pool, i) => {
      frame.composeCopyMatrix(i, pool.mesh.matrix)
      const fade = frame.copyFade(i)
      pool.mesh.visible = fade > .001; pool.mesh.material.uniforms.uOpacity.value = fade
      pool.mesh.material.uniforms.uGlow.value = .4
      frame.copyColor(i, '#ffffff', color)
      for (let j = 0; j < local.count; j++) {
        const p = j * 4
        matrix.makeScale(.15, .15, .15).setPosition(local.positions[p], local.positions[p + 1], local.positions[p + 2])
        pool.mesh.setMatrixAt(j, matrix)
        pool.colors.setXYZW(j, color.r, color.g, color.b, local.positions[p + 3])
      }
      pool.mesh.count = local.count; pool.mesh.instanceMatrix.needsUpdate = true; pool.colors.needsUpdate = true
    })
    const expected = read(reference), actual = read(scene)
    let max = 0, changed = 0, lit = 0, sum = 0
    for (let i = 0; i < actual.length; i++) {
      const delta = Math.abs(actual[i] - expected[i]); max = Math.max(max, delta); sum += delta
      if (delta > 2) changed++
      if (i % 4 !== 3 && expected[i] > 0) lit++
    }
    parity.push({ beat, maxChannelDifference: max, channelsOver2: changed, meanDifference: sum / actual.length, lit })
  }
  renderer.setRenderTarget(null)
  frame.copies = frame.copies.slice(0, 1)
  field.update(frame, sample(state), '#ffffff', .15, .4); renderer.render(scene, camera)
  const local = sample(state)
  let index = 0; while (local.positions[index * 4 + 3] < .9) index++
  const pos = new Vector3().fromArray(local.positions, index * 4).applyMatrix4(frame.composeCopyMatrix(0, matrix)).project(camera)
  const raycaster = new Raycaster(); raycaster.setFromCamera(new Vector2(pos.x, pos.y), camera)
  const hits: any[] = []; field.mesh.raycast(raycaster, hits)
  const benchmarks = []
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2')
  for (const n of [1366, 5462]) {
    copyCount = n; frame.copies = Array.from({ length: n }, () => ({ transform: new Matrix4(), opacity: 1, colorShift: { hue: 0, saturation: 0, lightness: 0, tint: null, tintAmount: 0 } }))
    state.params = { ...params, count: 16, density: 48 }
    const cpu: number[] = [], gpu: number[] = [], intervals: number[] = []
    const pending: WebGLQuery[] = []
    let previous = 0
    for (let i = 0; i < 150; i++) {
      await new Promise<void>(resolve => requestAnimationFrame(now => { if (i > 30 && previous) intervals.push(now - previous); previous = now; resolve() }))
      state.beat = 2 + i / 60
      const start = performance.now()
      field.update(frame, sample(state), '#ffffff', .007, .2)
      const q = ext && gl.createQuery()
      if (q) gl.beginQuery(ext.TIME_ELAPSED_EXT, q)
      renderer.render(scene, camera)
      if (q) { gl.endQuery(ext.TIME_ELAPSED_EXT); pending.push(q) }
      if (i > 30) cpu.push(performance.now() - start)
      while (pending.length && gl.getQueryParameter(pending[0], gl.QUERY_RESULT_AVAILABLE)) {
        const q = pending.shift()!
        if (!gl.getParameter(ext!.GPU_DISJOINT_EXT) && i > 30) gpu.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6)
        gl.deleteQuery(q)
      }
    }
    pending.forEach(q => gl.deleteQuery(q))
    const percentile = (values: number[], p: number) => values.sort((a, b) => a - b)[Math.floor(values.length * p)]
    benchmarks.push({ copies: n, particles: field.mesh.geometry.instanceCount, drawCalls: renderer.info.render.calls, cpuMedianMs: percentile(cpu, .5), cpuP95Ms: percentile(cpu, .95), gpuMedianMs: percentile(gpu, .5), gpuP95Ms: percentile(gpu, .95), callbackFps: 1000 / (intervals.reduce((a, b) => a + b, 0) / intervals.length), uploadBytes: field.copyTexture.image.data.byteLength + field.localTexture.image.data.byteLength })
    output.textContent = JSON.stringify({ parity, pickingHits: hits.length, benchmarks, errors }, null, 2)
  }
  const info = gl.getExtension('WEBGL_debug_renderer_info')
  const result = { parity, pickingHits: hits.length, benchmarks, renderer: info && gl.getParameter(info.UNMASKED_RENDERER_WEBGL), glError: gl.getError(), errors }
  output.textContent = JSON.stringify(result, null, 2)
  await fetch('/results', { method: 'POST', body: JSON.stringify(result, null, 2) })
  refs.forEach(disposeParticlePool); field.dispose(); target.dispose(); renderer.dispose(); button.disabled = false
}
