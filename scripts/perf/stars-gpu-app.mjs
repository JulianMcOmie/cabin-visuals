// Full editor smoke: BASE=http://127.0.0.1:3104 node scripts/perf/stars-gpu-app.mjs
// Runs in a fresh browser context; never loads/saves the user's project.
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'

const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => { if (m.type() === 'error' && /shader|VALIDATE|WebGLProgram/i.test(m.text())) errors.push(m.text()) })
  await page.route(/supabase\.co\/(rest|auth|storage)/, (r) => r.abort())
  await page.goto(`${process.env.BASE ?? 'http://127.0.0.1:3104'}/editor`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => !!window.__three && !!window.__cabinStores, null, { timeout: 120000 })
  await page.evaluate(() => {
    const p = window.__cabinStores.project.getState()
    for (const id of Object.keys(p.tracks)) p.deleteTrack(id)
    p.addTrack({
      id: 'stars-gpu-smoke', name: 'GPU Stars', type: 'base', instrumentId: 'stars',
      params: { starCount: 3000, dotSize: 2, speed: 2, drift: 0.1, tint: 220, ground: 0 },
      color: '#65aaff', muted: false, solo: false, childIds: [], effects: [],
      blocks: [{ id: 'stars-block', startBar: 0, durationBars: 32,
        notes: [48, 50, 54, 56, 57, 58, 59].map((pitch, i) => ({ id: `star-note-${i}`, pitch, startBeat: i * 0.25, durationBeats: 4, velocity: 90 })) }],
    })
    const gl = window.__three.gl
    const render = gl.render.bind(gl)
    gl.render = (scene, camera) => {
      window.__starsScenes ??= new Set()
      window.__starsScenes.add(scene)
      scene.traverse((o) => { if (o.name === 'Stars GPU') window.__starsTest = o })
      return render(scene, camera)
    }
  })
  await page.waitForFunction(() => !!window.__starsTest, null, { timeout: 60000 })
  // Exercise the schema-bound inspector control as well as direct render data.
  // Stars uses the custom pointer slider, so drag through its actual DOM track.
  await page.evaluate(() => window.__cabinStores.ui.getState().setSelectedTrackId('stars-gpu-smoke'))
  const starsPanel = page.getByTestId('stars-user-interface')
  await starsPanel.waitFor({ state: 'visible' })
  const countSlider = starsPanel.locator('span[title="Stars"]').locator('..').locator(':scope > div')
  const countBounds = await countSlider.boundingBox()
  assert.ok(countBounds, 'Stars count control must be visible')
  await page.mouse.move(countBounds.x + countBounds.width / 2, countBounds.y + countBounds.height / 2)
  await page.mouse.down()
  await page.mouse.move(countBounds.x + countBounds.width + 2, countBounds.y + countBounds.height / 2)
  await page.mouse.up()
  const uiControlMax = await page.evaluate(() => window.__cabinStores.project.getState().tracks['stars-gpu-smoke'].params.starCount)
  assert.equal(uiControlMax, Number(process.env.EXPECT_MAX ?? 100000), 'Stars inspector must expose the renderer ceiling')
  await page.evaluate(() => {
    window.__cabinStores.project.getState().setTrackParam('stars-gpu-smoke', 'starCount', 3000)
    window.__cabinStores.ui.getState().setSelectedTrackId(null)
  })
  await page.waitForTimeout(1500)
  const result = await page.evaluate(async () => {
    const three = window.__three
    const gl = three.gl
    const stores = window.__cabinStores
    const currentStar = () => {
      let found = null
      for (const scene of window.__starsScenes) scene.traverse((o) => { if (o.name === 'Stars GPU') found = o })
      return found
    }
    const render = (beat, unbounded = false) => {
      // The public transport clamps to project length. Inject one synthetic
      // long playhead only for the precision stress case, then return normally.
      if (unbounded) stores.time.setState({ currentBeat: beat })
      else stores.time.getState().setCurrentBeat(beat)
      three.advance(performance.now(), true)
      const ctx = gl.getContext(), w = ctx.drawingBufferWidth, h = ctx.drawingBufferHeight
      const pixels = new Uint8Array(w * h * 4)
      ctx.readPixels(0, 0, w, h, ctx.RGBA, ctx.UNSIGNED_BYTE, pixels)
      let hash = 2166136261, lit = 0
      for (let i = 0; i < pixels.length; i++) hash = Math.imul(hash ^ pixels[i], 16777619) >>> 0
      for (let i = 0; i < pixels.length; i += 4) if (pixels[i] + pixels[i + 1] + pixels[i + 2] > 150) lit++
      return { hash, lit, beat: stores.time.getState().currentBeat }
    }
    const star = window.__starsTest
    const versions = () => Object.fromEntries(Object.entries(star.geometry.attributes).map(([k, a]) => [k, a.version]))
    const before = versions()
    const frames = [0, 2, 8, 1, 8, 0].map((beat) => render(beat))
    const after = versions()
    stores.project.getState().setTrackParam('stars-gpu-smoke', 'tfOpacity', 0.25)
    render(2)
    const faded = { opacity: star.material.uniforms.uOpacity.value, transparent: star.material.transparent }
    stores.project.getState().setTrackParam('stars-gpu-smoke', 'tfOpacity', 1)
    render(2)
    const restored = star.material.uniforms.uOpacity.value
    // A ray through the center must execute the custom picking mirror without
    // ever dirtying the home-position attribute used for rendering.
    three.raycaster.setFromCamera({ x: 0, y: 0 }, three.camera)
    const hits = []
    star.raycast(three.raycaster, hits)
    const pickObjectsCorrect = hits.every((hit) => hit.object === star)
    const afterPick = versions()
    const longFrames = [30000, 0, 8].map((beat) => render(beat, beat === 30000))
    const afterLongSeek = versions()
    stores.project.getState().setTrackParam('stars-gpu-smoke', 'starCount', 100000)
    three.advance(performance.now(), true)
    const dense = currentStar()
    const denseCount = dense.geometry.drawRange.count
    const denseFrame = render(8)
    stores.project.getState().setTrackParam('stars-gpu-smoke', 'starCount', 3000)
    three.advance(performance.now(), true)
    render(2)
    const current = currentStar()
    const ground = () => current.parent.children.find((o) => o.children.some((child) => child.isLineSegments))
    const versionsBeforeGround = Object.fromEntries(Object.entries(current.geometry.attributes).map(([k, a]) => [k, a.version]))
    stores.project.getState().setTrackParam('stars-gpu-smoke', 'ground', 1)
    stores.project.getState().setTrackParam('stars-gpu-smoke', 'groundY', -2)
    stores.project.getState().setTrackStringParam('stars-gpu-smoke', 'groundColor', '#12ab67')
    render(2)
    const grid = ground()
    const groundState = grid && { y: grid.position.y, color: grid.children[0].material.color.getHexString(), vertices: grid.children[0].geometry.attributes.position.count }
    stores.project.getState().setTrackParam('stars-gpu-smoke', 'ground', 0)
    render(2)
    const groundRemoved = !ground()
    stores.project.getState().setTrackStringParam('stars-gpu-smoke', 'bgColor', '#112244')
    const backgroundA = render(0)
    let scene = current
    while (scene.parent) scene = scene.parent
    const backgroundColor = scene.background?.getHexString()
    stores.project.getState().setTrackStringParam('stars-gpu-smoke', 'bgColor', '#441122')
    const backgroundB = render(0)
    const versionsAfterGround = Object.fromEntries(Object.entries(current.geometry.attributes).map(([k, a]) => [k, a.version]))
    return { before, after, afterPick, afterLongSeek, longFrames, frames, faded, restored, pickObjectsCorrect, pickHits: hits.length, denseCount, denseFrame,
      groundState, groundRemoved, backgroundColor, backgroundA, backgroundB, versionsBeforeGround, versionsAfterGround,
      attributes: Object.keys(dense.geometry.attributes), programs: gl.info.programs.map((p) => ({ runnable: p.diagnostics?.runnable ?? true })) }
  })
  result.uiControlMax = uiControlMax
  assert.deepEqual(result.before, result.after, 'playback must not upload particle buffers')
  assert.deepEqual(result.after, result.afterPick, 'picking must not upload particle buffers')
  assert.equal(result.frames[2].hash, result.frames[4].hash, 'backward seek must reproduce beat 8')
  assert.equal(result.frames[0].hash, result.frames[5].hash, 'backward seek must reproduce beat 0')
  assert.notEqual(result.frames[0].hash, result.frames[2].hash, 'notes must animate the image')
  assert.equal(result.longFrames[0].beat, 30000, 'precision check must reach the requested synthetic playhead')
  assert.equal(result.longFrames[1].hash, result.frames[0].hash, 'return from beat 30000 must reproduce beat 0')
  assert.equal(result.longFrames[2].hash, result.frames[2].hash, 'return from beat 30000 must reproduce beat 8')
  assert.ok(result.afterLongSeek.position > result.afterPick.position, 'long displacement should rebase the home positions')
  assert.equal(result.afterLongSeek.aParallax, result.afterPick.aParallax, 'rebasing must keep fixed star parallax')
  assert.ok(result.frames.every((f) => f.lit > 0), 'stars must actually draw')
  assert.equal(result.faded.opacity, 0.25)
  assert.equal(result.faded.transparent, true)
  assert.equal(result.restored, 1)
  assert.equal(result.pickObjectsCorrect, true)
  assert.equal(result.denseCount, Number(process.env.EXPECT_MAX ?? 100000))
  assert.equal(result.groundState?.y, -2)
  assert.equal(result.groundState?.color, '12ab67')
  assert.ok(result.groundState.vertices > 0)
  assert.equal(result.groundRemoved, true)
  assert.equal(result.backgroundColor, '112244')
  assert.notEqual(result.backgroundA.hash, result.backgroundB.hash, 'background edits must change real pixels')
  assert.deepEqual(result.versionsBeforeGround, result.versionsAfterGround, 'ground/background edits must not upload particle buffers')
  assert.ok(result.programs.every((p) => p.runnable))
  await mkdir('artifacts/stars-gpu', { recursive: true })

  // Stagger creates independent copy clocks. Observe live mounted occurrences,
  // not a cached Points reference left behind by the structural remount.
  await page.evaluate(() => {
    window.__cabinStores.project.getState().addTrack({ id: 'stars-stagger', name: 'Stagger check',
      type: 'splitter', splitterId: 'stagger', parentId: 'stars-gpu-smoke', inputValues: { copies: 2, duration: 8 },
      color: '#65aaff', muted: false, solo: false, childIds: [], effects: [], blocks: [] })
    window.__cabinStores.time.getState().setCurrentBeat(2)
  })
  await page.waitForFunction(() => {
    window.__three.advance(performance.now(), true)
    const stars = new Set()
    for (const scene of window.__starsScenes) scene.traverse((o) => { if (o.name === 'Stars GPU') stars.add(o) })
    return stars.size === 2
  }, null, { timeout: 30000 })
  result.copies = await page.evaluate(() => {
    const stars = new Set()
    for (const scene of window.__starsScenes) scene.traverse((o) => { if (o.name === 'Stars GPU') stars.add(o) })
    return [...stars].map((o) => ({ displacement: o.material.uniforms.uDisplacement.value.toArray(),
      count: o.geometry.drawRange.count, versions: Object.values(o.geometry.attributes).map((a) => a.version) }))
  })
  assert.equal(result.copies.length, 2)
  assert.notDeepEqual(result.copies[0].displacement, result.copies[1].displacement, 'staggered copies must receive independent musical clocks')

  // Return to the authored default appearance for the review screenshot and a
  // short real MP4. No stress-test streak/pulse/warp notes in the final artifact.
  await page.evaluate(() => {
    const p = window.__cabinStores.project.getState()
    p.deleteTrack('stars-stagger')
    p.updateBlockNotes('stars-gpu-smoke', 'stars-block', [])
    for (const [key, value] of Object.entries({ starCount: 1500, dotSize: 2, speed: 1, drift: 0.1, tint: 220, ground: 0 })) p.setTrackParam('stars-gpu-smoke', key, value)
    p.setTrackStringParam('stars-gpu-smoke', 'bgColor', '#0a0a0f')
    window.__cabinStores.time.getState().setCurrentBeat(0)
    window.__cabinStores.time.getState().setLoopRegion({ startBeat: 0, endBeat: 1 })
  })
  await page.waitForTimeout(1500)
  await page.evaluate(() => window.__three.advance(performance.now(), true))
  await page.screenshot({ path: 'artifacts/stars-gpu/editor.png' })

  const exportButton = page.getByRole('button', { name: 'Export', exact: true })
  if (await exportButton.getAttribute('aria-disabled') === 'true') {
    await exportButton.click()
    result.export = { status: 'unsupported', explanation: await page.locator('body').innerText() }
  } else {
    await exportButton.click()
    await page.getByRole('button', { name: 'Loop region', exact: true }).click()
    await page.locator('label').filter({ hasText: 'Resolution' }).locator('select').selectOption('720')
    await page.locator('label').filter({ hasText: 'FPS' }).locator('select').selectOption('30')
    await page.locator('label').filter({ hasText: 'File name' }).locator('input').fill('stars-gpu-smoke')
    const audio = page.getByRole('switch')
    if (await audio.isEnabled() && await audio.getAttribute('aria-checked') === 'true') await audio.click()
    const completed = Promise.race([
      page.waitForEvent('download', { timeout: 120000 }).then((download) => ({ download })),
      page.getByText(/^Export failed:/).waitFor({ state: 'visible', timeout: 120000 }).then(async () => ({ error: await page.getByText(/^Export failed:/).innerText() })),
    ])
    await page.getByRole('button', { name: /^Export ·/ }).click()
    const exported = await completed
    assert.ok(!exported.error, exported.error)
    const path = 'artifacts/stars-gpu/stars-gpu-smoke.mp4'
    await exported.download.saveAs(path)
    const bytes = await readFile(path)
    assert.equal(bytes.toString('ascii', 4, 8), 'ftyp', 'download must be an MP4 container')
    assert.ok(bytes.includes(Buffer.from('moov')), 'MP4 must contain movie metadata')
    result.export = { status: 'complete', path, bytes: (await stat(path)).size, rangeBeats: 1, fps: 30, width: 1280, height: 720 }
    await page.screenshot({ path: 'artifacts/stars-gpu/export.png' })
  }
  assert.deepEqual(errors, [])
  await writeFile('artifacts/stars-gpu/app-smoke.json', JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result, null, 2))
} finally {
  await browser.close()
}
