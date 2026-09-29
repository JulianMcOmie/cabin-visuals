// Standalone GPU canvas → WebCodecs throughput probe; no editor server needed.
// node --import tsx scripts/perf/export-encode-probe.mjs
// GROUP=capture|encoder|parallel|all (default all), SHORT_EDGES=1080,2160,
// FRAMES=180, REPEATS=2, HEADLESS=0, BROWSER_CHANNEL=chrome|chromium,
// ATTACH_CANVAS=1 also exercises presentation in the browser compositor.
// OUTPUT=artifacts/export-performance/encoder-profile.json.
// Uses the production encoder config, quality latency (no frame dropping),
// deterministic moving gradients, full-frame grain, and bright particle speckles.
// Parallel cases model separate contiguous chunks, not a single muxable stream.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { chromium } from 'playwright'
import { exportEncoderConfig, exportEncodeOptions } from '../../src/editor/core/export/videoEncode.ts'
import { defaultBitrate } from '../../src/editor/core/export/types.ts'

const group = process.env.GROUP ?? 'all'
assert(['all', 'capture', 'encoder', 'parallel'].includes(group), 'Unknown GROUP')
const frameCount = Number(process.env.FRAMES ?? 180)
const repeats = Number(process.env.REPEATS ?? 2)
const attachCanvas = process.env.ATTACH_CANVAS === '1'
const edges = (process.env.SHORT_EDGES ?? '1080,2160').split(',').map(Number)
assert(Number.isInteger(frameCount) && frameCount > 0, 'FRAMES must be a positive integer')
assert(Number.isInteger(repeats) && repeats > 0, 'REPEATS must be a positive integer')
assert(edges.every(e => e === 720 || e === 1080 || e === 2160), 'Unsupported SHORT_EDGES')
const cases = []
for (const height of edges) {
  const width = height * 16 / 9
  const add = (name, changes = {}) => {
    const options = { mode: 'quality', hardwareAcceleration: 'no-preference', queue: 2,
      frameAlpha: 'keep', preserveDrawingBuffer: true, parallel: 1, ...changes }
    const settings = { width, height, fps: 60, videoBitrate: defaultBitrate(height, 60), rateControl: options.mode }
    cases.push({ name, width, height, ...options,
      config: { ...exportEncoderConfig(settings), hardwareAcceleration: options.hardwareAcceleration },
      encodeOptions: exportEncodeOptions(settings), frameCount })
  }
  if (group === 'all' || group === 'capture') {
    add('capture: preserved / alpha kept')
    add('capture: discarded buffer / alpha kept', { preserveDrawingBuffer: false })
    add('capture: preserved / alpha discarded', { frameAlpha: 'discard' })
    add('capture: discarded buffer / alpha discarded', { preserveDrawingBuffer: false, frameAlpha: 'discard' })
  }
  if (group === 'all' || group === 'encoder') {
    add('encoder: quality')
    add('encoder: quality / hardware', { hardwareAcceleration: 'prefer-hardware' })
    add('encoder: quality / software', { hardwareAcceleration: 'prefer-software' })
    add('encoder: quality / queue 8', { queue: 8 })
    add('encoder: bitrate', { mode: 'bitrate' })
    add('encoder: bitrate / hardware', { mode: 'bitrate', hardwareAcceleration: 'prefer-hardware' })
    add('encoder: bitrate / software', { mode: 'bitrate', hardwareAcceleration: 'prefer-software' })
    add('encoder: lossless setting', { mode: 'lossless' })
  }
  if (group === 'all' || group === 'parallel') {
    for (const mode of ['quality', 'bitrate']) {
      for (const parallel of [1, 2, 4]) add(`parallel: ${mode} / ${parallel} sessions`, { mode, parallel })
    }
  }
}

const server = createServer((_request, response) => {
  response.setHeader('Content-Type', 'text/html')
  response.end('<!doctype html><title>Cabin export encoder throughput</title>')
})
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
let browser
try {
  const channel = process.env.BROWSER_CHANNEL ?? 'chrome'
  browser = await chromium.launch({ headless: process.env.HEADLESS !== '0', ...(channel === 'chromium' ? {} : { channel }) })
  const browserSession = await browser.newBrowserCDPSession()
  const system = await browserSession.send('SystemInfo.getInfo')
  const page = await browser.newPage()
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  await page.exposeFunction('reportEncodeProbe', value => console.log(JSON.stringify(value)))
  const result = await page.evaluate(async ({ cases, repeats, attachCanvas }) => {
    const round = value => Number(value.toFixed(2))
    const run = async (testCase, frameCount) => {
      const { width, height, config, queue, encodeOptions, frameAlpha, parallel, preserveDrawingBuffer } = testCase
      const support = await VideoEncoder.isConfigSupported(config)
      if (!support.supported) return { supported: false }
      const canvas = document.createElement('canvas')
      canvas.width = width; canvas.height = height
      if (attachCanvas) {
        canvas.style.cssText = 'width:640px;height:360px'
        document.body.append(canvas)
      }
      const gl = canvas.getContext('webgl2', { alpha: true, antialias: false, preserveDrawingBuffer })
      if (!gl) throw Error('WebGL 2 unavailable')
      const shader = (type, source) => {
        const result = gl.createShader(type)
        gl.shaderSource(result, source); gl.compileShader(result)
        if (!gl.getShaderParameter(result, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(result))
        return result
      }
      const program = gl.createProgram()
      gl.attachShader(program, shader(gl.VERTEX_SHADER, '#version 300 es\nvoid main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.-1.,0.,1.);}'))
      gl.attachShader(program, shader(gl.FRAGMENT_SHADER, `#version 300 es
        precision highp float; uniform float i; out vec4 color;
        void main() {
          vec2 uv = gl_FragCoord.xy / vec2(${width}., ${height}.);
          float n = fract(sin(dot(gl_FragCoord.xy + vec2(i), vec2(12.9898,78.233))) * 43758.5453);
          float rings = pow(.5 + .5 * sin(uv.x*60. + uv.y*40. + i*.15), 4.);
          color = vec4(vec3(uv.x*.3,uv.y*.2,rings*.6) + n*.1 + step(.975,n)*vec3(.5,.3,1.), 1.);
        }`))
      gl.linkProgram(program)
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(program))
      gl.useProgram(program)
      const uniform = gl.getUniformLocation(program, 'i')
      gl.uniform1f(uniform, 0); gl.drawArrays(gl.TRIANGLES, 0, 3); gl.finish()
      let error = null, bytes = 0, outputFrames = 0, captureMs = 0, renderMs = 0, enqueueMs = 0, waitMs = 0
      const encoders = Array.from({ length: parallel }, () => new VideoEncoder({
        output: chunk => { bytes += chunk.byteLength; outputFrames++ },
        error: e => { error = e },
      }))
      try {
        const start = performance.now()
        encoders.forEach(encoder => encoder.configure(config))
        const perStream = Math.ceil(frameCount / parallel)
        const actualFrameCount = perStream * parallel
        for (let submitted = 0; submitted < actualFrameCount; submitted++) {
          const stream = submitted % parallel
          const localFrame = Math.floor(submitted / parallel)
          const frameIndex = stream * perStream + localFrame
          const encoder = encoders[stream]
          let t = performance.now()
          gl.uniform1f(uniform, frameIndex); gl.drawArrays(gl.TRIANGLES, 0, 3)
          renderMs += performance.now() - t
          t = performance.now()
          const frame = new VideoFrame(canvas, { timestamp: Math.round(localFrame * 1e6 / 60), duration: 16667, alpha: frameAlpha })
          captureMs += performance.now() - t
          t = performance.now()
          encoder.encode(frame, { keyFrame: localFrame % 120 === 0, ...encodeOptions })
          frame.close(); enqueueMs += performance.now() - t
          t = performance.now()
          while (encoder.encodeQueueSize > queue && !error) {
            await new Promise(resolve => encoder.addEventListener('dequeue', resolve, { once: true }))
          }
          waitMs += performance.now() - t
          if (error) throw error
        }
        const flushStart = performance.now()
        await Promise.all(encoders.map(encoder => encoder.flush()))
        if (error) throw error
        const totalMs = performance.now() - start
        if (outputFrames !== actualFrameCount) throw Error(`Expected ${actualFrameCount} frames, received ${outputFrames}`)
        return { supported: true, inputFrames: actualFrameCount, outputFrames, totalMs: round(totalMs),
          fps: round(actualFrameCount * 1000 / totalMs), renderMs: round(renderMs), captureMs: round(captureMs),
          enqueueMs: round(enqueueMs), waitMs: round(waitMs), flushMs: round(performance.now() - flushStart), megabytes: round(bytes / 1e6) }
      } finally {
        encoders.forEach(encoder => { if (encoder.state !== 'closed') encoder.close() })
        gl.getExtension('WEBGL_lose_context')?.loseContext()
        canvas.remove()
      }
    }
    const warmupStart = performance.now()
    await run({ ...cases[0], parallel: 1 }, 30)
    const warmupMs = round(performance.now() - warmupStart)
    await window.reportEncodeProbe({ warmupMs })
    const results = []
    for (let repeat = 0; repeat < repeats; repeat++) {
      // Reverse the second pass so fixed ordering does not conceal thermal drift.
      for (const testCase of repeat % 2 ? [...cases].reverse() : cases) {
        const result = { ...testCase, repeat, ...await run(testCase, testCase.frameCount) }
        results.push(result)
        await window.reportEncodeProbe(result)
      }
    }
    return { warmupMs, results }
  }, { cases, repeats, attachCanvas })
  const artifact = { measuredAt: new Date().toISOString(), browser: browser.version(),
    gpu: system.gpu.devices, featureStatus: system.gpu.featureStatus, modelName: system.modelName, modelVersion: system.modelVersion,
    fixture: 'Moving color gradients, dynamic 10% grain, and bright particle speckles. 60fps H264, quality latency, no mux/audio/editor.',
    caveats: ['Timings include GPU frame capture and encode flush.', 'Parallel sessions output separate contiguous chunks; mux integration is not implemented.', 'FPS is an encoder ceiling for this synthetic fixture, not complete editor export speed.'],
    group, attachCanvas, ...result }
  const outputPath = resolve(process.env.OUTPUT ?? 'artifacts/export-performance/encoder-profile.json')
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, JSON.stringify(artifact, null, 2) + '\n')
  console.log(`Saved ${outputPath}`)
} finally {
  await browser?.close()
  server.close()
}
