// Unsaved editor fixture: multiple instruments, single control, worker/ export.
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'
const browser=await chromium.launch({headless:true,args:['--enable-unsafe-swiftshader']})
try {
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[]
  page.setDefaultTimeout(60000)
  page.on('pageerror',e=>errors.push(String(e)))
  page.on('console',msg=>{if(msg.type()==='error'&&/shader|GLSL|WebGLProgram/.test(msg.text()))errors.push(msg.text())})
  await page.goto(`${process.env.BASE??'http://127.0.0.1:3281'}/editor`,{waitUntil:'domcontentloaded'})
  await page.waitForFunction(()=>window.__previewRuntime?.worker&&window.__three).catch(async error=>{console.log(JSON.stringify({errors,state:await page.evaluate(()=>({runtime:window.__previewRuntime,stores:!!window.__cabinStores,three:!!window.__three,body:document.body.innerText.slice(-3000)}))}));await page.screenshot({path:'artifacts/impact-warp/editor-startup.png'});throw error})
  await page.evaluate(()=>{
    const {project,ui,time}=window.__cabinStores,p=project.getState(),sceneId=p.activeSceneId
    const track=(id,instrumentId,params={})=>({id,name:id,instrumentId,type:'base',color:'#ff6a00',childIds:[],blocks:[],params,muted:false,solo:false})
    const tracks={}
    for(const [i,x,y] of [[0,-1.5,-1],[1,1.5,-1],[2,-1.5,1],[3,1.5,1]]){
      const id=`shape${i}`
      tracks[id]=track(id,i<2?'cube':'circle',{size:.6,tfX:x,tfY:y})
    }
    tracks.impact=track('impact','impactWarp',{impact:1,style:3,release:.01,size:1})
    tracks.impact.blocks=[{id:'b',startBar:0,durationBars:4,loop:false,notes:[{id:'n',pitch:60,startBeat:0,durationBeats:.01,velocity:127}]}]
    const scene={...p.scenes[sceneId],tracks,rootTrackIds:Object.keys(tracks)}
    const mainId=p.sceneOrder.find(id=>p.scenes[id].isMain)
    const comp={...track('comp','scene'),sceneBindings:[{sceneId,pitch:60}]}
    project.setState({bpm:120,scenes:{...p.scenes,[sceneId]:scene,[mainId]:{...p.scenes[mainId],tracks:{comp},rootTrackIds:['comp']}},tracks,rootTrackIds:scene.rootTrackIds})
    ui.getState().setCanvasView('scene');ui.setState({selectedTrackId:'impact'});time.setState({currentBeat:0,isPlaying:false})
  })
  await page.waitForFunction(()=>window.__previewRuntime.rendering&&window.__cabinVisual.getObjectState('impact'))
  await page.waitForTimeout(2000)
  const panel=page.getByTestId('impact-warp-user-interface')
  await panel.waitFor()
  assert.equal(await panel.getByRole('slider').count(),1)
  // The shared knob now has a numeric-entry button; only the old style
  // selectors must be absent, not every button in the panel.
  assert.equal(await panel.getByRole('button', {name: /^(Punch|Shockwave|Slam|Rupture)$/i}).count(),0)
  const pixels=()=>page.evaluate(()=>[...document.querySelectorAll('canvas')].find(c=>c.style.pointerEvents==='none'&&c.style.display!=='none'&&c.width>300).toDataURL())
  const seek=async beat=>{
    await page.evaluate(beat=>window.__cabinStores.time.setState({currentBeat:beat}),beat)
    await page.waitForFunction(beat=>window.__previewRuntime.beat===beat,beat)
    return pixels()
  }
  const rest=await seek(0),peak=await seek(.2028)
  assert.ok(peak!==rest,'all scene objects must visibly move')
  await writeFile('artifacts/impact-warp/editor-peak.png',Buffer.from(peak.split(',')[1],'base64'))
  await page.screenshot({path:'artifacts/impact-warp/editor-panel.png'})
  await seek(1.1);await seek(2)
  assert.ok(await seek(.2028)===peak,'reverse seek restores worker pixels exactly')
  const recovered=await seek(2)
  const setImpact=async value=>{
    const before=await page.evaluate(()=>window.__previewRuntime.revision)
    await page.evaluate(value=>window.__cabinStores.project.getState().setTrackParam('impact','impact',value),value)
    await page.waitForFunction(before=>window.__previewRuntime.revision>before,before)
    await page.waitForTimeout(200)
  }
  await setImpact(0)
  assert.ok(await pixels()===recovered,'recovered frame equals bypass at the same beat')
  const bypass=await seek(.2028)
  await setImpact(1)
  assert.ok(await pixels()===peak,'restoring intensity restores the worker frame')
  assert.ok(bypass!==peak,'intensity alone moves the entire scene')
  await setImpact(0)
  assert.ok(await pixels()===bypass,'zero intensity exactly restores bypass')
  await setImpact(1)
  const output=await page.evaluate(async()=>{
    const source=[...document.querySelectorAll('canvas')].find(c=>c.style.pointerEvents==='none'&&c.width>300),w=source.width,h=source.height
    const driver=window.__cabinVisual.getFrameDriver()
    driver.pin(w,h)
    try{
      await driver.prepare(.2028)
      const render=async beat=>{
        driver.prepareFrame?.(beat)
        await Promise.all([...window.__cabinVisual.framePreparers].map(fn=>fn(beat)))
        driver.renderFrame(beat,0)
        const gl=window.__three.gl.getContext(),pixels=new Uint8Array(w*h*4)
        gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,pixels);return pixels
      }
      const first=await render(.2028),rest=await render(2),again=await render(.2028)
      return {repeatExact:first.every((v,i)=>v===again[i]),changed:first.filter((v,i)=>v!==rest[i]).length,lit:first.filter((v,i)=>i%4!==3&&v>20).length}
    }finally{driver.unpin()}
  })
  assert.ok(output.repeatExact,'export frame repeat is exact')
  assert.ok(output.changed>100,'export applies impact')
  assert.ok(output.lit>100,'export renders geometry')
  assert.deepEqual(errors,[])
  console.log(JSON.stringify({singleKnob:true,workerSeekExact:true,zeroExact:true,export:output,errors}))
}finally{await browser.close()}
