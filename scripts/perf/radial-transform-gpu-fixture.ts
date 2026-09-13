import {
  Color, InstancedBufferGeometry, Matrix4, PerspectiveCamera, Raycaster, Scene,
  Vector2, Vector3, Vector4, WebGLRenderer, WebGLRenderTarget,
  type Intersection,
} from 'three'
import { createParticlePlanMesh } from '../../src/editor/instruments/particlePlanRenderer'
import { createParticlePool, disposeParticlePool } from '../../src/editor/instruments/particleCore'
import { compileParticlePlan, matrixScaleBound } from '../../src/editor/core/visualCopies/particlePlan'
import { getMoverOrSplitterDefinition } from '../../src/editor/core/visualCopies/registry'
import { mergeDefinitionSettings } from '../../src/editor/core/visualCopies/definitions'
import { resolveVisualCopies } from '../../src/editor/core/visualCopies/resolveVisualCopies'
import { splitterWithChildChain } from '../../src/editor/core/visualCopies/splitterChildChain'
import type { MoverOrSplitter } from '../../src/editor/core/visualCopies/types'

type Motion = 'rotate' | 'orbit'
type Placement = 'above' | 'between' | 'below' | 'nested-first' | 'nested-middle' | 'nested-last'
const output = document.querySelector('pre')!
const button = document.querySelector('button')!
const width = 1280, height = 720
const color = new Color('#84ccfa'), opacity = .065, glow = .2
const placement = new Matrix4().makeRotationY(.12).scale(new Vector3(1.08, .87, .92)).setPosition(.25, -.15, .3)

function chainFor(motion: Motion, position: Placement, stages = 3, copies = 32): MoverOrSplitter[] {
  const radial = getMoverOrSplitterDefinition('radial')!
  const mover = getMoverOrSplitterDefinition('mover')!
  const chain = Array.from({ length: stages }, (_, index) => radial.resolve({
    settings: mergeDefinitionSettings(radial, { copies, radius: [4, 1.2, .25, .07][index], plane: index % 3, size: 1 }), notes: [],
  }))
  const motionEntry = mover.resolve({
    settings: mergeDefinitionSettings(mover, { motion: motion === 'rotate' ? 1 : 2,
      mode: 1, drive: 0, angleX: 17, angleY: 29, angleZ: 45, angle: 1,
      pivotX: .3, pivotY: -.2, pivotZ: .1 }), notes: [],
  })
  const nestedIndex = position === 'nested-first' ? 0 : position === 'nested-middle' ? 1 : position === 'nested-last' ? stages - 1 : -1
  if (nestedIndex >= 0) chain[nestedIndex] = splitterWithChildChain(chain[nestedIndex], [motionEntry])
  else chain.splice(position === 'above' ? 0 : position === 'between' ? 1 : chain.length, 0, motionEntry)
  return chain
}

/** Near-singular prefixes deliberately mix active/bare framed branches. The
 * five-slot pattern spans RGBA channels, texels and rows of the guard texture;
 * y/z stay full size so both outcomes remain visible for image comparison. */
function mixedGuardChain(): MoverOrSplitter[] {
  const radial = getMoverOrSplitterDefinition('radial')!, mover = getMoverOrSplitterDefinition('mover')!
  const ring = (copies: number, radius: number, plane: number) => radial.resolve({
    settings: mergeDefinitionSettings(radial, { copies, radius, plane, size: 1 }), notes: [],
  })
  const spin = (angleX: number, angleZ: number) => mover.resolve({
    settings: mergeDefinitionSettings(mover, { motion: 1, mode: 1, drive: 0, angleX, angleY: 0, angleZ, angle: 1 }), notes: [],
  })
  const matrices = [1, 1e-13, 1, 1e-13, 1].map((scale, index) => new Matrix4().makeScale(scale, 1, 1).setPosition((index - 2) * .5, 0, 0))
  const choices: MoverOrSplitter = { cachePolicy: 'static', localTransforms: matrices,
    apply(copy) { return matrices.map(matrix => ({ ...copy, transform: copy.transform.clone().multiply(matrix), colorShift: { ...copy.colorShift } })) },
  }
  return [splitterWithChildChain(ring(32, 3, 0), [spin(11, 17)]), ring(32, .8, 1), choices,
    splitterWithChildChain(ring(2, .5, 2), [spin(0, 70)]), ring(2, .2, 0)]
}

function pixelDifference(expected: Uint8Array, actual: Uint8Array, previous?: Uint8Array) {
  let maxDifference = 0, sumDifference = 0, channelsOver4 = 0, litChannels = 0
  let expectedIntensity = 0, actualIntensity = 0, seekDifference = 0
  for (let i = 0; i < actual.length; i++) {
    if (i % 4 === 3) continue
    const difference = Math.abs(actual[i] - expected[i])
    maxDifference = Math.max(maxDifference, difference); sumDifference += difference
    if (difference > 4) channelsOver4++
    if (expected[i]) litChannels++
    expectedIntensity += expected[i]; actualIntensity += actual[i]
    if (previous) seekDifference = Math.max(seekDifference, Math.abs(actual[i] - previous[i]))
  }
  const channels = actual.length / 4 * 3
  const meanDifference = sumDifference / channels
  const relativeIntensityDifference = Math.abs(actualIntensity - expectedIntensity) / Math.max(1, expectedIntensity)
  // GPU factor multiplication rounds earlier than uploading one CPU-composed
  // matrix. Allow rare edge-rasterization changes, but reject image drift.
  return { maxDifference, meanDifference, channelsOver4, litChannels, relativeIntensityDifference, seekDifference,
    pass: litChannels > 1000 && meanDifference < .1 && channelsOver4 / channels < .002
      && relativeIntensityDifference < .001 && seekDifference === 0 }
}

function summary(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  const p = (fraction: number) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] : null
  return { samples: sorted.length, medianMs: p(.5), p95Ms: p(.95), maxMs: p(1),
    meanMs: sorted.length ? sorted.reduce((sum, value) => sum + value, 0) / sorted.length : null }
}

const animationFrame = () => new Promise<number>(resolve => requestAnimationFrame(resolve))

button.onclick = async () => {
  button.disabled = true
  const scope = (document.querySelector('#scope') as HTMLSelectElement).value
  const positions: Placement[] = scope === 'nested' ? ['nested-first', 'nested-middle', 'nested-last'] : ['above', 'between', 'below']
  const benchmarkPosition: Placement = scope === 'nested' ? 'nested-middle' : 'between'
  const pickingPosition: Placement = scope === 'nested' ? 'nested-last' : 'below'
  const errors: string[] = []
  const originalError = console.error
  console.error = (...args) => { errors.push(args.map(String).join(' ')); originalError(...args) }
  let renderer: WebGLRenderer | undefined
  const cleanup: (() => void)[] = []
  const result: Record<string, unknown> = {
    description: 'Production Particle renderer parity, picking and isolated GPU timing; not whole-editor FPS.',
    timestamp: new Date().toISOString(), initialVisibility: document.visibilityState, scope,
    parity: [], picking: [], benchmarks: [], errors, pass: false,
  }
  const visibilityChanges: string[] = []
  const visibilityChanged = () => visibilityChanges.push(document.visibilityState)
  document.addEventListener('visibilitychange', visibilityChanged)
  try {
    renderer = new WebGLRenderer({ antialias: false })
    renderer.setPixelRatio(1); renderer.setSize(width, height)
    renderer.setClearColor(0x000000, 1)
    document.body.appendChild(renderer.domElement)
    const render = renderer
    const gl = render.getContext() as WebGL2RenderingContext
    const camera = new PerspectiveCamera(50, width / height, 1, 100)
    camera.position.set(0, 0, 14); camera.updateMatrixWorld()
    const target = new WebGLRenderTarget(512, 288)
    cleanup.push(() => target.dispose())
    const info = gl.getExtension('WEBGL_debug_renderer_info')
    const maxPointSize = (gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE) as Float32Array)[1]
    result.environment = { renderer: info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      userAgent: navigator.userAgent, width, height, maxPointSize }
    const read = (scene: Scene) => {
      render.setRenderTarget(target); render.setScissorTest(false); render.render(scene, camera)
      const bytes = new Uint8Array(512 * 288 * 4)
      render.readRenderTargetPixels(target, 0, 0, 512, 288, bytes)
      return bytes
    }
    const configure = (pool: ReturnType<typeof createParticlePlanMesh>, size: number) => {
      const uniforms = pool.mesh.material.uniforms
      uniforms.uPlacement.value.copy(placement); uniforms.uMeshScale.value = size
      uniforms.uColor.value.copy(color); uniforms.uOpacity.value = opacity
      uniforms.uGlow.value = glow; uniforms.uMinRadiusNdc.value = 0
    }
    const reference = createParticlePool(32 ** 3)
    cleanup.push(() => disposeParticlePool(reference))
    const referenceScene = new Scene().add(reference.mesh)
    reference.mesh.material.uniforms.uGlow.value = glow
    const matrix = new Matrix4(), sizeVector = new Vector3()
    const fillReference = (chain: MoverOrSplitter[], beat: number, size: number) => {
      const copies = resolveVisualCopies(chain, beat, placement)
      sizeVector.setScalar(size)
      copies.forEach((copy, index) => {
        matrix.copy(placement).multiply(copy.transform).scale(sizeVector)
        reference.mesh.setMatrixAt(index, matrix)
        reference.colors.setXYZW(index, color.r, color.g, color.b, opacity * copy.opacity)
      })
      reference.mesh.count = copies.length
      reference.mesh.instanceMatrix.needsUpdate = true; reference.colors.needsUpdate = true
      return copies
    }

    const parity: Record<string, unknown>[] = []
    result.parity = parity
    for (const motion of ['rotate', 'orbit'] as const) for (const position of positions) {
      output.textContent = `Comparing ${motion}, mover ${position}, 32,768 quads…`
      await animationFrame()
      const chain = chainFor(motion, position), initial = compileParticlePlan(chain, 0, 0)!
      if (!initial) throw new Error(`Missing compact plan: ${motion}/${position}`)
      const compact = createParticlePlanMesh(initial, false), compactScene = new Scene().add(compact.mesh)
      configure(compact, .035)
      let firstPixels: Uint8Array | undefined
      for (const beat of [0, .5, 1.25, 4.5, 0]) {
        const plan = compileParticlePlan(chain, 1, beat)!
        compact.update(plan); fillReference(chain, beat, .035)
        const expected = read(referenceScene), actual = read(compactScene)
        const difference = pixelDifference(expected, actual, beat === 0 ? firstPixels : undefined)
        if (beat === 0 && !firstPixels) firstPixels = actual
        parity.push({ motion, position, beat, count: plan.count, ...difference })
      }
      compact.dispose()
    }

    output.textContent = 'Checking mixed guard flags and program → plain → program mesh updates…'
    await animationFrame()
    const guarded = mixedGuardChain(), plain = chainFor('orbit', 'below', 2, 3)
    const transitionPool = createParticlePlanMesh(compileParticlePlan(plain, 0, .7)!, false)
    const transitionScene = new Scene().add(transitionPool.mesh), transitions: Record<string, unknown>[] = []
    cleanup.push(() => transitionPool.dispose())
    result.transitions = transitions
    let guardPixels: Uint8Array | undefined
    for (const [index, step] of [
      { name: 'mixed-program', chain: guarded, beat: .7, size: .035 },
      { name: 'plain', chain: plain, beat: .7, size: .3 },
      { name: 'uniform-program', chain: chainFor('rotate', 'nested-first', 3, 4), beat: .7, size: .15 },
      { name: 'mixed-program-later', chain: guarded, beat: 2.1, size: .035 },
      { name: 'mixed-program-seek', chain: guarded, beat: .7, size: .035 },
    ].entries()) {
      const plan = compileParticlePlan(step.chain, index + 1, step.beat)!
      transitionPool.update(plan); configure(transitionPool, step.size)
      fillReference(step.chain, step.beat, step.size)
      const expected = read(referenceScene), actual = read(transitionScene)
      const difference = pixelDifference(expected, actual, step.name === 'mixed-program-seek' ? guardPixels : undefined)
      if (step.name === 'mixed-program') guardPixels = actual
      const guards = plan.program?.guardOffsets.flatMap((offset, stage) => {
        if (offset < 0) return []
        const length = plan.count / plan.program!.guardStrides[stage]
        const flags = plan.matrices.slice(offset, offset + length)
        return [{ stage, offset, length, enabled: flags.reduce((sum, value) => sum + value, 0),
          correctPattern: flags.every((flag, i) => flag === ([1, 0, 1, 0, 1][i % 5])) }]
      }) ?? []
      const expectedGuard = step.chain !== guarded || guards.some(guard => guard.length === 5120 && guard.enabled === 3072 && guard.correctPattern)
      transitions.push({ name: step.name, count: plan.count, beat: step.beat, program: !!plan.program,
        guards, texture: [transitionPool.texture.image.width, transitionPool.texture.image.height],
        ...difference, pass: difference.pass && expectedGuard })
    }

    output.textContent = 'Checking growth, shrink, picking and renderer-state restoration…'
    await animationFrame()
    const pickPool = createParticlePlanMesh(compileParticlePlan(chainFor('orbit', pickingPosition, 3, 2), 0, .5)!, true)
    cleanup.push(() => pickPool.dispose())
    const pickScene = new Scene().add(pickPool.mesh)
    configure(pickPool, .035)
    const ray = new Raycaster(), point = new Vector3(), picking: Record<string, unknown>[] = []
    result.picking = picking
    const pickingSteps: { position: Placement; copiesPerRadial: number; stages: number }[] = [
      { position: pickingPosition, copiesPerRadial: 2, stages: 3 },
      { position: pickingPosition, copiesPerRadial: 32, stages: 3 },
      { position: 'below', copiesPerRadial: 3, stages: 2 },
      { position: pickingPosition, copiesPerRadial: 4, stages: 3 },
      { position: pickingPosition, copiesPerRadial: 2, stages: 3 },
    ]
    for (const { position, copiesPerRadial, stages } of pickingSteps) {
      const chain = chainFor('orbit', position, stages, copiesPerRadial), plan = compileParticlePlan(chain, 1, .5)!
      pickPool.update(plan)
      const copies = fillReference(chain, .5, .035)
      render.setRenderTarget(null); render.setViewport(0, 0, width, height); render.setScissorTest(false)
      render.render(referenceScene, camera); render.render(pickScene, camera)
      point.setFromMatrixPosition(matrix.copy(placement).multiply(copies[0].transform)).project(camera)
      ray.setFromCamera(new Vector2(point.x, point.y), camera)
      const expected: Intersection[] = [], hits: Intersection[] = []
      reference.mesh.raycast(ray, expected); expected.sort((a, b) => a.distance - b.distance)
      // Simulate a pending thumbnail readback; picking must restore all state.
      render.setRenderTarget(target); render.setViewport(3, 5, 400, 220)
      render.setScissor(7, 11, 120, 90); render.setScissorTest(true); render.setClearColor(0x182128, .7)
      const pack = gl.createBuffer()
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pack); gl.bufferData(gl.PIXEL_PACK_BUFFER, 64, gl.STREAM_READ)
      const beforeViewport = render.getViewport(new Vector4()), beforeScissor = render.getScissor(new Vector4())
      const beforeColor = render.getClearColor(new Color()).clone(), beforeAutoClear = render.autoClear, beforeXR = render.xr.enabled
      pickPool.mesh.raycast(ray, hits)
      const restored = render.getRenderTarget() === target && beforeViewport.equals(render.getViewport(new Vector4()))
        && beforeScissor.equals(render.getScissor(new Vector4())) && render.getScissorTest()
        && beforeColor.equals(render.getClearColor(new Color())) && render.getClearAlpha() === .7
        && render.autoClear === beforeAutoClear && render.xr.enabled === beforeXR
        && gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING) === pack
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null); gl.deleteBuffer(pack)
      render.setRenderTarget(null); render.setViewport(0, 0, width, height); render.setScissorTest(false); render.setClearColor(0x000000, 1)
      ray.setFromCamera(new Vector2(.99, .99), camera)
      const misses: Intersection[] = []; pickPool.mesh.raycast(ray, misses)
      ray.setFromCamera(new Vector2(point.x, point.y), camera)
      pickPool.mesh.visible = false
      const hidden: Intersection[] = []; pickPool.mesh.raycast(ray, hidden); pickPool.mesh.visible = true
      const distanceError = Math.abs((hits[0]?.distance ?? Infinity) - (expected[0]?.distance ?? 0))
      const glError = gl.getError()
      picking.push({ position, copiesPerRadial, stages, program: !!plan.program, count: plan.count, drawCount: pickPool.mesh.geometry.drawRange.count,
        textureBytes: pickPool.texture.image.data.byteLength, expectedHits: expected.length,
        hits: hits.length, distanceError, misses: misses.length, hidden: hidden.length, restored, glError,
        pass: hits.length === 1 && expected.length > 0 && distanceError < .005 && !misses.length && !hidden.length && restored && glError === 0 })
    }

    const extension = gl.getExtension('EXT_disjoint_timer_query_webgl2')
    result.gpuTimerSupported = !!extension
    const benchmarks: Record<string, unknown>[] = []
    result.benchmarks = benchmarks
    for (const motion of ['rotate', 'orbit'] as const) for (const stages of [3, 4]) {
      const chain = chainFor(motion, benchmarkPosition, stages), initial = compileParticlePlan(chain, 0, 0)!
      const size = .007
      const sizeBound = initial.scaleBound * matrixScaleBound(placement) * size * camera.projectionMatrix.elements[5] * height / camera.near
      const usePoints = sizeBound <= maxPointSize
      const compact = createParticlePlanMesh(initial, usePoints), scene = new Scene().add(compact.mesh)
      configure(compact, size)
      const cpu: number[] = [], gpu: number[] = [], intervals: number[] = []
      const pending: { query: WebGLQuery; collect: boolean }[] = []
      let previousTime = 0, disjointResults = 0
      const drain = () => {
        while (pending.length && gl.getQueryParameter(pending[0].query, gl.QUERY_RESULT_AVAILABLE)) {
          const { query, collect } = pending.shift()!
          if (gl.getParameter(extension!.GPU_DISJOINT_EXT)) disjointResults++
          else if (collect) gpu.push(gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6)
          gl.deleteQuery(query)
        }
      }
      for (let frame = 0; frame < 180; frame++) {
        if (frame % 30 === 0) output.textContent = `Benchmarking ${motion}: ${initial.count.toLocaleString()} particles, frame ${frame}/180…`
        const now = await animationFrame()
        if (frame >= 30 && previousTime) intervals.push(now - previousTime)
        previousTime = now
        const start = performance.now()
        compact.update(compileParticlePlan(chain, frame + 1, frame / 30)!)
        const query = extension && gl.createQuery()
        if (query) gl.beginQuery(extension.TIME_ELAPSED_EXT, query)
        render.render(scene, camera)
        if (query) { gl.endQuery(extension.TIME_ELAPSED_EXT); pending.push({ query, collect: frame >= 30 }) }
        if (frame >= 30) cpu.push(performance.now() - start)
        drain()
      }
      for (let wait = 0; pending.length && wait < 20; wait++) { await animationFrame(); drain() }
      const undeliveredQueries = pending.length
      pending.forEach(({ query }) => gl.deleteQuery(query))
      const renderedCount = compact.mesh.geometry instanceof InstancedBufferGeometry
        ? compact.mesh.geometry.instanceCount : compact.mesh.geometry.drawRange.count
      const glError = gl.getError()
      benchmarks.push({ motion, position: benchmarkPosition, stages, particles: initial.count, primitive: usePoints ? 'points' : 'quads', sizeBound,
        planMatrixCount: initial.matrices.length / 16, uploadBytesPerFrame: compact.texture.image.data.byteLength,
        cpuUpdateAndRender: summary(cpu), gpu: summary(gpu), callbackIntervals: summary(intervals),
        callbackFps: 1000 / (intervals.reduce((a, b) => a + b, 0) / intervals.length),
        drawCalls: render.info.render.calls, renderedCount, disjointResults, undeliveredQueries, glError,
        pass: renderedCount === initial.count && render.info.render.calls === 1 && glError === 0 })
      compact.dispose()
    }
    result.visibilityChanges = visibilityChanges
    result.finalVisibility = document.visibilityState
    result.glError = gl.getError()
    result.pass = parity.every(check => check.pass) && transitions.every(check => check.pass) && picking.every(check => check.pass)
      && benchmarks.every(check => check.pass) && errors.length === 0 && result.glError === 0
  } catch (error) {
    result.fatalError = error instanceof Error ? error.stack : String(error)
  } finally {
    cleanup.forEach(dispose => dispose())
    renderer?.dispose()
    document.removeEventListener('visibilitychange', visibilityChanged)
    console.error = originalError
    output.textContent = JSON.stringify(result, null, 2)
    try {
      const response = await fetch('/results', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(result, null, 2) })
      if (!response.ok) throw new Error(`Saving results failed: ${response.status}`)
    } catch (error) { output.textContent += `\n${String(error)}` }
    button.disabled = false
  }
}
