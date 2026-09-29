// Capability regressions: missing Worker, missing worker GL, and DOM-only visual.
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
const browser = await chromium.launch({headless:true,args:['--enable-unsafe-swiftshader']})
try {
  for(const mode of ['no-worker','no-offscreen','unsupported']) {
    const page = await browser.newPage({viewport:{width:1200,height:900}})
    const errors=[]
    page.on('pageerror',error=>errors.push(String(error)))
    await page.addInitScript(mode=>{
      if(mode==='no-worker')window.Worker=undefined
      if(mode==='no-offscreen')window.OffscreenCanvas=undefined
    },mode)
    await page.goto(`${process.env.BASE ?? 'http://localhost:3197'}/editor`,{waitUntil:'domcontentloaded'})
    await page.waitForFunction(()=>window.__previewRuntime&&window.__cabinStores&&window.__three)
    await page.evaluate(mode=>{
      const {project,time}=window.__cabinStores,p=project.getState(),sceneId=p.activeSceneId
      const track={id:'fallback',name:'Fallback',type:'base',instrumentId:'cube',childIds:[],params:{},blocks:[],muted:false,solo:false,color:'#fff'}
      const scene={...p.scenes[sceneId],tracks:{fallback:track},rootTrackIds:['fallback']}
      if(mode==='unsupported'){scene.tracks.unknown={...track,id:'unknown',instrumentId:'futureInstrument'};scene.rootTrackIds.push('unknown')}
      project.setState({scenes:{...p.scenes,[sceneId]:scene},tracks:scene.tracks,rootTrackIds:scene.rootTrackIds})
      time.setState({currentBeat:2,isPlaying:false})
    },mode)
    await page.waitForFunction(()=>window.__cabinVisual.getObjectState('fallback')?.beat===2&&!window.__previewRuntime.rendering,null,{timeout:30000})
    const result=await page.evaluate(()=>({worker:window.__previewRuntime.worker,rendering:window.__previewRuntime.rendering,error:window.__previewRuntime.error}))
    assert.equal(result.worker,mode!=='no-worker')
    assert.equal(result.rendering,false)
    assert.equal(errors.length,0,errors.join('\n'))
    console.log(mode,result)
    await page.close()
  }
} finally {await browser.close()}
