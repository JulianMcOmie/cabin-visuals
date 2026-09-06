// Dense timeline probe with no instrument/GPU workload.
// BASE=http://localhost:3091 node scripts/perf/timeline-density.mjs [play|scroll|drag|resize|zoom]
// TRACKS=100 BLOCKS=8 NOTES=128 scales to 102,400 notes; VERIFY=1 checks viewport lifecycle.
// ROLL=1 TRACKS=1 BLOCKS=1 NOTES=4096 profiles an open piano roll.
// HEADED=1 uses a visible browser; default headless isolates timeline rendering.
import { chromium } from 'playwright'
import assert from 'node:assert/strict'
const scenario = process.argv[2] ?? 'play'
const progress = message => { if (process.env.PROGRESS) console.error(message) }
const trackCount = Number(process.env.TRACKS ?? 30)
const blocksPerTrack = Number(process.env.BLOCKS ?? 8)
const notesPerBlock = Number(process.env.NOTES ?? 128)
const browser = await chromium.launch({ headless: !process.env.HEADED, args: ['--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] })
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  page.setDefaultTimeout(60000)
  progress('loading editor')
  await page.route(/supabase\.co\/(rest|auth|storage)/, (r) => r.abort())
  const errors = []
  page.on('pageerror', e => errors.push(String(e)))
  await page.goto(`${process.env.BASE ?? 'http://localhost:3091'}/editor`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => !!window.__cabinStores && !!window.__three)
  await page.evaluate(({ trackCount, blocksPerTrack, notesPerBlock }) => {
    const p = window.__cabinStores.project.getState()
    const sceneId = p.activeSceneId
    const tracks = {}
    for (let row = 0; row < trackCount; row++) {
      const id = `density-track-${row}`
      tracks[id] = { id, name: `MIDI ${row + 1}`, type: 'base', parentId: null, childIds: [], params: {}, stringParams: {}, color: '#65aaff', muted: false, solo: false,
        blocks: Array.from({ length: blocksPerTrack }, (_, k) => ({ id: `${id}-block-${k}`, startBar: k * 8, durationBars: 8, loop: false,
          notes: Array.from({ length: notesPerBlock }, (_, n) => ({ id: `${id}-${k}-note-${n}`, startBeat: n * 32 / notesPerBlock, durationBeats: 0.2, pitch: 48 + n % 24, velocity: 100 })) })) }
    }
    const rootTrackIds = Object.keys(tracks)
    window.__cabinStores.project.setState({ tracks, rootTrackIds, scenes: { ...p.scenes, [sceneId]: { ...p.scenes[sceneId], tracks, rootTrackIds } }, totalBars: blocksPerTrack * 8 })
  }, { trackCount, blocksPerTrack, notesPerBlock })
  progress('fixture inserted')
  await page.waitForFunction(count => document.querySelectorAll('[data-block-id]').length === count, trackCount * blocksPerTrack)
  if (process.env.ROLL) {
    await page.evaluate(() => window.__cabinStores.ui.getState().setEditingBlock({ trackId: 'density-track-0', blockId: 'density-track-0-block-0' }))
    await page.waitForFunction(() => document.querySelectorAll('[data-note-id]').length > 0)
    await page.waitForTimeout(700)
  }
  await page.evaluate(roll => {
    const sc = roll ? document.querySelector('[data-note-id]').closest('.overflow-auto') : document.querySelector('[data-tracks-scroll]')
    sc.setAttribute('data-perf-scroll', '')
  }, !!process.env.ROLL)
  await page.waitForTimeout(2000)
  if (process.env.OUT_SHOT) await page.locator('[data-perf-scroll]').screenshot({ path: process.env.OUT_SHOT })
  const info = await page.evaluate(() => {
    const sc = document.querySelector('[data-perf-scroll]'); const r = sc.getBoundingClientRect()
    return { blocks: document.querySelectorAll('[data-block-id]').length, notes: document.querySelectorAll('[data-midi-preview-key]').length, rollNotes: document.querySelectorAll('[data-note-id]').length, visibleBlocks: [...document.querySelectorAll('[data-block-id]')].filter(e => { const b=e.getBoundingClientRect(); return b.right > r.left && b.left < r.right && b.bottom > r.top && b.top < r.bottom }).length }
  })
  progress('starting profile')
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Profiler.enable')
  await cdp.send('Profiler.setSamplingInterval', { interval: 250 })
  const events=[]
  cdp.on('Tracing.dataCollected', ({value}) => events.push(...value))
  await page.evaluate(() => {
    window.__midiWrites = 0; window.__gaps=[]
    const orig = CSSStyleDeclaration.prototype.setProperty
    CSSStyleDeclaration.prototype.setProperty = function(k, ...args) { if(k.startsWith('--midi-')) window.__midiWrites++; return orig.call(this, k, ...args) }
    let last=performance.now()
    const tick=()=> { const n=performance.now(); window.__gaps.push(n-last); last=n; window.__probeRaf=requestAnimationFrame(tick) }; window.__probeRaf=requestAnimationFrame(tick)
  })
  await cdp.send('Profiler.start')
  await cdp.send('Tracing.start', { categories: 'devtools.timeline,disabled-by-default-devtools.timeline', transferMode: 'ReportEvents' })
  if(scenario==='play') {
    await page.keyboard.press('Space'); await page.waitForTimeout(6000); await page.keyboard.press('Space')
  } else if(scenario==='scroll') {
    for(let i=0;i<60;i++) {
      await page.evaluate(i=>{ const sc=document.querySelector('[data-perf-scroll]'); sc.scrollTop=(sc.scrollHeight-sc.clientHeight)*(0.5-0.5*Math.cos(i/59*Math.PI*2)); sc.scrollLeft=(sc.scrollWidth-sc.clientWidth)*(0.5-0.5*Math.cos(i/59*Math.PI*2)) },i)
      await page.waitForTimeout(30)
    }
  } else if (scenario === 'resize') {
    const grab = page.locator('div.cursor-ns-resize').first()
    const b = await grab.boundingBox()
    const before = await page.evaluate(() => window.__cabinStores.ui.getState().topPanelFraction)
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
    await page.mouse.down()
    for (let i = 0; i < 60; i++) {
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2 - 180 * Math.sin(i / 59 * Math.PI * 2))
      await page.waitForTimeout(16)
    }
    assert.equal(await page.evaluate(() => window.__cabinStores.ui.getState().topPanelFraction), before, 'resize must not stream through the store')
    await page.mouse.up()
  } else if (scenario === 'zoom') {
    const sc = await page.locator('[data-perf-scroll]').boundingBox()
    await page.mouse.move(sc.x + sc.width / 2, sc.y + sc.height / 2)
    await page.keyboard.down('Alt')
    for (let i = 0; i < 60; i++) {
      if (i % 15 === 0) progress(`zoom step ${i}`)
      await page.mouse.wheel(0, i < 30 ? -8 : 8)
      await page.waitForTimeout(16)
    }
    await page.keyboard.up('Alt')
  } else {
    const before = await page.evaluate(() => window.__cabinStores.project.getState().tracks['density-track-0'].blocks[0].startBar)
    const block=page.locator('[data-block-id]').first(); const b=await block.boundingBox()
    await page.mouse.move(b.x+30,b.y+b.height/2); await page.mouse.down()
    for(let i=0;i<60;i++) { await page.mouse.move(b.x+30+i*2,b.y+b.height/2); await page.waitForTimeout(16) }
    await page.mouse.up()
    const after = await page.evaluate(() => window.__cabinStores.project.getState().tracks['density-track-0'].blocks[0].startBar)
    assert.ok(after > before, 'the drag must move the block')
  }
  if (scenario === 'zoom') await page.waitForFunction(() => !document.querySelector('[data-row-zooming]'))
  progress('stopping profile')
  const {profile}=await cdp.send('Profiler.stop')
  const done=new Promise(r=>cdp.once('Tracing.tracingComplete',r)); await cdp.send('Tracing.end'); await done
  const stats=await page.evaluate(()=> { cancelAnimationFrame(window.__probeRaf); const a=window.__gaps.sort((a,b)=>a-b); return {frames:a.length, p95:a[Math.floor(a.length*.95)], midiStyleWrites:window.__midiWrites, promotedPulses:[...document.querySelectorAll('[data-midi-activity-pulse]')].filter(e=>e.style.willChange==='opacity').length} })
  const byId=new Map(profile.nodes.map(n=>[n.id,n])); const self=new Map()
  for(let i=0;i<profile.samples.length;i++) { const f=byId.get(profile.samples[i]).callFrame; const key=`${f.functionName} @ ${f.url.split('/').pop()}:${f.lineNumber}`; self.set(key,(self.get(key)??0)+(profile.timeDeltas[i]??0)/1000) }
  if (process.env.OUT_TRACE) { const { writeFile } = await import('node:fs/promises'); await writeFile(process.env.OUT_TRACE, JSON.stringify({ traceEvents: events, profile })) }
  const totals={}
  for(const e of events) if(e.ph==='X' && ['Paint','Layout','UpdateLayoutTree','RasterTask'].includes(e.name)) totals[e.name]=(totals[e.name]??0)+e.dur/1000
  const checks = []
  if (process.env.VERIFY && !process.env.ROLL) {
    const first = page.locator('[data-block-id="density-track-0-block-0"]')
    const last = page.locator(`[data-block-id="density-track-${trackCount - 1}-block-${blocksPerTrack - 1}"]`)
    await first.scrollIntoViewIfNeeded()
    await page.evaluate(() => {
      const p = window.__cabinStores.project.getState()
      // Drag selects the block (which removes its wash). Deselect before
      // checking the resting pulse, then audition the moved block's onset.
      window.__cabinStores.ui.getState().setSelectedBlockIds(new Set())
      const onset = p.tracks['density-track-0'].blocks[0].startBar * p.beatsPerBar
      window.__cabinStores.time.setState({ currentBeat: onset + 0.2, isPlaying: true })
    })
    await page.waitForFunction(() => Number(document.querySelector('[data-block-id="density-track-0-block-0"] [data-midi-activity-pulse]')?.style.opacity) > 0)
    checks.push('visible block pulses')
    await last.scrollIntoViewIfNeeded()
    await page.waitForFunction(() => document.querySelector('[data-block-id="density-track-0-block-0"] [data-midi-activity-pulse]')?.style.willChange === '')
    assert.equal(await first.locator('[data-midi-preview-key]').count(), notesPerBlock)
    assert.equal(await first.evaluate(e => getComputedStyle(e).contentVisibility), 'visible')
    checks.push('offscreen activity parks; note DOM stays mounted and cached outside zoom')
    await first.scrollIntoViewIfNeeded()
    await page.waitForFunction(() => Number(document.querySelector('[data-block-id="density-track-0-block-0"] [data-midi-activity-pulse]')?.style.opacity) > 0)
    await first.click({ position: { x: 30, y: 10 } })
    assert.ok(await page.evaluate(() => window.__cabinStores.ui.getState().selectedBlockIds.has('density-track-0-block-0')))
    await page.evaluate(() => window.__cabinStores.ui.getState().setSelectedBlockIds(new Set()))
    await page.waitForFunction(() => Number(document.querySelector('[data-block-id="density-track-0-block-0"] [data-midi-activity-pulse]')?.style.opacity) > 0)
    checks.push('selection and deselection restore pulse registration')
    await first.dblclick({ position: { x: 30, y: 10 } })
    await page.waitForFunction(() => window.__cabinStores.ui.getState().editingBlock?.blockId === 'density-track-0-block-0')
    await page.waitForFunction(() => document.querySelectorAll('[data-note-id]').length > 0)
    checks.push('double-click opens the MIDI editor with notes')
    await page.evaluate(() => window.__cabinStores.time.getState().setIsPlaying(false))
  }
  if (process.env.VERIFY && process.env.ROLL) {
    assert.equal(await page.locator('[data-note-id]').count(), notesPerBlock)
    for (const height of [8, 19.25, 28, 72.5]) {
      await page.evaluate(height => window.__cabinStores.ui.getState().setMidiRowHeight(height), height)
      await page.waitForTimeout(100)
      const geometry = await page.evaluate(() => {
        const ui = window.__cabinStores.ui.getState()
        const notes = window.__cabinStores.project.getState().tracks['density-track-0'].blocks[0].notes
        const byId = new Map(notes.map(n => [n.id, n]))
        let error = 0
        for (const el of document.querySelectorAll('[data-note-id]')) {
          const n = byId.get(el.dataset.noteId)
          const style = getComputedStyle(el)
          const left = Math.round(n.startBeat * ui.midiPixelsPerBeat)
          const right = Math.round((n.startBeat + n.durationBeats) * ui.midiPixelsPerBeat)
          error = Math.max(error,
            Math.abs(parseFloat(style.top) - ((96 - n.pitch) * ui.midiRowHeight + 2)),
            Math.abs(parseFloat(style.height) - (ui.midiRowHeight - 4)),
            Math.abs(parseFloat(style.left) - left),
            Math.abs(parseFloat(style.width) - Math.max(right - left - 1, 8)))
        }
        return error
      })
      assert.ok(geometry < 0.02, `note geometry must match pixel layout at height ${height}: ${geometry}`)
    }
    checks.push('all note positions and dimensions match at four row heights, including fractional zoom')
    await page.evaluate(() => window.__cabinStores.ui.getState().setMidiRowHeight(28))
    const note = page.locator('[data-note-id]').last()
    const noteId = await note.getAttribute('data-note-id')
    const readNote = () => page.evaluate(id => window.__cabinStores.project.getState().tracks['density-track-0'].blocks[0].notes.find(n => n.id === id), noteId)
    await note.scrollIntoViewIfNeeded()
    const before = await readNote()
    const b = await note.boundingBox()
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
    await page.mouse.down()
    await page.mouse.move(b.x + b.width / 2 + 40, b.y + b.height / 2 - 28, { steps: 12 })
    await page.mouse.up()
    const moved = await readNote()
    assert.ok(moved.startBeat > before.startBeat && moved.pitch === before.pitch + 1, 'note drag must follow the zoomed grid')
    await note.scrollIntoViewIfNeeded()
    const r = await note.boundingBox()
    await page.mouse.move(r.x + r.width - 1, r.y + r.height / 2)
    await page.mouse.down()
    await page.mouse.move(r.x + r.width - 1 + 40, r.y + r.height / 2, { steps: 12 })
    await page.mouse.up()
    assert.ok((await readNote()).durationBeats > moved.durationBeats, 'note edge resize must still work')
    checks.push('dense piano-roll note drag and edge resize after zoom')
  }
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({scenario, roll: !!process.env.ROLL, trackCount, blocksPerTrack, notesPerBlock, info,stats,traceMs:totals,topSelf:[...self].sort((a,b)=>b[1]-a[1]).slice(0,16),errors,checks},null,2))
} finally { await browser.close() }
