import { Color, InstancedBufferGeometry, Matrix4, PerspectiveCamera, Scene, Vector3, WebGLRenderer, WebGLRenderTarget } from 'three'
import { createParticlePlanMesh } from '../../src/editor/instruments/particlePlanRenderer'
import { createParticlePool, disposeParticlePool } from '../../src/editor/instruments/particleCore'
import { compileParticlePlan, matrixScaleBound } from '../../src/editor/core/visualCopies/particlePlan'
import { resolveVisualCopies } from '../../src/editor/core/visualCopies/resolveVisualCopies'
import type { MoverOrSplitter } from '../../src/editor/core/visualCopies/types'
import { applyColorShiftToColor } from '../../src/editor/core/visual/colorShift'

import { COLOR_IDS, colorEntry as entry, colorFrameCases as makeCases, colorNote as note, radialPopulation, largeGradientPath } from './particle-color-program-fixtures'
const spatialIds = COLOR_IDS
const identity = new Matrix4(), scaled = new Matrix4().makeScale(.7, 1.4, 2.2).setPosition(.2, -.1, .3)
const rgbColor = '#bc734d'

function difference(expected: Uint8Array, actual: Uint8Array, previous?: Uint8Array) {
  let maximum = 0, sum = 0, over4 = 0, expectedIntensity = 0, actualIntensity = 0, lit = 0, seekDifference = 0
  for (let i = 0; i < expected.length; i++) {
    if (i % 4 === 3) continue
    const delta = Math.abs(expected[i] - actual[i]); maximum = Math.max(maximum, delta); sum += delta
    if (delta > 4) over4++
    expectedIntensity += expected[i]; actualIntensity += actual[i]
    if (expected[i]) lit++
    if (previous) seekDifference = Math.max(seekDifference, Math.abs(previous[i] - actual[i]))
  }
  const channels = expected.length / 4 * 3, mean = sum / channels
  const relativeIntensityDifference = Math.abs(expectedIntensity - actualIntensity) / Math.max(1, expectedIntensity)
  return { maximum, mean, channelsOver4: over4, lit, expectedIntensity, actualIntensity, relativeIntensityDifference, seekDifference,
    pass: mean < .1 && over4 / channels < .001 && relativeIntensityDifference < .01 && seekDifference === 0
      && (expectedIntensity > 0 || actualIntensity === 0) }
}

function summary(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  const at = (fraction: number) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] : null
  return { samples: sorted.length, medianMs: at(.5), p95Ms: at(.95), maxMs: at(1) }
}
function performanceCases(): { name: string; count: number; chain: MoverOrSplitter[]; requiresMeasured?: string }[] {
  const notes = Array.from({ length: 32 }, (_, i) => note(i * .5, i % 4 === 0 ? 61 : 60, .8, 1.5))
  return [
    { name: '32k-cosine-after-splitters', count: 32 ** 3, chain: [...radialPopulation(3), entry('cosinePalette', { mode: 0, span: 4.7 }, notes)] },
    ...COLOR_IDS.map(id => ({ name: `million-${id}-after-splitters`, count: 32 ** 4,
      chain: [...radialPopulation(4), entry(id, { mode: id === 'gradient' ? 0 : 3, continuous: 1 }, notes)] })),
    { name: 'million-fluid-and-cosine', count: 32 ** 4,
      chain: [...radialPopulation(4), entry('fluidImpact', {}, notes), entry('cosinePalette', { mode: 0, span: 4.7 }, notes)] },
    { name: 'million-cosine-plus-hue', count: 32 ** 4,
      chain: [...radialPopulation(4), entry('cosinePalette', { mode: 3 }, notes), entry('hueRotate', { continuous: 1, spread: 1.5, saturation: .1 })] },
    { name: '32k-maximum-curve', count: 32 ** 3,
      chain: [...radialPopulation(3), entry('gradient', { mode: 4 }, [], { path: largeGradientPath() })] },
    { name: 'million-maximum-curve', count: 32 ** 4, requiresMeasured: '32k-maximum-curve',
      chain: [...radialPopulation(4), entry('gradient', { mode: 4 }, [], { path: largeGradientPath() })] },
  ]
}

const button = document.querySelector('button')!, output = document.querySelector('pre')!
button.onclick = async () => {
  button.disabled = true
  const errors: string[] = [], originalError = console.error
  console.error = (...args) => { errors.push(args.map(String).join(' ')); originalError(...args) }
  const cleanups: (() => void)[] = []
  const result: Record<string, unknown> = { timestamp: new Date().toISOString(), initialVisibility: document.visibilityState, errors, pass: false }
  try {
    const renderer = new WebGLRenderer({ antialias: false }); cleanups.push(() => renderer.dispose())
    renderer.setPixelRatio(1); renderer.setSize(1024, 576); renderer.setClearColor(0x000000, 1)
    document.body.appendChild(renderer.domElement)
    const gl = renderer.getContext() as WebGL2RenderingContext, info = gl.getExtension('WEBGL_debug_renderer_info')
    result.environment = { renderer: info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), userAgent: navigator.userAgent }
    const camera = new PerspectiveCamera(50, 16 / 9, .5, 250); camera.position.set(0, 0, 14); camera.updateMatrixWorld()
    const target = new WebGLRenderTarget(512, 288); cleanups.push(() => target.dispose())
    const reference = createParticlePool(8192); cleanups.push(() => disposeParticlePool(reference))
    const plain = compileParticlePlan([entry('radial', { copies: 3 })])!
    const compact = createParticlePlanMesh(plain, false); cleanups.push(() => compact.dispose())
    const referenceScene = new Scene().add(reference.mesh), compactScene = new Scene().add(compact.mesh)
    const matrix = new Matrix4(), scalar = new Vector3(), color = new Color(), tint = new Color()
    const read = (scene: Scene) => {
      renderer.setRenderTarget(target); renderer.render(scene, camera)
      const bytes = new Uint8Array(512 * 288 * 4)
      renderer.readRenderTargetPixels(target, 0, 0, 512, 288, bytes)
      return bytes
    }
    result.inventory = spatialIds.map(id => {
      const chain = [entry(id)], plan = compileParticlePlan(chain, 1, .7, scaled)
      const reference = resolveVisualCopies(chain, .7, scaled)
      if (!plan || plan.count !== reference.length) throw new Error(`${id}: default operation plan mismatch`)
      return { id, count: plan.count, shared: true, appearance: !!plan.appearanceOffsets, program: !!plan.program }
    })
    const probeLayout = entry('grid', { rows: 5, columns: 7, depth: 3, spacing: .73 })
    const colored = resolveVisualCopies([probeLayout, entry('cosinePalette', { mode: 0, span: 3.7 })], .7)
    const uniqueTints = new Set(colored.map(copy => copy.colorShift.tint)).size
    result.colorCoverage = { copies: colored.length, uniqueTints, pass: uniqueTints > 3 }
    const frames: Record<string, unknown>[] = [], saved = new Map<string, Uint8Array>()
    result.frames = frames
    for (const [index, frame] of makeCases().entries()) {
      output.textContent = `Comparing ${frame.name}…`
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
      const plan = compileParticlePlan(frame.chain, index + 1, frame.beat, frame.placement)
      if (!plan) throw new Error(`${frame.name}: missing compact plan`)
      const copies = resolveVisualCopies(frame.chain, frame.beat, frame.placement)
      if (copies.length > reference.capacity) throw new Error('Reference capacity exceeded')
      let live = 0
      for (const copy of copies) {
        const fade = Math.min(1, frame.objectOpacity * copy.opacity)
        if (fade <= .001) continue
        matrix.copy(frame.placement).multiply(copy.transform).scale(scalar.setScalar(frame.size))
        reference.mesh.setMatrixAt(live, matrix)
        applyColorShiftToColor(color.set(frame.color), copy.colorShift, tint)
        reference.colors.setXYZW(live++, color.r, color.g, color.b, fade)
      }
      reference.mesh.count = live; reference.mesh.instanceMatrix.needsUpdate = true; reference.colors.needsUpdate = true
      reference.mesh.material.uniforms.uGlow.value = frame.glow
      compact.update(plan)
      const uniforms = compact.mesh.material.uniforms
      uniforms.uPlacement.value.copy(frame.placement); uniforms.uMeshScale.value = frame.size
      uniforms.uColor.value.set(frame.color); uniforms.uOpacity.value = frame.objectOpacity
      uniforms.uGlow.value = frame.glow; uniforms.uMinRadiusNdc.value = 0
      const expected = read(referenceScene), actual = read(compactScene)
      const pixels = difference(expected, actual, frame.repeat ? saved.get(frame.repeat) : undefined)
      if (frame.repeat && !saved.has(frame.repeat)) throw new Error('Missing seek reference')
      saved.set(frame.name, actual)
      const glError = gl.getError()
      frames.push({ name: frame.name, beat: frame.beat, objectOpacity: frame.objectOpacity, count: plan.count, referenceDrawnCopies: live,
        compactDrawnCopies: (compact.mesh.geometry as InstancedBufferGeometry).instanceCount,
        appearanceOffsets: plan.appearanceOffsets ?? [], program: !!plan.program, cpuPrefix: plan.cpuPrefix ? { count: plan.cpuPrefix.count, colorOffset: plan.cpuPrefix.colorOffset } : null, operationKinds: plan.program?.operationKinds ?? [],
        texture: [compact.texture.image.width, compact.texture.image.height], ...pixels, glError, pass: pixels.pass && glError === 0 })
    }
    const benchmarks: Record<string, unknown>[] = []
    result.benchmarks = benchmarks
    const measurementsRequested = (document.querySelector('#measure') as HTMLInputElement).checked
    const imagesValid = frames.every(frame => frame.pass) && errors.length === 0
    if (measurementsRequested && !imagesValid) result.benchmarkSkippedReason =
      'Image validation failed or shader errors were reported; no performance samples were collected.'
    if (measurementsRequested && imagesValid) {
      renderer.setRenderTarget(null)
      const extension = gl.getExtension('EXT_disjoint_timer_query_webgl2')
      const maxPointSize = (gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE) as Float32Array)[1]
      result.gpuTimerSupported = !!extension
      for (const benchmark of performanceCases()) {
        if (benchmark.requiresMeasured) {
          const previous = benchmarks.find(result => result.name === benchmark.requiresMeasured)
          const milliseconds = (previous?.gpu as ReturnType<typeof summary> | undefined)?.medianMs
          const estimate = milliseconds == null ? null : milliseconds * benchmark.count / (previous!.count as number)
          if (estimate === null || estimate > 16.67) {
            benchmarks.push({ name: benchmark.name, count: benchmark.count, skipped: true, pass: true,
              estimatedGpuMs: estimate, reason: 'The measured 32K curve does not predict a 60 FPS million-copy budget; no large draw was submitted.' })
            continue
          }
        }
        const initial = compileParticlePlan(benchmark.chain, 0, 6, identity)!
        if (!initial || initial.count !== benchmark.count) throw new Error(`${benchmark.name}: unexpected plan count`)
        const size = .007
        const sizeBound = initial.scaleBound * matrixScaleBound(identity) * size * camera.projectionMatrix.elements[5] * 576 / camera.near
        const points = sizeBound <= maxPointSize, pool = createParticlePlanMesh(initial, points)
        const scene = new Scene().add(pool.mesh), uniforms = pool.mesh.material.uniforms
        uniforms.uPlacement.value.identity(); uniforms.uMeshScale.value = size; uniforms.uColor.value.set(rgbColor)
        uniforms.uOpacity.value = 1; uniforms.uGlow.value = .2; uniforms.uMinRadiusNdc.value = 0
        const cpu: number[] = [], gpu: number[] = [], intervals: number[] = []
        const pending: { query: WebGLQuery; collect: boolean }[] = []
        let previous = 0, disjointResults = 0
        const drain = () => {
          while (pending.length && gl.getQueryParameter(pending[0].query, gl.QUERY_RESULT_AVAILABLE)) {
            const { query, collect } = pending.shift()!
            if (gl.getParameter(extension!.GPU_DISJOINT_EXT)) disjointResults++
            else if (collect) gpu.push(gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6)
            gl.deleteQuery(query)
          }
        }
        for (let frame = 0; frame < 180; frame++) {
          if (frame % 30 === 0) output.textContent = `Timing ${benchmark.name}: ${benchmark.count.toLocaleString()} particles, frame ${frame}/180…`
          const now = await new Promise<number>(resolve => requestAnimationFrame(resolve))
          if (frame >= 30 && previous) intervals.push(now - previous)
          previous = now
          const start = performance.now()
          pool.update(compileParticlePlan(benchmark.chain, frame + 1, 6 + frame / 30, identity)!)
          const query = extension && gl.createQuery()
          if (query) gl.beginQuery(extension.TIME_ELAPSED_EXT, query)
          renderer.render(scene, camera)
          if (query) { gl.endQuery(extension.TIME_ELAPSED_EXT); pending.push({ query, collect: frame >= 30 }) }
          if (frame >= 30) cpu.push(performance.now() - start)
          drain()
        }
        for (let wait = 0; pending.length && wait < 20; wait++) { await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); drain() }
        const undeliveredQueries = pending.length
        pending.forEach(({ query }) => gl.deleteQuery(query))
        const drawn = pool.mesh.geometry instanceof InstancedBufferGeometry ? pool.mesh.geometry.instanceCount : pool.mesh.geometry.drawRange.count
        const glError = gl.getError()
        benchmarks.push({ name: benchmark.name, count: initial.count, primitive: points ? 'points' : 'quads', sizeBound, maxPointSize,
          uploadBytes: pool.texture.image.data.byteLength, program: !!initial.program, appearance: !!initial.appearanceOffsets,
          cpuUpdateAndRender: summary(cpu), gpu: summary(gpu), callbacks: summary(intervals),
          callbackFps: 1000 / (intervals.reduce((sum, value) => sum + value, 0) / intervals.length),
          drawn, drawCalls: renderer.info.render.calls, disjointResults, undeliveredQueries, glError,
          pass: drawn === initial.count && renderer.info.render.calls === 1 && glError === 0 })
        pool.dispose()
      }
    }
    result.finalVisibility = document.visibilityState
    result.glError = gl.getError()
    result.pass = (result.colorCoverage as { pass: boolean }).pass && frames.every(frame => frame.pass) && benchmarks.every(benchmark => benchmark.pass) && result.glError === 0 && errors.length === 0
  } catch (error) { result.fatalError = error instanceof Error ? error.stack : String(error) }
  finally {
    cleanups.reverse().forEach(cleanup => cleanup()); console.error = originalError
    output.textContent = JSON.stringify(result, null, 2)
    try { const response = await fetch('/results', { method: 'POST', body: JSON.stringify(result, null, 2) }); if (!response.ok) throw new Error(`Save failed: ${response.status}`) }
    catch (error) { output.textContent += '\n' + String(error) }
    button.disabled = false
  }
}
