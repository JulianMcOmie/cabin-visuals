import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'
const browser = await chromium.launch({headless:true,args:['--enable-unsafe-swiftshader']})
try {
for (const instrument of (process.env.INSTRUMENTS ?? 'cube,textDisplay,photo,video,photoSlot,oscilloscope,starfield,glassRoll').split(',')) {
  const page = await browser.newPage({viewport:{width:1200,height:900}})
  // A deterministic chirp served only inside this browser test. Playback
  // decoding and worker-window sampling consume the same bytes.
  const sampleRate=48000, frames=sampleRate*4, wav=Buffer.alloc(44+frames*2)
  wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(sampleRate,24);wav.writeUInt32LE(sampleRate*2,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(frames*2,40)
  for(let i=0;i<frames;i++){const t=i/sampleRate;wav.writeInt16LE(Math.round(Math.sin(2*Math.PI*(227*t+43*t*t))*.7*32767),44+i*2)}
  await page.route('**/__worker-waveform.wav',route=>route.fulfill({body:wav,contentType:'audio/wav'}))
  const errors=[]
  page.on('worker',worker=>worker.evaluate(()=>self.addEventListener('error',event=>console.error(event.error?.stack))).catch(()=>{}))
  page.on('pageerror',e=>errors.push(String(e)))
  page.on('console',m=>{if(m.type()==='error')console.log(instrument,m.text().slice(0,1200))})
  await page.goto(`${process.env.BASE ?? 'http://localhost:3197'}/editor`,{waitUntil:'domcontentloaded',timeout:60000})
  await page.waitForFunction(()=>window.__previewRuntime?.worker&&window.__three,null,{timeout:60000})
  await page.evaluate(instrument=>{
    const {project,ui,time}=window.__cabinStores,p=project.getState(),sceneId=p.activeSceneId
    const track={id:'probe',name:instrument,instrumentId:instrument,type:'base',color:'#fff',muted:false,solo:false,childIds:[],params:{size:1},blocks:[{id:'b',startBar:0,durationBars:4,loop:false,notes:[{id:'n',pitch:['video','photo','photoSlot'].includes(instrument)?48:60,startBeat:0,durationBeats:4,velocity:100}]}]}
    if(instrument==='cube')Object.assign(track.params,{textured:1,finish:1})
    if(instrument==='textDisplay') track.blocks[0].notes.push({id:'words',pitch:61,startBeat:0,durationBeats:8,velocity:100,lyric:{words:['HELLO'],layout:{kind:'one'}}})
    if(instrument==='photo'||instrument==='photoSlot')track.photoPads=[{ref:'/instrument-previews/metronomeBalls-2ffe26fe35e7.webp'}]
    if(instrument==='video')track.videoPads=[{ref:'/templates/promo/shot-01.mp4',inPoint:0}]
    if(instrument==='photoSlot'){Object.assign(track.params,{labelStyle:4,borderStyle:3});track.stringParams={label:'WORKER'}}
    const scene={...p.scenes[sceneId],tracks:{probe:track},rootTrackIds:['probe']}
    const mainId=p.sceneOrder.find(id=>p.scenes[id].isMain)
    const comp={...track,id:'comp',instrumentId:'scene',blocks:[],sceneBindings:[{sceneId,pitch:60}]}
    project.setState({scenes:{...p.scenes,[sceneId]:scene,[mainId]:{...p.scenes[mainId],tracks:{comp},rootTrackIds:['comp']}},tracks:scene.tracks,rootTrackIds:scene.rootTrackIds})
    if(instrument==='oscilloscope')project.setState({audioTracks:{audio:{id:'audio',name:'Chirp',type:'audio',childIds:[],params:{},blocks:[],muted:false,solo:false,volume:1,audioBlocks:[{id:'chirp',clipRef:'/__worker-waveform.wav',startBar:0,trimStart:0,trimEnd:4}]}},audioRootTrackIds:['audio']})
    ui.getState().setCanvasView('scene');time.setState({currentBeat:1,isPlaying:false})
  },instrument)
  await page.waitForTimeout(4000)
  console.log('status',instrument,await page.evaluate(()=>({...window.__previewRuntime,ambient:!!window.__previewRuntime.ambient})))
  await page.waitForFunction(()=>window.__cabinVisual.getObjectState('probe')?.beat===1&&window.__previewRuntime.rendering,null,{timeout:15000})
  await page.waitForTimeout(2500)
  if(instrument==='oscilloscope'||instrument==='photoSlot') {
    const pixels=()=>page.evaluate(()=>[...document.querySelectorAll('canvas')].find(c=>c.style.pointerEvents==='none'&&c.width>300).toDataURL())
    const initial=await pixels()
    for(const beat of [2.37,.12,1]) {
      await page.evaluate(beat=>window.__cabinStores.time.setState({currentBeat:beat}),beat)
      await page.waitForFunction(beat=>window.__previewRuntime.beat===beat,beat)
    }
    assert.equal(await pixels(),initial,`${instrument} repeat paused seek`)
    if(instrument==='oscilloscope') {
      for(const volume of [0,1]) {
        const before=await page.evaluate(()=>window.__previewRuntime.revision)
        await page.evaluate(volume=>{const p=window.__cabinStores.project;p.setState({audioTracks:{audio:{...p.getState().audioTracks.audio,volume}}})},volume)
        await page.waitForFunction(before=>window.__previewRuntime.revision>before,before)
        if(!volume)assert.notEqual(await pixels(),initial,'paused audio edit repaints scope')
        else assert.equal(await pixels(),initial,'restoring gain restores exact waveform')
      }
    }else{
      for(let style=0;style<=6;style++) {
        const before=await page.evaluate(()=>window.__previewRuntime.revision)
        await page.evaluate(style=>{const p=window.__cabinStores.project,s=p.getState(),scene=s.scenes[s.activeSceneId];const track={...scene.tracks.probe,params:{...scene.tracks.probe.params,labelStyle:style,borderStyle:style%4}};const tracks={probe:track};p.setState({scenes:{...s.scenes,[s.activeSceneId]:{...scene,tracks}},tracks})},style)
        await page.waitForFunction(before=>window.__previewRuntime.revision>before,before)
        assert.ok(await page.evaluate(()=>window.__previewRuntime.rendering&&!window.__previewRuntime.error),'PhotoSlot style stays in worker')
      }
    }
  }
  const result = await page.evaluate(async(exportScale)=>{
    const runtime={...window.__previewRuntime,ambient:!!window.__previewRuntime.ambient}
    const source=[...document.querySelectorAll('canvas')].find(c=>c.style.pointerEvents==='none'&&c.width>300),w=source.width*exportScale,h=source.height*exportScale
    const reference=document.createElement('canvas');reference.width=w;reference.height=h
    reference.getContext('2d').drawImage(source,0,0,w,h)
    const expected=reference.getContext('2d').getImageData(0,0,w,h)
    const workerPng=source.toDataURL()
    const driver=window.__cabinVisual.getFrameDriver()
    driver.pin(w,h)
    try {
      await driver.prepare(1)
      driver.prepareFrame?.(1)
      await Promise.all([...window.__cabinVisual.framePreparers].map(fn => fn(1)))
      driver.renderFrame(1,0)
      const gl=window.__three.gl.getContext(), raw=new Uint8Array(w*h*4)
      gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,raw)
      for(const beat of [2.37,1]) {
        driver.prepareFrame?.(beat)
        await Promise.all([...window.__cabinVisual.framePreparers].map(fn=>fn(beat)))
        driver.renderFrame(beat,0)
      }
      const repeated=new Uint8Array(raw.length)
      gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,repeated)
      let repeatError=0
      for(let i=0;i<raw.length;i++)repeatError+=Math.abs(raw[i]-repeated[i])
      const actual=new ImageData(w,h)
      for(let y=0;y<h;y++)actual.data.set(raw.subarray((h-1-y)*w*4,(h-y)*w*4),y*w*4)
      let diff=0, lit=0, expectedLit=0
      for(let i=0;i<raw.length;i++)if(i%4!==3){diff+=Math.abs(actual.data[i]-expected.data[i]);if(actual.data[i]>10)lit++;if(expected.data[i]>10)expectedLit++}
      const output=document.createElement('canvas');output.width=w;output.height=h;output.getContext('2d').putImageData(actual,0,0)
      return {runtime,repeatError:repeatError/raw.length,difference:diff/(w*h*3),lit,expectedLit,workerPng,exportPng:output.toDataURL()}
    }finally{driver.unpin()}
  },Number(process.env.EXPORT_SCALE ?? 1))
  for(const field of ['workerPng','exportPng']) { await writeFile(`/private/tmp/cabin-${instrument}-${field}.png`,Buffer.from(result[field].split(',')[1],'base64'));delete result[field] }
  console.log(instrument,JSON.stringify({...result,errors}))
  assert.ok(result.runtime.worker&&result.runtime.rendering,result.runtime.error)
  // Small previews supersample their compositor 2x. Matching that resolution
  // catches missing PMREM reflections without comparing different bloom sizes.
  if(instrument==='cube'&&Number(process.env.EXPORT_SCALE)===2)assert.ok(result.difference<1,`textured gloss appearance: ${result.difference}`)
  assert.ok(result.repeatError<.05,`${instrument} first export equals repeated seek: ${result.repeatError}`)
  assert.ok(result.lit>0,`${instrument} first export frame missing`)
  assert.ok(result.expectedLit>0,`${instrument} worker pixels missing`)
  assert.equal(errors.length,0,errors.join('\n'))
  await page.close()
}
}finally{await browser.close()}
