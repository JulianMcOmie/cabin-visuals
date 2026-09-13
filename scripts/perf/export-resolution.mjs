// Run against a development server: BASE=http://127.0.0.1:3278 node scripts/perf/export-resolution.mjs
// HEADLESS=0 tries real tab/window backgrounding. REQUIRE_HIDDEN=1 makes this
// fail on test hosts that keep document.visibilityState forced to visible.
import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const browser = await chromium.launch({
  headless: process.env.HEADLESS !== '0',
  ignoreDefaultArgs: ['--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'],
  args: ['--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],
})
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const page = await context.newPage()
  const cdp = await context.newCDPSession(page)
  // Playwright normally forces focus, which also forces visibility in Chrome.
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: false })
  await page.goto(`${process.env.BASE ?? 'http://127.0.0.1:3278'}/editor`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForFunction(() => window.__cabinVisual?.getFrameDriver() && window.__capturePreview && window.__r3fState, null, { timeout: 60000 })
  await page.evaluate(() => {
    const { project, time } = window.__cabinStores
    const p = project.getState(), sceneId = p.activeSceneId
    const cube = { id: 'export-cube', name: 'Export cube', type: 'base', instrumentId: 'cube', muted: false, solo: false, color: '#00ffff', childIds: [], params: {},
      blocks: [{ id: 'cube-block', startBar: 0, durationBars: 1, loop: false, notes: [{ id: 'cube-note', startBeat: 0, durationBeats: 4, pitch: 60, velocity: 100 }] }] }
    const tracks = { [cube.id]: cube }
    const mainId = p.sceneOrder.find(id => p.scenes[id].isMain)
    const composition = { id: 'composition', name: 'Scene', type: 'base', instrumentId: 'scene', color: '#fff', muted: false, solo: false, childIds: [], blocks: [], sceneBindings: [{ sceneId, pitch: 60 }] }
    project.setState({ totalBars: 1, scenes: { ...p.scenes,
      [mainId]: { ...p.scenes[mainId], tracks: { composition }, rootTrackIds: ['composition'] },
      [sceneId]: { ...p.scenes[sceneId], tracks, rootTrackIds: [cube.id] },
    }, tracks, rootTrackIds: [cube.id] })
    time.setState({ currentBeat: 1, isPlaying: false })
    window.__resolutionSample = () => {
      const driver = window.__cabinVisual.getFrameDriver()
      driver.renderFrame(1, 500)
      const canvas = driver.getCanvas(), state = window.__r3fState(), gl = state.gl.getContext()
      const pixels = new Uint8Array(canvas.width * canvas.height * 4)
      gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
      let hash = 2166136261, lit = 0
      for (let i = 0; i < pixels.length; i++) { hash = Math.imul(hash ^ pixels[i], 16777619); if (i % 4 !== 3 && pixels[i] > 30) lit++ }
      return { width: canvas.width, height: canvas.height, dpr: state.viewport.dpr, aspect: state.camera.aspect, hash, lit }
    }
  })
  const samples = []
  for (const [width, height] of [[1920, 1080], [1080, 1920]]) {
    const before = await page.evaluate(async ({ width, height }) => {
      const driver = window.__cabinVisual.getFrameDriver()
      driver.pin(width, height)
      await driver.prepare(1)
      return window.__resolutionSample()
    }, { width, height })
    assert.ok(before.lit > 0, 'scene contains visible geometry')
    assert.equal(before.width, width)
    assert.equal(before.height, height)
    await page.setViewportSize({ width: 980, height: 760 })
    await page.waitForTimeout(400)
    const resized = await page.evaluate(() => window.__resolutionSample())
    assert.deepEqual(resized, before, 'resize must preserve pixels, camera and resolution')
    await page.evaluate(() => window.__r3fState().setDpr(2))
    const density = await page.evaluate(() => window.__resolutionSample())
    assert.deepEqual(density, before, 'display DPR changes must preserve the frame')
    const other = await page.context().newPage()
    await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: false })
    await other.bringToFront()
    await page.waitForTimeout(200)
    // Some desktop test runners put each target in a separate visible window.
    // Minimize the editor's test window in that case to really background it.
    const { windowId } = await cdp.send('Browser.getWindowForTarget')
    if (process.env.HEADLESS === '0' && await page.evaluate(() => document.visibilityState) === 'visible') {
      await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'minimized' } })
      await page.waitForTimeout(200)
    }
    const visibility = await page.evaluate(() => document.visibilityState)
    assert.deepEqual(await page.evaluate(() => window.__resolutionSample()), before, 'background frame must match foreground')
    if (process.env.HEADLESS === '0') await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } })
    if (process.env.REQUIRE_HIDDEN === '1') assert.equal(visibility, 'hidden')
    await other.close()
    await page.bringToFront()
    await page.evaluate(() => window.__cabinVisual.getFrameDriver().unpin())
    const restored = await page.evaluate(() => {
      const s = window.__r3fState(), bounds = s.gl.domElement.parentElement.getBoundingClientRect()
      return { width: s.size.width, height: s.size.height, cssWidth: bounds.width, cssHeight: bounds.height, dpr: s.viewport.dpr }
    })
    assert.ok(Math.abs(restored.width - restored.cssWidth) < 1, JSON.stringify(restored))
    assert.ok(Math.abs(restored.height - restored.cssHeight) < 1, JSON.stringify(restored))
    assert.equal(restored.dpr, 2)
    samples.push({ ...before, visibility, restored })
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.waitForTimeout(400)
  }

  // Exercise the real runExport/WebCodecs/mux path. Hold an async preparer
  // between frames so resize is guaranteed to land during encoder work.
  await page.evaluate(() => {
    const driver = window.__cabinVisual.getFrameDriver(), render = driver.renderFrame
    window.__encodedSizes = []
    driver.renderFrame = (beat, time) => {
      render(beat, time)
      const c = driver.getCanvas()
      window.__encodedSizes.push([c.width, c.height])
    }
    const preparer = async () => {
      if (window.__encodedSizes.length === 5) await new Promise(resolve => { window.__releaseExport = resolve })
    }
    window.__cabinVisual.framePreparers.add(preparer)
    window.__exportResult = window.__capturePreview().then(async base64 => {
      if (!base64) throw new Error('No export produced')
      const blob = new Blob([Uint8Array.from(atob(base64), c => c.charCodeAt(0))], { type: 'video/mp4' })
      const video = document.createElement('video'), url = URL.createObjectURL(blob)
      try {
        await new Promise((resolve, reject) => { video.onloadedmetadata = resolve; video.onerror = reject; video.src = url })
        return { width: video.videoWidth, height: video.videoHeight, duration: video.duration, bytes: blob.size, sizes: window.__encodedSizes }
      } finally { URL.revokeObjectURL(url) }
    }).finally(() => { driver.renderFrame = render; window.__cabinVisual.framePreparers.delete(preparer) })
  })
  await page.waitForFunction(() => window.__releaseExport)
  await page.setViewportSize({ width: 1050, height: 800 })
  await page.waitForTimeout(400)
  await page.evaluate(() => window.__releaseExport())
  const mp4 = await page.evaluate(() => window.__exportResult)
  assert.equal(mp4.width, 640)
  assert.equal(mp4.height, 360)
  assert.ok(mp4.sizes.length >= 60)
  assert.ok(mp4.sizes.every(([w, h]) => w === 640 && h === 360))

  const loss = await page.evaluate(async () => {
    const driver = window.__cabinVisual.getFrameDriver()
    driver.pin(640, 360)
    await driver.prepare(1)
    const gl = window.__r3fState().gl.getContext(), extension = gl.getExtension('WEBGL_lose_context')
    if (!extension) throw new Error('Context-loss extension unavailable')
    extension.loseContext()
    try { driver.renderFrame(1, 0); return 'unexpected success' }
    catch (error) { return error.message }
    finally { driver.unpin() }
  })
  assert.match(loss, /graphics context was lost/)
  console.log(JSON.stringify({ hiddenTabVerified: samples.every(sample => sample.visibility === 'hidden'), samples, mp4: { ...mp4, sizes: `${mp4.sizes.length} frames at 640×360` }, loss }, null, 2))
} finally { await browser.close() }
