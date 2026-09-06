// Dense timeline probe with no instrument/GPU workload.
// BASE=http://localhost:3091 node scripts/perf/timeline-density.mjs [play|scroll|drag]
// TRACKS=100 BLOCKS=8 NOTES=128 scales to 102,400 notes; VERIFY=1 checks viewport lifecycle.
// HEADED=1 uses a visible browser; default headless isolates timeline rendering.
import { chromium } from 'playwright'
import assert from 'node:assert/strict'
const scenario = process.argv[2] ?? 'play'
const trackCount = Number(process.env.TRACKS ?? 30)
const blocksPerTrack = Number(process.env.BLOCKS ?? 8)
const notesPerBlock = Number(process.env.NOTES ?? 128)
const browser = await chromium.launch({ headless: !process.env.HEADED, args: ['--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] })
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
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
  await page.waitForFunction(count => document.querySelectorAll('[data-block-id]').length === count, trackCount * blocksPerTrack)
  await page.waitForTimeout(2000)
  if (process.env.OUT_SHOT) await page.locator('[data-tracks-scroll]').screenshot({ path: process.env.OUT_SHOT })
  const info = await page.evaluate(() => {
    const sc = document.querySelector('[data-tracks-scroll]'); const r = sc.getBoundingClientRect()
    return { blocks: document.querySelectorAll('[data-block-id]').length, notes: document.querySelectorAll('[data-midi-preview-key]').length, visibleBlocks: [...document.querySelectorAll('[data-block-id]')].filter(e => { const b=e.getBoundingClientRect(); return b.right > r.left && b.left < r.right && b.bottom > r.top && b.top < r.bottom }).length }
  })
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
      await page.evaluate(i=>{ const sc=document.querySelector('[data-tracks-scroll]'); sc.scrollTop=(sc.scrollHeight-sc.clientHeight)*(0.5-0.5*Math.cos(i/59*Math.PI*2)); sc.scrollLeft=(sc.scrollWidth-sc.clientWidth)*(0.5-0.5*Math.cos(i/59*Math.PI*2)) },i)
      await page.waitForTimeout(30)
    }
  } else {
    const before = await page.evaluate(() => window.__cabinStores.project.getState().tracks['density-track-0'].blocks[0].startBar)
    const block=page.locator('[data-block-id]').first(); const b=await block.boundingBox()
    await page.mouse.move(b.x+30,b.y+b.height/2); await page.mouse.down()
    for(let i=0;i<60;i++) { await page.mouse.move(b.x+30+i*2,b.y+b.height/2); await page.waitForTimeout(16) }
    await page.mouse.up()
    const after = await page.evaluate(() => window.__cabinStores.project.getState().tracks['density-track-0'].blocks[0].startBar)
    assert.ok(after > before, 'the drag must move the block')
  }
  const {profile}=await cdp.send('Profiler.stop')
  const done=new Promise(r=>cdp.once('Tracing.tracingComplete',r)); await cdp.send('Tracing.end'); await done
  const stats=await page.evaluate(()=> { cancelAnimationFrame(window.__probeRaf); const a=window.__gaps.sort((a,b)=>a-b); return {frames:a.length, p95:a[Math.floor(a.length*.95)], midiStyleWrites:window.__midiWrites, promotedPulses:[...document.querySelectorAll('[data-midi-activity-pulse]')].filter(e=>e.style.willChange==='opacity').length} })
  const byId=new Map(profile.nodes.map(n=>[n.id,n])); const self=new Map()
  for(let i=0;i<profile.samples.length;i++) { const f=byId.get(profile.samples[i]).callFrame; const key=`${f.functionName} @ ${f.url.split('/').pop()}:${f.lineNumber}`; self.set(key,(self.get(key)??0)+(profile.timeDeltas[i]??0)/1000) }
  const totals={}
  for(const e of events) if(e.ph==='X' && ['Paint','Layout','UpdateLayoutTree','RasterTask'].includes(e.name)) totals[e.name]=(totals[e.name]??0)+e.dur/1000
  const checks = []
  if (process.env.VERIFY) {
    const first = page.locator('[data-block-id="density-track-0-block-0"]')
    const last = page.locator(`[data-block-id="density-track-${trackCount - 1}-block-${blocksPerTrack - 1}"]`)
    await first.scrollIntoViewIfNeeded()
    await page.evaluate(() => window.__cabinStores.time.setState({ currentBeat: 0.2, isPlaying: true }))
    await page.waitForFunction(() => Number(document.querySelector('[data-block-id="density-track-0-block-0"] [data-midi-activity-pulse]')?.style.opacity) > 0)
    checks.push('visible block pulses')
    await last.scrollIntoViewIfNeeded()
    await page.waitForFunction(() => document.querySelector('[data-block-id="density-track-0-block-0"] [data-midi-activity-pulse]')?.style.willChange === '')
    assert.equal(await first.locator('[data-midi-preview-key]').count(), notesPerBlock)
    checks.push('offscreen activity parks; note DOM stays mounted')
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
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({scenario, trackCount, blocksPerTrack, notesPerBlock, info,stats,traceMs:totals,topSelf:[...self].sort((a,b)=>b[1]-a[1]).slice(0,16),errors,checks},null,2))
} finally { await browser.close() }
