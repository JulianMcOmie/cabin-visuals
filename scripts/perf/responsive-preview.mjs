// Local browser regression: real dense Wormhole rendering + actual MIDI gestures.
// MODE=compat keeps evaluation in the worker but renders on the DOM thread.
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'
const mode = process.env.MODE ?? 'worker'
const base = process.env.BASE ?? 'http://localhost:3197'
const browser = await chromium.launch({ headless: true, args: ['--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] })
try {
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const errors = []
page.on('pageerror', error => errors.push(String(error)))
if (mode === 'compat') await page.addInitScript(() => { window.OffscreenCanvas = undefined })
await page.goto(`${base}/editor`, { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForFunction(() => window.__previewRuntime?.worker && window.__cabinStores && window.__three, null, { timeout: 60000 })
await page.evaluate(() => {
  const { project, ui, time } = window.__cabinStores
  const p = project.getState(), sceneId = p.activeSceneId
  const tracks = {}
  for (let i = 0; i < 3; i++) {
    const id = `stress-${i}`
    tracks[id] = { id, name: `Dense Wormhole ${i+1}`, type: 'base', instrumentId: 'wormhole', muted: false, solo: false, color: '#00ffff', childIds: [],
      params: { ringDetail: 192, lengthDetail: 768, brightness: 0.5, noiseAmount: 1, dotSize: 0.04 },
      blocks: [{ id: `block-${i}`, startBar: 0, durationBars: 16, loop: false,
        notes: Array.from({ length: 32 }, (_,n) => ({ id: `note-${i}-${n}`, startBeat: n*2, durationBeats: 0.5, pitch: 60+n%8, velocity: 100 })) }] }
  }
  const mainId = p.sceneOrder.find(id=>p.scenes[id].isMain)
  const composition = {id:'composition',name:'Scene',type:'base',instrumentId:'scene',color:'#fff',muted:false,solo:false,childIds:[],blocks:[],sceneBindings:[{sceneId,pitch:60}]}
  const main = {...p.scenes[mainId],tracks:{composition},rootTrackIds:['composition']}
  const scene = { ...p.scenes[sceneId], tracks, rootTrackIds: Object.keys(tracks) }
  project.setState({ scenes: { ...p.scenes, [mainId]: main, [sceneId]: scene }, tracks, rootTrackIds: scene.rootTrackIds })
  ui.getState().setCanvasView('scene')
  ui.getState().setEditingBlock({ trackId: 'stress-0', blockId: 'block-0' })
  time.setState({ currentBeat: 0.5 })
})
await page.waitForFunction(() => window.__cabinVisual.getObjectState('stress-0'), null, {timeout:60000})
await page.waitForTimeout(2000)
if (mode === 'worker') await page.waitForFunction(() => window.__previewRuntime.rendering, null, {timeout:60000})
await page.waitForFunction(() => document.querySelector('[data-note-id="note-0-0"]'), null, {timeout:30000})
const cdp = await page.context().newCDPSession(page)
await cdp.send('Tracing.start', {categories:'devtools.timeline,disabled-by-default-devtools.timeline,blink.user_timing', transferMode:'ReturnAsStream'})
await cdp.send('Profiler.enable'); await cdp.send('Profiler.start')
await page.evaluate(() => {
  window.__probe = { gaps: [], events: [], long: [], workers: [] }
  let last = performance.now()
  window.__probeTimer = setInterval(() => { const now = performance.now(); window.__probe.gaps.push(now-last); last=now; window.__probe.workers.push(window.__previewRuntime.duration) }, 10)
  window.__probeBeat = setInterval(() => { const time = window.__cabinStores.time; time.setState({ currentBeat: (time.getState().currentBeat + 0.05)%16, isPlaying: true }) }, 25)
  window.__probeObserver = new PerformanceObserver(list => window.__probe.long.push(...list.getEntries().map(e=>e.duration)))
  window.__probeObserver.observe({type:'longtask'})
  document.addEventListener('pointermove', event => window.__probe.events.push(performance.now()-event.timeStamp), {passive:true})
})
const note = page.locator('[data-note-id="note-0-0"]')
const before = await page.evaluate(() => window.__cabinStores.project.getState().tracks['stress-0'].blocks[0].notes[0])
const box = await note.boundingBox()
assert.ok(box)
const roundTrips = []
await page.mouse.move(box.x+box.width/2, box.y+box.height/2)
await page.mouse.down()
for (let i=1;i<=50;i++) {
  const start = performance.now()
  await page.mouse.move(box.x+box.width/2+i*2, box.y+box.height/2-24*i/50)
  roundTrips.push(performance.now()-start)
  await page.waitForTimeout(8)
}
await page.mouse.up()
const after = await page.evaluate(() => window.__cabinStores.project.getState().tracks['stress-0'].blocks[0].notes[0])
assert.notEqual(after.startBeat, before.startBeat, 'MIDI drag committed while preview ran')
// Right-button draw places a note without waiting for preview completion.
const region = await page.locator('[data-midi-block-region]').boundingBox()
const countBefore = await page.evaluate(()=>window.__cabinStores.project.getState().tracks['stress-0'].blocks[0].notes.length)
await page.mouse.move(region.x + 180, region.y + 18)
await page.mouse.down({button:'right'}); await page.mouse.up({button:'right'})
await page.waitForTimeout(50)
const countAfter = await page.evaluate(()=>window.__cabinStores.project.getState().tracks['stress-0'].blocks[0].notes.length)
assert.equal(countAfter, countBefore+1, 'MIDI placement committed during preview')
// A real scroll interaction on the MIDI surface while the dense render continues.
await page.mouse.move(1100, 800)
await page.mouse.wheel(700, 0)
await page.waitForTimeout(500)
await page.evaluate(() => { clearInterval(window.__probeBeat); window.__cabinStores.time.setState({isPlaying:false,currentBeat:3}); })
const finalRevision = await page.evaluate(() => window.__previewRuntime.revision)
await page.waitForFunction(() => window.__cabinVisual.getObjectState('stress-0')?.beat === 3, null, { timeout:60000 })
const traceDone = new Promise(resolve=>cdp.once('Tracing.tracingComplete',resolve))
await cdp.send('Tracing.end'); const {stream} = await traceDone; let trace=''; for (;;) { const part=await cdp.send('IO.read',{handle:stream});trace+=part.data;if(part.eof)break };await cdp.send('IO.close',{handle:stream});await writeFile(`/private/tmp/cabin-responsive-${mode}.trace.json`,trace)
const profile = await cdp.send('Profiler.stop')
await writeFile(`/private/tmp/cabin-responsive-${mode}.cpuprofile`, JSON.stringify(profile.profile))
const result = await page.evaluate(() => {
  clearInterval(window.__probeTimer); window.__probeObserver.disconnect()
  const state = window.__cabinVisual.getObjectState('stress-0')
  const canvas = document.querySelector(window.__previewRuntime.rendering ? '.visual-canvas-root canvas:last-child' : '.visual-canvas-root canvas:first-child')
  let lit = null
  try { const c=document.createElement('canvas'); c.width=canvas.width; c.height=canvas.height; const ctx=c.getContext('2d');ctx.drawImage(canvas,0,0);const p=ctx.getImageData(0,0,c.width,c.height).data; lit=Array.from(p).filter((v,i)=>i%4!==3&&v>10).length } catch {}
  return { ...window.__probe, runtime: {...window.__previewRuntime, ambient: !!window.__previewRuntime.ambient}, previewNote: state.notes.find(n=>n.id==='note-0-0'), scroll: document.querySelector('[data-midi-scroll]').scrollLeft, lit }
})
assert.equal(result.previewNote.beat, after.startBeat, 'final paused edit reached the asynchronous preview')
assert.ok(result.runtime.worker, result.runtime.error)
if (mode === 'worker') { assert.ok(result.runtime.rendering, result.runtime.error); assert.ok(result.lit > 0, 'worker actually painted pixels') }
assert.equal(errors.length, 0, errors.join('\n'))
const stats = values => { const v=[...values].sort((a,b)=>a-b); return {n:v.length,p50:v[Math.floor(v.length*.5)],p95:v[Math.floor(v.length*.95)],max:v.at(-1)} }
console.log(JSON.stringify({mode,before,after,scroll:result.scroll,lit:result.lit,finalRevision,runtime:result.runtime,timerGapMs:stats(result.gaps),pointerDelayMs:stats(result.events),pointerRoundtripMs:stats(roundTrips),workerFrameMs:stats(result.workers),longTasks:stats(result.long),errors},null,2))
const exportCheck = await page.evaluate(async () => {
  const driver = window.__cabinVisual.getFrameDriver()
  const source = document.querySelector(window.__previewRuntime.rendering ? '.visual-canvas-root canvas:last-child' : '.visual-canvas-root canvas:first-child')
  const scratch = document.createElement('canvas'); scratch.width=source.width;scratch.height=source.height
  const context = scratch.getContext('2d');context.drawImage(source,0,0)
  const expected = context.getImageData(0,0,scratch.width,scratch.height).data
  driver.pin(scratch.width,scratch.height)
  try {
    await driver.prepare(3)
    driver.renderFrame(3,0)
    const gl=window.__three.gl.getContext(), actual=new Uint8Array(expected.length)
    gl.readPixels(0,0,scratch.width,scratch.height,gl.RGBA,gl.UNSIGNED_BYTE,actual)
    let difference=0, lit=0
    for(let y=0;y<scratch.height;y++)for(let x=0;x<scratch.width;x++)for(let c=0;c<3;c++){
      const a=actual[((scratch.height-1-y)*scratch.width+x)*4+c],b=expected[(y*scratch.width+x)*4+c]
      difference+=Math.abs(a-b);if(a>10)lit++
    }
    driver.renderFrame(3.5,100)
    driver.renderFrame(3,0)
    const repeated=new Uint8Array(expected.length)
    gl.readPixels(0,0,scratch.width,scratch.height,gl.RGBA,gl.UNSIGNED_BYTE,repeated)
    let repeatDifference=0
    for(let i=0;i<actual.length;i++)repeatDifference+=Math.abs(actual[i]-repeated[i])
    return {repeatPixelError:repeatDifference/actual.length,meanPixelError:difference/(scratch.width*scratch.height*3),lit,width:scratch.width,height:scratch.height}
  } finally {driver.unpin()}
})
assert.ok(exportCheck.lit>0,'export rendered the remounted main scene')
// Preview supersamples small canvases; export renders at the requested size.
// Repeated export beats, including the first encoded frame, must match each other.
assert.ok(exportCheck.repeatPixelError<0.05,JSON.stringify(exportCheck))
console.log('export',JSON.stringify(exportCheck))
await page.waitForFunction(()=>window.__previewRuntime.worker && window.__cabinVisual.getObjectState('stress-0')?.beat===3)
await page.screenshot({ path: `/private/tmp/cabin-responsive-${mode}.png` })
} finally { await browser.close() }
