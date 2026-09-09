// Exercise every registered visual in the real worker (not just its allowlist).
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {chromium} from 'playwright'
const ids=JSON.parse(execFileSync(process.execPath,['--import','tsx','--input-type=module','-e','await import("./src/editor/core/visual/VisualEngine.ts");const m=await import("./src/editor/instruments/index.ts");console.log(JSON.stringify(Object.keys(m.INSTRUMENTS)))'],{encoding:'utf8'}))
const browser=await chromium.launch({headless:true,args:['--enable-unsafe-swiftshader']})
try {
  const page=await browser.newPage({viewport:{width:1200,height:900}}),errors=[]
  page.on('pageerror',e=>errors.push(String(e)))
  await page.goto(`${process.env.BASE??'http://localhost:3197'}/editor`,{waitUntil:'domcontentloaded'})
  await page.waitForFunction(()=>window.__previewRuntime?.worker&&window.__three)
  for(const instrumentId of ids) {
    const before=await page.evaluate(()=>window.__previewRuntime.revision)
    await page.evaluate(instrumentId=>{
      const {project,time,ui}=window.__cabinStores,p=project.getState(),id=p.activeSceneId
      const track={id:'registry',name:instrumentId,instrumentId,type:'base',color:'#fff',childIds:[],muted:false,solo:false,params:{},blocks:[{id:'b',startBar:0,durationBars:4,notes:[{id:'n',pitch:60,startBeat:0,durationBeats:4,velocity:100}]}]}
      const scene={...p.scenes[id],tracks:{registry:track},rootTrackIds:['registry']}
      project.setState({scenes:{...p.scenes,[id]:scene},tracks:scene.tracks,rootTrackIds:scene.rootTrackIds})
      ui.getState().setCanvasView('scene');time.setState({currentBeat:1,isPlaying:false})
    },instrumentId)
    await page.waitForFunction(before=>window.__previewRuntime.revision>before||window.__previewRuntime.error,before,{timeout:30000})
    await page.waitForTimeout(500)
    const result=await page.evaluate(()=>({worker:window.__previewRuntime.worker,rendering:window.__previewRuntime.rendering,error:window.__previewRuntime.error}))
    console.log(instrumentId,JSON.stringify(result))
    assert.ok(result.worker&&result.rendering&&!result.error,`${instrumentId}: ${JSON.stringify(result)}`)
    assert.equal(errors.length,0,errors.join('\n'))
  }
  console.log(`all ${ids.length} registered worker visuals passed`)
}finally{await browser.close()}
