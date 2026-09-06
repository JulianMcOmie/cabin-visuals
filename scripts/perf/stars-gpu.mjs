// Standalone Stars shader parity + rendering microbenchmark (no editor server).
// node --import tsx scripts/perf/stars-gpu.mjs
// SOFTWARE=1 explicitly selects SwiftShader. HEADLESS=0 opens a visible browser.
// BROWSER_CHANNEL=chromium uses bundled Chromium; the default prefers Chrome.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { chromium } from 'playwright'
import ts from 'typescript'

const root = new URL('../../', import.meta.url)
const shaderSource = await readFile(new URL('src/editor/instruments/starsGpu.ts', root), 'utf8')
const shaderModule = ts.transpileModule(shaderSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText
const routes = new Map([
  ['/gpu.mjs', shaderModule],
  ['/cpu.mjs', await readFile(new URL('scripts/perf/fixtures/stars-cpu-reference.mjs', root), 'utf8')],
  ['/three.module.js', await readFile(new URL('node_modules/three/build/three.module.js', root), 'utf8')],
  ['/three.core.js', await readFile(new URL('node_modules/three/build/three.core.js', root), 'utf8')],
])
const server = createServer((request, response) => {
  // Cross-origin isolation restores precise performance.now measurements locally.
  response.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
  response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp')
  const pathname = new URL(request.url, 'http://localhost').pathname
  if (pathname === '/') {
    response.setHeader('Content-Type', 'text/html')
    response.end('<!doctype html><title>Stars GPU verification</title><script type="importmap">{"imports":{"three":"/three.module.js"}}</script>')
  } else if (routes.has(pathname)) {
    response.setHeader('Content-Type', 'text/javascript')
    response.end(routes.get(pathname))
  } else {
    response.writeHead(404).end()
  }
})
await new Promise((resolve, reject) => {
  server.once('error', reject)
  server.listen(0, '127.0.0.1', resolve)
})

let browser
try {
  const software = process.env.SOFTWARE === '1'
  let channel = process.env.BROWSER_CHANNEL ?? 'chrome'
  const launchOptions = {
    headless: process.env.HEADLESS !== '0',
    args: software ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : [],
  }
  try {
    browser = await chromium.launch({ ...launchOptions, ...(channel === 'chromium' ? {} : { channel }) })
  } catch (error) {
    if (process.env.BROWSER_CHANNEL || !/not found|doesn't exist|distribution|executable/i.test(String(error))) throw error
    channel = 'chromium'
    console.log('Chrome is unavailable; trying bundled Chromium with its default GPU backend.')
    browser = await chromium.launch(launchOptions)
  }
  const page = await browser.newPage({ viewport: { width: 960, height: 600 } })
  page.setDefaultTimeout(120_000)
  await page.goto(`http://127.0.0.1:${server.address().port}/`)
  const result = await page.evaluate(async ({ softwareRequested }) => {
    const THREE = await import('three')
    const { STARS_TRANSFORM_GLSL, STARS_VERTEX_SHADER, STARS_FRAGMENT_SHADER, createStarsUniforms, createStarsMotionState, updateStarsMotion, writeStarsPickPositions } = await import('/gpu.mjs')
    const { createStarOutputs, evaluateStarsCPU } = await import('/cpu.mjs')
    const check = (condition, message) => { if (!condition) throw new Error(message) }
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
    const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
    const rounded = (value) => value == null ? null : Number(value.toFixed(6))
    const seededRand = (seed) => {
      const x = Math.sin(seed * 9301 + 49297) * 233280
      return x - Math.floor(x)
    }
    const makeStars = (count, spread = 6, depth = 15) => {
      const base = new Float32Array(count * 3)
      const parallax = new Float32Array(count)
      for (let i = 0; i < count; i++) {
        base[i * 3] = (seededRand(i * 3) - 0.5) * spread * 2
        base[i * 3 + 1] = (seededRand(i * 3 + 1) - 0.5) * spread * 2
        base[i * 3 + 2] = (seededRand(i * 3 + 2) - 0.5) * depth
        parallax[i] = depth / 2 / (Math.abs(base[i * 3 + 2]) + 0.5)
      }
      return { base, parallax }
    }
    const defaultFrame = {
      displacement: [0, 0, 0], spread: 6, depth: 15, pulseAmount: 0,
      rollAngle: 0, tumbleAngle: 0, tumbleAxis: [Math.SQRT1_2, Math.SQRT1_2, 0],
      dotSize: 2, tint: 220,
    }
    const frame = (name, changes) => ({ name, ...defaultFrame, ...changes })
    const cases = [
      frame('rest', {}),
      frame('negative and multi-volume displacement', { displacement: [-193.23, 54.789, -98.432] }),
      frame('pulse', { pulseAmount: 1.25, displacement: [0.13, -0.31, 0.71] }),
      frame('negative barrel roll', { rollAngle: -4.37 }),
      frame('positive tumble', { tumbleAngle: 1.78, tumbleAxis: [0.36, 0.48, 0.8] }),
      frame('negative tumble is inert', { tumbleAngle: -1.78, tumbleAxis: [0.36, 0.48, 0.8] }),
      frame('combined motion', { displacement: [-12.25, 8.031, 27.78], pulseAmount: 0.73, rollAngle: 3.51, tumbleAngle: 2.12, tumbleAxis: [0.36, 0.48, 0.8], tint: 37 }),
      frame('zero tint is white', { tint: 0, displacement: [0, 0, -4.83] }),
      frame('360 tint stays red', { tint: 360, displacement: [0, 0, -4.83] }),
      frame('minimum size and bounds', { spread: 2, depth: 5, dotSize: 0 }),
      frame('maximum size and bounds', { spread: 12, depth: 30, dotSize: 6, tint: 137 }),
      frame('long playback displacement', { displacement: [1000, -500, 4096] }),
      frame('long playback combined motion', { displacement: [1000, -500, 4096], pulseAmount: 0.73, rollAngle: 3.51, tumbleAngle: 2.12, tumbleAxis: [0.36, 0.48, 0.8] }),
      ...[31.999, 32, 32.001, -31.999, -32, -32.001].map((d) => frame(`rebase boundary ${d}`, { displacement: [d, -d, d], rollAngle: 0.7, tumbleAngle: 0.9, pulseAmount: 0.2 })),
    ]

    // Capture actual production GLSL outputs before rasterization, using all
    // four legacy outputs. This is independent of the production picking math.
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl2')
    check(gl, 'WebGL2 unavailable. Try SOFTWARE=1 for an explicitly labeled software verification.')
    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info')
    const rendererName = debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)
    const vendorName = debugInfo ? gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR)
    const softwareDetected = /swiftshader|llvmpipe|software|softpipe/i.test(rendererName)
    const compileShader = (type, source) => {
      const shader = gl.createShader(type)
      gl.shaderSource(shader, source)
      gl.compileShader(shader)
      check(gl.getShaderParameter(shader, gl.COMPILE_STATUS), gl.getShaderInfoLog(shader))
      return shader
    }
    const program = gl.createProgram()
    gl.attachShader(program, compileShader(gl.VERTEX_SHADER, `#version 300 es
      precision highp float;
      in vec3 aHome;
      in float aParallax;
      out vec3 tfPosition;
      out float tfSize;
      out vec3 tfColor;
      out float tfAlpha;
      ${STARS_TRANSFORM_GLSL}
      void main() {
        tfPosition = starPosition(aHome, aParallax);
        tfSize = starSize(tfPosition);
        tfColor = starColor(tfPosition);
        tfAlpha = starAlpha(tfPosition);
        gl_Position = vec4(tfPosition, 1.0);
      }
    `))
    gl.attachShader(program, compileShader(gl.FRAGMENT_SHADER, `#version 300 es
      precision highp float;
      out vec4 color;
      void main() { color = vec4(1.0); }
    `))
    gl.transformFeedbackVaryings(program, ['tfPosition', 'tfSize', 'tfColor', 'tfAlpha'], gl.INTERLEAVED_ATTRIBS)
    gl.linkProgram(program)
    check(gl.getProgramParameter(program, gl.LINK_STATUS), gl.getProgramInfoLog(program))
    gl.useProgram(program)
    const parityCount = 4096
    const { base, parallax } = makeStars(parityCount)
    // Explicit branch/volume edges complement seeded inputs; the long-playback
    // cases exercise production rebasing before pulse and rotation.
    base.set([0, 0, 0, 0.005, 0, 0.75, 0.02, 0, -0.75, -6, 6, -7.5])
    for (let i = 0; i < 4; i++) parallax[i] = 7.5 / (Math.abs(base[i * 3 + 2]) + 0.5)
    const motion = createStarsMotionState(base, parallax)
    const vao = gl.createVertexArray()
    gl.bindVertexArray(vao)
    let homeBuffer
    for (const [name, values, size] of [['aHome', motion.positions, 3], ['aParallax', parallax, 1]]) {
      const buffer = gl.createBuffer()
      if (name === 'aHome') homeBuffer = buffer
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
      gl.bufferData(gl.ARRAY_BUFFER, values, gl.STATIC_DRAW)
      const location = gl.getAttribLocation(program, name)
      gl.enableVertexAttribArray(location)
      gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0)
    }
    const feedback = gl.createTransformFeedback()
    const feedbackBuffer = gl.createBuffer()
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, feedback)
    gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER, feedbackBuffer)
    gl.bufferData(gl.TRANSFORM_FEEDBACK_BUFFER, parityCount * 8 * 4, gl.STREAM_READ)
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, feedbackBuffer)
    const uniforms = createStarsUniforms()
    const locations = Object.fromEntries(Object.keys(uniforms).map((key) => [key, gl.getUniformLocation(program, key)]))
    const setUniforms = (values) => {
      if (updateStarsMotion(motion, uniforms, values)) {
        gl.bindBuffer(gl.ARRAY_BUFFER, homeBuffer)
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, motion.positions)
      }
      for (const [key, { value }] of Object.entries(uniforms)) {
        const location = locations[key]
        if (location === null) continue
        if (typeof value === 'number') gl.uniform1f(location, value)
        else if (value.isVector3) gl.uniform3f(location, value.x, value.y, value.z)
        else if (value.isVector2) gl.uniform2f(location, value.x, value.y)
      }
    }
    const capture = (values) => {
      setUniforms(values)
      gl.enable(gl.RASTERIZER_DISCARD)
      gl.beginTransformFeedback(gl.POINTS)
      gl.drawArrays(gl.POINTS, 0, parityCount)
      gl.endTransformFeedback()
      gl.disable(gl.RASTERIZER_DISCARD)
      const output = new Float32Array(parityCount * 8)
      gl.getBufferSubData(gl.TRANSFORM_FEEDBACK_BUFFER, 0, output)
      check(gl.getError() === gl.NO_ERROR, 'Transform feedback GL error')
      return output
    }
    const maxErrors = { position: 0, size: 0, color: 0, alpha: 0, pickingPosition: 0 }
    const tolerances = { position: 0.002, sizeAbsolute: 0.003, sizeRelative: 0.002, color: 0.0005, alpha: 0.0002 }
    const perCase = []
    const parityFailures = []
    const reference = createStarOutputs(parityCount)
    const pickPositions = new Float32Array(base.length)
    for (const values of cases) {
      evaluateStarsCPU(base, parallax, values, reference)
      const gpu = capture(values)
      writeStarsPickPositions(motion.positions, parallax, uniforms, pickPositions)
      const caseErrors = { position: 0, size: 0, color: 0, alpha: 0 }
      const firstFailures = new Map()
      const parityCheck = (condition, key, message) => {
        if (!condition && !firstFailures.has(key)) firstFailures.set(key, message)
      }
      for (let i = 0; i < parityCount; i++) {
        for (let axis = 0; axis < 3; axis++) {
          const half = axis === 2 ? values.depth / 2 : values.spread
          const actual = gpu[i * 8 + axis]
          check(Number.isFinite(actual) && actual >= -half - tolerances.position && actual <= half + tolerances.position, `${values.name}: position out of bounds at star ${i}`)
          const delta = Math.abs(actual - reference.positions[i * 3 + axis])
          const error = Math.min(delta, Math.abs(half * 2 - delta))
          caseErrors.position = Math.max(caseErrors.position, error)
          parityCheck(error <= tolerances.position, 'position', `${values.name}: position error ${error} at star ${i}, axis ${axis}`)
          maxErrors.pickingPosition = Math.max(maxErrors.pickingPosition, Math.abs(pickPositions[i * 3 + axis] - reference.positions[i * 3 + axis]))
          const colorError = Math.abs(gpu[i * 8 + 4 + axis] - reference.colors[i * 3 + axis])
          caseErrors.color = Math.max(caseErrors.color, colorError)
          parityCheck(colorError <= tolerances.color, 'color', `${values.name}: color error ${colorError} at star ${i}`)
        }
        const sizeError = Math.abs(gpu[i * 8 + 3] - reference.sizes[i])
        caseErrors.size = Math.max(caseErrors.size, sizeError)
        parityCheck(sizeError <= tolerances.sizeAbsolute + reference.sizes[i] * tolerances.sizeRelative, 'size', `${values.name}: size error ${sizeError} at star ${i}`)
        const alphaError = Math.abs(gpu[i * 8 + 7] - reference.alphas[i])
        caseErrors.alpha = Math.max(caseErrors.alpha, alphaError)
        parityCheck(alphaError <= tolerances.alpha, 'alpha', `${values.name}: alpha error ${alphaError} at star ${i}`)
      }
      for (const key of Object.keys(caseErrors)) maxErrors[key] = Math.max(maxErrors[key], caseErrors[key])
      perCase.push({ name: values.name, ...caseErrors })
      parityFailures.push(...firstFailures.values())
    }
    check(maxErrors.pickingPosition < 0.00001, `Picking CPU reference mismatch: ${maxErrors.pickingPosition}`)
    const first = capture(cases[6])
    for (const index of [18, 13, 11, 14, 17, 9, 0, 5, 2, 8, 1]) capture(cases[index])
    const repeated = capture(cases[6])
    check(first.every((value, index) => Object.is(value, repeated[index])), 'GPU output depends on frame order')
    gl.getExtension('WEBGL_lose_context')?.loseContext()

    // Render the production ShaderMaterial through Three, and compare with the
    // original CPU attribute path. Both paths use the same viewport, data,
    // fragment shader, blending, camera, and number of stars.
    const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false })
    renderer.setSize(640, 360)
    renderer.setPixelRatio(1)
    renderer.setClearColor(0x000000, 1)
    document.body.append(renderer.domElement)
    const renderGl = renderer.getContext()
    const shaderErrors = []
    renderer.debug.onShaderError = (context, program, vertex, fragment) => {
      shaderErrors.push([context.getProgramInfoLog(program), context.getShaderInfoLog(vertex), context.getShaderInfoLog(fragment)].join('\n'))
    }
    const camera = new THREE.PerspectiveCamera(55, 640 / 360, 0.1, 500)
    camera.position.z = 5
    camera.updateMatrixWorld()
    const cpuVertex = `
      attribute float aSize;
      attribute vec3 aColor;
      attribute float aAlpha;
      varying vec3 vColor;
      varying float vAlpha;
      varying float vStreak;
      uniform float uStreakFactor;
      void main() {
        vColor = aColor;
        vAlpha = aAlpha;
        vStreak = uStreakFactor;
        gl_PointSize = aSize * (1.0 + uStreakFactor * 2.0);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `
    const makePair = (count) => {
      const { base, parallax } = makeStars(count)
      const motion = createStarsMotionState(base, parallax)
      const outputs = createStarOutputs(count)
      const cpuGeometry = new THREE.BufferGeometry()
      const cpuAttributes = Object.entries({ position: [outputs.positions, 3], aSize: [outputs.sizes, 1], aColor: [outputs.colors, 3], aAlpha: [outputs.alphas, 1] }).map(([name, [array, size]]) => {
        const attribute = new THREE.BufferAttribute(array, size).setUsage(THREE.DynamicDrawUsage)
        cpuGeometry.setAttribute(name, attribute)
        return attribute
      })
      const gpuGeometry = new THREE.BufferGeometry()
      const gpuPosition = new THREE.BufferAttribute(motion.positions, 3).setUsage(THREE.DynamicDrawUsage)
      gpuGeometry.setAttribute('position', gpuPosition)
      gpuGeometry.setAttribute('aParallax', new THREE.BufferAttribute(parallax, 1))
      const gpuUniforms = createStarsUniforms()
      const cpuUniforms = { uStreakFactor: { value: 0 }, uOpacity: { value: 1 } }
      const materials = [cpuVertex, STARS_VERTEX_SHADER].map((vertexShader, i) => new THREE.ShaderMaterial({ vertexShader, fragmentShader: STARS_FRAGMENT_SHADER, uniforms: i ? gpuUniforms : cpuUniforms, transparent: true, depthWrite: false, depthTest: false }))
      const scenes = [cpuGeometry, gpuGeometry].map((geometry, i) => {
        const scene = new THREE.Scene()
        const points = new THREE.Points(geometry, materials[i])
        points.frustumCulled = false
        scene.add(points)
        return scene
      })
      const update = (mode, values, streak = 0) => {
        if (mode === 0) {
          evaluateStarsCPU(base, parallax, values, outputs)
          for (const attribute of cpuAttributes) attribute.needsUpdate = true
          cpuUniforms.uStreakFactor.value = streak
          return false
        } else {
          const rebased = updateStarsMotion(motion, gpuUniforms, values)
          if (rebased) gpuPosition.needsUpdate = true
          gpuUniforms.uStreakFactor.value = streak
          return rebased
        }
      }
      return { scenes, update, dispose: () => { cpuGeometry.dispose(); gpuGeometry.dispose(); materials.forEach((m) => m.dispose()) } }
    }
    const pixelPair = makePair(3000)
    const target = new THREE.WebGLRenderTarget(640, 360)
    const pixelComparisons = []
    for (const [caseIndex, streak] of [[0, 0], [6, 0.7], [8, 1]]) {
      const pixels = []
      for (const mode of [0, 1]) {
        pixelPair.update(mode, cases[caseIndex], streak)
        renderer.setRenderTarget(target)
        renderer.render(pixelPair.scenes[mode], camera)
        const bytes = new Uint8Array(640 * 360 * 4)
        renderer.readRenderTargetPixels(target, 0, 0, 640, 360, bytes)
        pixels.push(bytes)
      }
      let totalError = 0, maxError = 0, differentChannels = 0, nonBlackChannels = 0
      for (let i = 0; i < pixels[0].length; i++) {
        const error = Math.abs(pixels[0][i] - pixels[1][i])
        totalError += error
        maxError = Math.max(maxError, error)
        if (error) differentChannels++
        if (i % 4 !== 3 && pixels[1][i]) nonBlackChannels++
      }
      const meanAbsoluteError = totalError / pixels[0].length
      check(nonBlackChannels > 500, 'Production ShaderMaterial rendered an empty image')
      check(meanAbsoluteError < 0.5, `Rendered image parity failed: mean byte error ${meanAbsoluteError}`)
      pixelComparisons.push({ name: cases[caseIndex].name, streak, meanAbsoluteByteError: rounded(meanAbsoluteError), maxByteError: maxError, differentChannels, nonBlackChannels })
    }
    renderer.setRenderTarget(null)
    target.dispose()
    pixelPair.dispose()
    check(shaderErrors.length === 0, shaderErrors.join('\n'))
    check(renderGl.getError() === renderGl.NO_ERROR, 'Three ShaderMaterial GL error')

    const timer = renderGl.getExtension('EXT_disjoint_timer_query_webgl2')
    const waitForGpu = async () => {
      // Chrome's gl.finish can return before its GPU process has completed the
      // submitted work. An explicit fence is required for elapsed wall time.
      const fence = renderGl.fenceSync(renderGl.SYNC_GPU_COMMANDS_COMPLETE, 0)
      check(fence, 'Could not create GPU completion fence')
      renderGl.flush()
      const deadline = performance.now() + 15_000
      while (true) {
        const state = renderGl.clientWaitSync(fence, 0, 0)
        if (state === renderGl.ALREADY_SIGNALED || state === renderGl.CONDITION_SATISFIED) break
        check(state !== renderGl.WAIT_FAILED, 'GPU completion fence failed')
        check(performance.now() < deadline, 'GPU completion fence timed out')
        await sleep(0)
      }
      renderGl.deleteSync(fence)
    }
    const benchFrame = (i) => ({
      ...defaultFrame, displacement: [Math.sin(i / 71) * 3, Math.cos(i / 59), 31.5 + i * 0.017],
      rollAngle: i * 0.003, tumbleAngle: i * 0.005, pulseAmount: 0.4, tint: 220,
    })
    const benchmark = []
    for (const count of [3000, 100000]) {
      const pair = makePair(count)
      const framesPerBatch = count === 3000 ? 48 : 16
      const columns = count === 3000 ? 6 : 4
      const batchTarget = new THREE.WebGLRenderTarget(640 * columns, 360 * Math.ceil(framesPerBatch / columns), { depthBuffer: false, stencilBuffer: false })
      batchTarget.scissorTest = true
      renderer.setRenderTarget(batchTarget)
      const selectFrameTile = (index) => {
        const x = index % columns * 640
        const y = Math.floor(index / columns) * 360
        renderer.setViewport(x, y, 640, 360)
        renderer.setScissor(x, y, 640, 360)
      }
      for (let i = 0; i < 24; i++) {
        for (const mode of [0, 1]) {
          selectFrameTile(i % framesPerBatch)
          pair.update(mode, benchFrame(i))
          renderer.render(pair.scenes[mode], camera)
        }
      }
      await waitForGpu()
      const samples = [[], []]
      const gpuTimes = [[], []]
      const rebaseUpdateTimes = []
      let rebaseCount = 0
      const batches = 5
      let invalidTimerQueries = 0
      for (let batch = 0; batch < batches; batch++) {
        // Alternate which implementation runs first to reduce warm/cache bias.
        for (const mode of batch % 2 ? [1, 0] : [0, 1]) {
          const queries = []
          let updateMs = 0, submissionMs = 0, maxUpdateMs = 0
          await waitForGpu()
          const begin = performance.now()
          for (let i = 0; i < framesPerBatch; i++) {
            // Preserve every draw in a different framebuffer region until the
            // completion fence; repeated clears of one canvas may be coalesced.
            selectFrameTile(i)
            const values = benchFrame(24 + batch * framesPerBatch + i)
            const startUpdate = performance.now()
            const rebased = pair.update(mode, values)
            const elapsedUpdate = performance.now() - startUpdate
            updateMs += elapsedUpdate
            maxUpdateMs = Math.max(maxUpdateMs, elapsedUpdate)
            if (mode === 1 && rebased) { rebaseCount++; rebaseUpdateTimes.push(elapsedUpdate) }
            const query = timer && i % 4 === 0 ? renderGl.createQuery() : null
            if (query) renderGl.beginQuery(timer.TIME_ELAPSED_EXT, query)
            const startSubmit = performance.now()
            renderer.render(pair.scenes[mode], camera)
            submissionMs += performance.now() - startSubmit
            if (query) { renderGl.endQuery(timer.TIME_ELAPSED_EXT); queries.push(query) }
          }
          await waitForGpu()
          const completedMs = performance.now() - begin
          samples[mode].push({ updateMs: updateMs / framesPerBatch, renderSubmissionMs: submissionMs / framesPerBatch, completedBatchMsPerFrame: completedMs / framesPerBatch, maxUpdateMs })
          // The completed-frame timing ends before any asynchronous query poll.
          for (const query of queries) {
            const deadline = performance.now() + 5000
            while (!renderGl.getQueryParameter(query, renderGl.QUERY_RESULT_AVAILABLE) && performance.now() < deadline) await sleep(1)
            if (renderGl.getQueryParameter(query, renderGl.QUERY_RESULT_AVAILABLE) && !renderGl.getParameter(timer.GPU_DISJOINT_EXT)) {
              gpuTimes[mode].push(renderGl.getQueryParameter(query, renderGl.QUERY_RESULT) / 1e6)
            } else invalidTimerQueries++
            renderGl.deleteQuery(query)
          }
        }
      }
      const modes = samples.map((runs, mode) => Object.fromEntries([
        ...['updateMs', 'renderSubmissionMs', 'completedBatchMsPerFrame'].map((key) => [key, rounded(median(runs.map((sample) => sample[key])))]),
        ['meanUpdateMs', rounded(runs.reduce((sum, sample) => sum + sample.updateMs, 0) / runs.length)],
        ['maxUpdateMs', rounded(Math.max(...runs.map((sample) => sample.maxUpdateMs)))],
        ['meanCompletedBatchMsPerFrame', rounded(runs.reduce((sum, sample) => sum + sample.completedBatchMsPerFrame, 0) / runs.length)],
        ['gpuDrawMs', gpuTimes[mode].length ? rounded(median(gpuTimes[mode])) : null],
      ]))
      const forcedRebaseUpdates = []
      await waitForGpu()
      const forcedBegin = performance.now()
      for (let i = 0; i < 12; i++) {
        selectFrameTile(i)
        const direction = i % 2 ? 1 : -1
        const values = { ...benchFrame(i), displacement: [1000 * direction, -500 * direction, 4096 * direction] }
        const start = performance.now()
        const rebased = pair.update(1, values)
        forcedRebaseUpdates.push(performance.now() - start)
        check(rebased, 'Forced rebase fixture failed to cross a displacement chunk')
        renderer.render(pair.scenes[1], camera)
      }
      await waitForGpu()
      const forcedRebase = {
        frames: forcedRebaseUpdates.length,
        medianUpdateMs: rounded(median(forcedRebaseUpdates)),
        maxUpdateMs: rounded(Math.max(...forcedRebaseUpdates)),
        completedBatchMsPerFrame: rounded((performance.now() - forcedBegin) / forcedRebaseUpdates.length),
        particleAttributeBytesPerFrame: count * 3 * 4,
      }
      benchmark.push({ count, framesPerMode: framesPerBatch * batches, cpu: modes[0], gpu: modes[1],
        timingConsistencyWarning: modes.some((mode) => mode.gpuDrawMs != null && mode.gpuDrawMs > mode.meanCompletedBatchMsPerFrame * 1.2)
          ? 'Per-draw GPU query time exceeds fenced completed-batch time per frame. Backend timer granularity or completion semantics are inconsistent here; completedBatchSpeedup is raw diagnostic data, not a validated rendering speedup.'
          : null,
        completedBatchSurface: `${framesPerBatch} separate 640×360 framebuffer tiles`,
        cpuParticleAttributeBytesPerFrame: count * 8 * 4,
        gpuParticleAttributeBytesPerOrdinaryFrame: 0,
        gpuRebaseAttributeBytesPerEvent: count * 3 * 4,
        gpuMeasuredRebases: rebaseCount,
        gpuMeasuredRebaseUpdateMs: rebaseUpdateTimes.map(rounded),
        gpuForcedRebaseEveryFrame: forcedRebase,
        gpuMeanParticleAttributeBytesPerFrame: count * 3 * 4 * rebaseCount / (framesPerBatch * batches),
        gpuInitialParticleAttributeBytes: count * 4 * 4,
        gpuFrameUniformPayloadBytesUpperBound: 18 * 4,
        completedBatchSpeedup: rounded(modes[0].meanCompletedBatchMsPerFrame / modes[1].meanCompletedBatchMsPerFrame),
        updateOnlySpeedup: rounded(modes[0].meanUpdateMs / modes[1].meanUpdateMs), invalidTimerQueries,
      })
      renderer.setRenderTarget(null)
      renderer.setViewport(0, 0, 640, 360)
      renderer.setScissorTest(false)
      batchTarget.dispose()
      pair.dispose()
    }
    check(shaderErrors.length === 0, shaderErrors.join('\n'))
    check(renderGl.getError() === renderGl.NO_ERROR, 'Benchmark GL error')
    renderer.dispose()
    return {
      environment: { renderer: rendererName, vendor: vendorName, softwareRequested, softwareDetected, crossOriginIsolated, viewport: [640, 360], antialias: false },
      parity: { passed: parityFailures.length === 0, failures: parityFailures, count: parityCount, cases: cases.length, maxErrors, tolerances, repeatedFrameExact: true, productionShaderCompiled: true, pixelComparisons, perCase },
      benchmark,
      timingNotes: [
        'Instrument-only microbenchmark; excludes editor, note-history evaluation, postprocessing, and export encoding.',
        'updateMs measures CPU legacy math/attribute dirty flags or production GPU uniform updates.',
        'updateMs and completedBatchMsPerFrame are medians across batches; meanUpdateMs/meanCompletedBatchMsPerFrame include every sampled frame, including the crossed rebase boundary. Reported speedups use means.',
        'renderSubmissionMs measures Three render calls, including uploads and driver submission; it is not GPU execution time.',
        'completedBatchMsPerFrame awaits explicit GPU fences at each batch boundary and measures completed throughput, not frame latency; includes asynchronous fence-poll scheduling overhead.',
        'If timingConsistencyWarning is present, GPU timer and completion-fence measurements disagree: retain the raw values but do not claim completedBatchSpeedup as a verified rendering or FPS gain. CPU update timings and attribute payload counts remain independently useful.',
        timer ? 'gpuDrawMs uses disjoint timer queries around render calls; includes buffer uploads and shader/draw work, excludes preceding CPU math.' : 'GPU timer extension unavailable: gpuDrawMs is null. Synchronized completed-batch timing remains available.',
        'Attribute bytes count the typed-array payload; uniform payload is a conservative upper bound, excluding shared camera/matrix uniforms and driver protocol overhead.',
        'Results apply only to the reported browser/GPU and do not predict whole-app FPS.',
      ],
    }
  }, { softwareRequested: software })
  assert.equal(result.parity.repeatedFrameExact, true)
  console.log(JSON.stringify({ browserChannel: channel, browserVersion: browser.version(), ...result }, null, 2))
  assert.equal(result.parity.passed, true, result.parity.failures.join('\n'))
} finally {
  await browser?.close()
  await new Promise((resolve) => server.close(resolve))
}
