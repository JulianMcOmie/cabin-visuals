import assert from 'node:assert/strict'
import {chromium} from 'playwright'
const browser=await chromium.launch({headless:true,args:['--enable-unsafe-swiftshader']})
try {
  const page=await browser.newPage({viewport:{width:1200,height:900}}),errors=[]
  page.on('pageerror',e=>errors.push(String(e)))
  await page.goto(`${process.env.BASE??'http://localhost:3197'}/editor`,{waitUntil:'domcontentloaded'})
  await page.waitForFunction(()=>window.__previewRuntime?.worker&&window.__three)
  await page.evaluate(()=>{
    const {project,ui,time}=window.__cabinStores,p=project.getState(),id=p.activeSceneId
    const track={id:'pick',name:'Pick cube',instrumentId:'cube',type:'base',color:'#fff',childIds:[],muted:false,solo:false,params:{size:1},blocks:[{id:'b',startBar:0,durationBars:4,notes:[{id:'n',pitch:60,startBeat:0,durationBeats:4,velocity:100}]}]}
    const scene={...p.scenes[id],tracks:{pick:track},rootTrackIds:['pick']}
    project.setState({scenes:{...p.scenes,[id]:scene},tracks:scene.tracks,rootTrackIds:scene.rootTrackIds})
    ui.getState().setCanvasView('scene');time.setState({currentBeat:1,isPlaying:false})
  })
  await page.waitForFunction(()=>window.__previewRuntime.rendering&&window.__cabinVisual.getObjectState('pick')?.beat===1)
  const canvas=await page.evaluate(()=>{const c=[...document.querySelectorAll('canvas')].find(c=>c.style.pointerEvents==='none'&&c.width>300),r=c.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}})
  await page.keyboard.down('Shift')
  await page.mouse.move(canvas.x+canvas.w/2,canvas.y+canvas.h/2)
  await page.waitForFunction(()=>window.__cabinStores.ui.getState().canvasHover?.trackId==='pick',null,{timeout:15000})
  assert.ok(await page.evaluate(()=>window.__previewRuntime.rendering),'picking must keep worker renderer')
  await page.mouse.dblclick(canvas.x+canvas.w/2,canvas.y+canvas.h/2)
  await page.keyboard.up('Shift')
  await page.waitForFunction(()=>window.__cabinStores.ui.getState().selectedTrackId==='pick')
  await page.waitForFunction(()=>window.__cabinStores.ui.getState().canvasHover===null)
  // A late answer to an immediately canceled pick must not resurrect hover.
  await page.keyboard.down('Shift');await page.mouse.move(canvas.x+canvas.w/2+1,canvas.y+canvas.h/2);await page.keyboard.up('Shift')
  await page.waitForTimeout(500)
  assert.equal(await page.evaluate(()=>window.__cabinStores.ui.getState().canvasHover),null)
  await page.evaluate(()=>{
    const editing=window.__cabinVisual.gradientEditing
    const raw=JSON.stringify([{point:[-1,0,0],incoming:[-2,0,0],outgoing:[0,0,0]},{point:[1,0,0],incoming:[0,0,0],outgoing:[2,0,0]}])
    const set=raw=>editing.setState({session:{...editing.getState().session,raw}})
    editing.getState().setSession({targetId:'probe',raw,curved:false,colorA:'#ff0000',colorB:'#0000ff',set})
  })
  const handles=page.locator('svg[aria-label="Gradient path stage editor"] circle')
  await handles.first().waitFor({state:'visible'})
  const before=await page.evaluate(()=>window.__cabinVisual.gradientEditing.getState().session.raw)
  const h=await handles.first().boundingBox()
  await page.mouse.move(h.x+h.width/2,h.y+h.height/2);await page.mouse.down();await page.mouse.move(h.x+h.width/2+35,h.y+h.height/2+20,{steps:5});await page.mouse.up()
  const after=await page.evaluate(()=>window.__cabinVisual.gradientEditing.getState().session.raw)
  assert.notEqual(after,before,'gradient handle pointer gesture updates world path')
  assert.ok(await page.evaluate(()=>window.__previewRuntime.rendering),'gradient must keep worker renderer')
  assert.equal(errors.length,0,errors.join('\n'))
  console.log('worker hover, selection, canceled pick, gradient drag passed')
}finally{await browser.close()}
