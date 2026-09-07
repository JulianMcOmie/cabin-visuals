// Unsaved browser fixture: actual pixels, paused edits, viewport parking,
// and row alignment checked on EVERY scrolling frame.
import { chromium } from 'playwright'
import assert from 'node:assert/strict'
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] })
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  page.setDefaultTimeout(60000)
  const errors = []
  page.on('pageerror', error => errors.push(String(error)))
  await page.route(/supabase\.co\/(rest|auth|storage)/, r => r.abort())
  await page.goto(`${process.env.BASE ?? 'http://localhost:3191'}/editor`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => !!window.__cabinStores && !!window.__three)
  await page.evaluate(() => {
    const store = window.__cabinStores.project
    const p = store.getState()
    const tracks = Object.fromEntries(Array.from({ length: 40 }, (_, i) => {
      const id = `preview-${i}`
      return [id, { id, name: `Preview ${i}`, type: 'base', instrumentId: 'cube', parentId: null, childIds: [],
        params: { size: 1 }, stringParams: { baseColor: i % 2 ? '#0044ff' : '#ff2200' }, color: '#ff2200', muted: false, solo: false,
        blocks: [{ id: `${id}-block`, startBar: 0, durationBars: 4, loop: true, notes: [{ id: `${id}-note`, startBeat: 0, durationBeats: 2, pitch: 60, velocity: 100 }] }] }]
    }))
    const rootTrackIds = Object.keys(tracks)
    store.setState({ tracks, rootTrackIds, scenes: { ...p.scenes, [p.activeSceneId]: { ...p.scenes[p.activeSceneId], isMain: false, tracks, rootTrackIds } }, totalBars: 64 })
    window.__cabinStores.ui.setState({ tracksLabelWidth: 248, tracksRowHeight: 44, canvasView: 'scene' })
    window.__cabinStores.time.setState({ currentBeat: 0.5, isPlaying: false })
    window.previewPixels = id => {
      const canvas = document.querySelector(`[data-track-live-preview="${id}"]`)
      const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
      let red = 0, blue = 0, lit = 0, hash = 0
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] > data[i + 2] * 1.5 && data[i] > 40) red++
        if (data[i + 2] > data[i] * 1.5 && data[i + 2] > 40) blue++
        if (Math.max(data[i], data[i + 1], data[i + 2]) > 40) lit++
        hash = (Math.imul(hash, 31) + data[i] + data[i+1] * 3 + data[i+2] * 7) | 0
      }
      return { red, blue, lit, hash }
    }
  })
  await page.waitForFunction(() => document.querySelectorAll('[data-track-live-preview]').length === 40)
  await page.waitForFunction(() => window.previewPixels('preview-0').red > 20 && window.previewPixels('preview-1').blue > 20)
  const initial = await page.evaluate(() => [window.previewPixels('preview-0'), window.previewPixels('preview-1')])
  assert.equal(initial[0].blue, 0, 'red track does not contain blue neighbor')
  assert.equal(initial[1].red, 0, 'blue track does not contain red neighbor')
  await page.waitForTimeout(200)
  assert.equal(await page.evaluate(() => window.previewPixels('preview-0').hash), initial[0].hash, 'paused output stays frozen')
  await page.evaluate(() => window.__cabinStores.project.getState().setTrackStringParam('preview-0', 'baseColor', '#0044ff'))
  await page.waitForFunction(() => window.previewPixels('preview-0').blue > 20 && window.previewPixels('preview-0').red === 0)
  await page.evaluate(() => window.__cabinStores.project.getState().setTrackParam('preview-0', 'spinSpeed', 1))
  await page.waitForTimeout(300)
  const beforeScrub = await page.evaluate(() => window.previewPixels('preview-0').hash)
  await page.evaluate(() => window.__cabinStores.time.setState({ currentBeat: 1.1 }))
  await page.waitForFunction(hash => window.previewPixels('preview-0').hash !== hash, beforeScrub)
  await page.waitForTimeout(300)
  assert.equal(await page.evaluate(() => window.__three.internal.frames), 0, 'paused renderer returns to demand idle')
  const playbackFrames = await page.evaluate(async () => {
    const hashes = new Set()
    window.__cabinStores.time.setState({ isPlaying: true })
    for (let i = 0; i < 24; i++) {
      window.__cabinStores.time.setState({ currentBeat: 1.1 + i / 12 })
      await new Promise(resolve => setTimeout(resolve, 40))
      hashes.add(window.previewPixels('preview-0').hash)
    }
    window.__cabinStores.time.setState({ isPlaying: false })
    return hashes.size
  })
  assert.ok(playbackFrames > 2, 'live previews advance during playback')
  await page.waitForTimeout(300)
  const renderState = await page.evaluate(() => ({ mask: window.__three.camera.layers.mask, target: window.__three.gl.getRenderTarget(), scissor: window.__three.gl.getScissorTest() }))
  assert.equal(renderState.mask, 1, 'camera layer mask restored')
  assert.equal(renderState.target, null, 'main render target restored')
  assert.equal(renderState.scissor, false, 'scissor state restored')
  const stats = await page.evaluate(async () => {
    const sc = document.querySelector('[data-tracks-scroll]')
    const surfaces = [...document.querySelectorAll('[data-track-live-preview]')]
    const originalCanvases = new Set(surfaces)
    let maxError = 0
    const deltas = []
    let previous = performance.now()
    for (let i = 0; i < 90; i++) {
      await new Promise(requestAnimationFrame)
      const now = performance.now(); deltas.push(now - previous); previous = now
      sc.scrollTop = i * 12
      sc.scrollLeft = i * 5
      for (const canvas of surfaces) {
        const preview = canvas.getBoundingClientRect()
        const row = canvas.closest('.sticky').parentElement.getBoundingClientRect()
        maxError = Math.max(maxError, Math.abs((preview.top + preview.bottom - row.top - row.bottom) / 2))
      }
    }
    return { maxError, retained: [...document.querySelectorAll('[data-track-live-preview]')].every(c => originalCanvases.has(c)), p95: deltas.sort((a,b) => a-b)[85] }
  })
  assert.ok(stats.maxError < 0.1, `preview/row alignment: ${stats.maxError}px`)
  assert.ok(stats.retained, 'scrolling retains row canvases')
  await page.waitForFunction(() => window.previewPixels('preview-30').lit > 20)
  await page.evaluate(() => { const sc = document.querySelector('[data-tracks-scroll]'); sc.scrollTop = 0; sc.scrollLeft = 0 })
  await page.waitForTimeout(200)
  await page.screenshot({ path: '/tmp/track-live-previews.png' })
  const cadence = async hidden => {
    await page.evaluate(hidden => {
      document.querySelectorAll('[data-track-live-preview]').forEach(c => c.style.visibility = hidden ? 'hidden' : '')
      window.__cabinStores.ui.setState({ tracksLabelWidth: hidden ? 200 : 248 })
      document.querySelector('[data-tracks-scroll]').scrollTop = 0
    }, hidden)
    await page.waitForTimeout(500)
    return page.evaluate(async () => {
      const sc = document.querySelector('[data-tracks-scroll]')
      const durations = []; let previous = performance.now()
      for (let i = 0; i < 120; i++) {
        await new Promise(requestAnimationFrame)
        const now = performance.now(); durations.push(now - previous); previous = now
        sc.scrollTop = i * 10
      }
      durations.sort((a,b) => a-b)
      return { median: durations[60], p95: durations[114] }
    })
  }
  const baseline = await cadence(true)
  const withPreviews = await cadence(false)
  console.log(JSON.stringify({ baseline, withPreviews }))
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ result: 'PASS: isolated live colors, paused freeze/edit, retained canvases, per-frame scroll alignment, revealed rows', initial, ...stats }))
} finally { await browser.close() }
