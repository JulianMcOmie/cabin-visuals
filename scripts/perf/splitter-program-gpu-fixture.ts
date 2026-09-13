import { Color, InstancedBufferGeometry, Matrix4, PerspectiveCamera, Scene, Vector3, WebGLRenderer, WebGLRenderTarget } from 'three'
import { createParticlePlanMesh } from '../../src/editor/instruments/particlePlanRenderer'
import { createParticlePool, disposeParticlePool } from '../../src/editor/instruments/particleCore'
import { compileParticlePlan, matrixScaleBound } from '../../src/editor/core/visualCopies/particlePlan'
import { resolveVisualCopies } from '../../src/editor/core/visualCopies/resolveVisualCopies'
import { getMoverOrSplitterDefinition } from '../../src/editor/core/visualCopies/registry'
import { mergeDefinitionSettings } from '../../src/editor/core/visualCopies/definitions'
import { sharedLocalLayout } from '../../src/editor/core/visualCopies/sharedLocalLayout'
import { splitterWithChildChain } from '../../src/editor/core/visualCopies/splitterChildChain'
import { applyColorShiftToColor } from '../../src/editor/core/visual/colorShift'
import type { MoverOrSplitter } from '../../src/editor/core/visualCopies/types'
import type { ResolvedNote } from '../../src/editor/core/visual/types'

const spatialIds = ['radial', 'line', 'grid', 'symmetry', 'fractal', 'wallpaper', 'scatter',
  'polyhedron', 'parametricPattern', 'tunnel', 'duplicateTrail', 'approach']
const note = (beat: number, pitch: number, durationBeats = 2): ResolvedNote => ({ beat, pitch, durationBeats, velocity: 100, blockStartBeat: 0, blockEndBeat: 32 })
function entry(id: string, settings: Record<string, number> = {}, notes: ResolvedNote[] = []): MoverOrSplitter {
  const definition = getMoverOrSplitterDefinition(id)!
  return definition.resolve({ settings: mergeDefinitionSettings(definition, settings), notes })
}
const identity = new Matrix4(), scaled = new Matrix4().makeScale(.7, 1.4, 2.2).setPosition(.2, -.1, .3)
const rgbColor = '#bc734d'
interface FrameCase {
  name: string; chain: MoverOrSplitter[]; beat: number; placement: Matrix4
  objectOpacity: number; size: number; glow: number; color: string; repeat?: string
}
function makeCases(): FrameCase[] {
  const slots = (opacities: number[], hues: number[]) => sharedLocalLayout({
    transforms: opacities.map((_, index) => new Matrix4().makeTranslation((index % 4 - 1.5) * 1.8, (Math.floor(index / 4) - 1) * 1.8, 0)),
    opacities, hueShifts: hues,
  })
  const cutoff = slots([0, .0003, .0004], [0, .2, -.2])
  const visible = slots([0, .0003, .0004, .0005, .05, .2, .4, .6, .8, 1], [0, .2, -.2, .37, 1.3, -.7, .15, .45, .65, .8])
  const trail = entry('duplicateTrail', { speed: 4, density: 3, rainbow: 1, size: 1.6 }, [note(0, 60, 8)])
  const trailB = entry('duplicateTrail', { speed: 8, density: 2, rainbow: 1, size: 1.2 }, [note(0, 60, 8)])
  const radial = entry('radial', { copies: 6, radius: 2, plane: 0 })
  const polyhedron = entry('polyhedron', { shape: 3, radius: 3 }, [note(1, 127, 2), note(1.5, 124, 1)])
  const tunnel = entry('tunnel', { copiesPerRing: 4, rings: 6, radius: 2, depth: 16, nearEnd: 3, fadeDistance: 2, speed: 2 }, [note(1, 72, 1)])
  const approach = entry('approach', { density: 8, spawnMode: 2, startX: -3, startZ: -6, targetX: 3, targetY: 1,
    targetZ: 1, flightBeats: 4, afterBeats: 2, arrival: 1, bend: 1.3 }, [note(4, 60), note(6, 60)])
  const nestedPrefix = sharedLocalLayout({ transforms: [new Matrix4().makeTranslation(-3, 0, 0),
    new Matrix4().makeScale(1e-13, 1, 1), new Matrix4().makeTranslation(3, 0, 0)], opacities: [1, .7, 1], hueShifts: [0, .1, .2] })
  const appearanceChild = sharedLocalLayout({ transforms: [new Matrix4().makeRotationZ(.7)], opacities: [.4], hueShifts: [.35] })
  const nestedAppearance = [nestedPrefix, splitterWithChildChain(entry('radial', { copies: 4, radius: 1.1, plane: 2 }), [appearanceChild])]
  const countFractal = entry('fractal', { branches: 3, depth: 3, spread: 1.8 }, [note(1, 36), note(3, 39)])
  const make = (name: string, chain: MoverOrSplitter[], beat: number, changes: Partial<FrameCase> = {}): FrameCase => ({
    name, chain, beat, placement: identity, objectOpacity: .65, size: .16, glow: .2, color: rgbColor, ...changes,
  })
  return [
    make('all-under-cutoff', [cutoff], 1.75, { objectOpacity: 2.5, glow: 10, size: .3 }),
    make('opacity-above-one-and-hue', [visible], 1.75, { objectOpacity: 2.5, glow: 2, size: .25 }),
    make('plain-layout-after-appearance', [entry('grid', { rows: 3, columns: 3, depth: 1, spacing: 1.4 })], 1.75),
    make('rainbow-trail', [radial, trail], 3.25, { size: .075 }),
    make('rainbow-sum', [entry('radial', { copies: 3, radius: 2 }), trail, trailB], 3.25, { size: .055 }),
    make('polyhedron-muted-slots', [polyhedron], 1.75),
    make('polyhedron-released-slots', [polyhedron], 4),
    make('nested-appearance-mixed-guard', nestedAppearance, 1.75, { size: .22 }),
    make('tunnel-before-placement', [tunnel], 1.75),
    make('tunnel-scaled-same-beat', [tunnel], 1.75, { placement: scaled }),
    make('tunnel-placement-restored', [tunnel], 1.75, { repeat: 'tunnel-before-placement' }),
    make('approach-note-flight', [approach], 3.5, { size: .25 }),
    make('approach-scaled-same-beat', [approach], 3.5, { placement: scaled, size: .25 }),
    make('trail-scaled-same-beat', [radial, trail], 3.25, { placement: scaled, size: .075 }),
    make('trail-placement-restored', [radial, trail], 3.25, { size: .075, repeat: 'rainbow-trail' }),
    make('fractal-full-count', [countFractal, radial], 0, { size: .12 }),
    make('fractal-seed-count', [countFractal, radial], 2, { size: .12 }),
    make('fractal-full-count-later', [countFractal, radial], 4, { size: .12, repeat: 'fractal-full-count' }),
    make('appearance-restored-after-transitions', [visible], 1.75, { objectOpacity: 2.5, glow: 2, size: .25, repeat: 'opacity-above-one-and-hue' }),
  ]
}

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
function performanceCases() {
  const fractal = () => entry('fractal', { branches: 4, depth: 4, shrink: .45, spread: 1.5, angle: 31 })
  const spin = () => entry('mover', { motion: 1, mode: 1, angleX: 17, angleY: 29, angleZ: 45 })
  const tail = () => [entry('radial', { copies: 32, radius: .8, plane: 1 }),
    entry('radial', { copies: 32, radius: .15, plane: 2 }), entry('line', { copies: 3, spacing: .04 })]
  return [
    { name: 'million-fractal-sibling-rotate', count: 341 * 32 * 32 * 3, chain: [fractal(), spin(), ...tail()] },
    { name: 'million-fractal-nested-rotate', count: 341 * 32 * 32 * 3, chain: [splitterWithChildChain(fractal(), [spin()]), ...tail()] },
    { name: 'million-mixed-rainbow-alpha', count: 6 * 64 * 256 * 12,
      chain: [entry('duplicateTrail', { speed: 10, density: 2, rainbow: 1, size: 1.2 }, [note(0, 60, 32)]),
        entry('scatter', { copies: 64, spread: 1.8, seed: 731 }),
        entry('wallpaper', { rows: 8, columns: 8, mode: 3, spacing: .04 }), entry('radial', { copies: 12, radius: .12, plane: 1 })] },
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
      if (!plan || plan.count !== reference.length) throw new Error(`${id}: default shared plan mismatch`)
      return { id, count: plan.count, shared: true, appearance: !!plan.appearanceOffsets, program: !!plan.program }
    })
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
        appearanceOffsets: plan.appearanceOffsets ?? [], program: !!plan.program,
        texture: [compact.texture.image.width, compact.texture.image.height], ...pixels, glError, pass: pixels.pass && glError === 0 })
    }
    const benchmarks: Record<string, unknown>[] = []
    result.benchmarks = benchmarks
    if ((document.querySelector('#measure') as HTMLInputElement).checked) {
      renderer.setRenderTarget(null)
      const extension = gl.getExtension('EXT_disjoint_timer_query_webgl2')
      const maxPointSize = (gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE) as Float32Array)[1]
      result.gpuTimerSupported = !!extension
      for (const benchmark of performanceCases()) {
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
    result.pass = frames.every(frame => frame.pass) && benchmarks.every(benchmark => benchmark.pass) && result.glError === 0 && errors.length === 0
  } catch (error) { result.fatalError = error instanceof Error ? error.stack : String(error) }
  finally {
    cleanups.reverse().forEach(cleanup => cleanup()); console.error = originalError
    output.textContent = JSON.stringify(result, null, 2)
    try { const response = await fetch('/results', { method: 'POST', body: JSON.stringify(result, null, 2) }); if (!response.ok) throw new Error(`Save failed: ${response.status}`) }
    catch (error) { output.textContent += '\n' + String(error) }
    button.disabled = false
  }
}
