import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
// Fresh, disposable browser storage: the fixture never edits an existing user session.
const url = process.env.BENCH_URL ?? 'http://127.0.0.1:3000/editor'
const output = resolve(process.env.BENCH_OUTPUT ?? 'artifacts/million-particles')
const capacity = process.argv.includes('--capacity')
await mkdir(output, { recursive: true })
const browser=await chromium.launch({headless:false,args:[...(process.platform === 'darwin' ? ['--use-angle=metal'] : []), ...(capacity ? ['--disable-frame-rate-limit', '--disable-gpu-vsync'] : []),'--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows']})
try {
const page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1});const errors=[]
page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')console.log('browser-error',m.text().slice(0,1000))})
await page.goto(url,{waitUntil:'domcontentloaded',timeout:120000})
await page.waitForFunction(()=>window.__cabinStores&&window.__three&&window.__previewRuntime,null,{timeout:120000})
await page.evaluate(()=>{
 const {project,ui,time}=window.__cabinStores,p=project.getState(),sceneId=p.sceneOrder.find(id=>!p.scenes[id].isMain),mainId=p.sceneOrder.find(id=>p.scenes[id].isMain)
 const base={id:'p',name:'Million particles',instrumentId:'particle',type:'base',color:'#7dd3fc',muted:false,solo:false,childIds:['a','b'],params:{size:.006},blocks:[]}
 const a={...base,id:'a',name:'Outer Grid',instrumentId:'',type:'splitter',splitterId:'grid',parentId:'p',childIds:[],params:{},inputValues:{rows:32,columns:32,depth:1,spacing:.15}}
 const b={...a,id:'b',name:'Inner Grid',inputValues:{rows:32,columns:32,depth:1,spacing:.004}}
 b.childIds=['spacing']; const spacing={...b,id:'spacing',type:'automation',parentId:'b',childIds:[],targetParam:'spacing',automationRange:{min:.002,max:.006},blocks:[{id:'motion',startBar:0,durationBars:4,loop:true,notes:[{id:'lo',pitch:36,velocity:100,startBeat:0,durationBeats:.25},{id:'hi',pitch:84,velocity:100,startBeat:8,durationBeats:.25},{id:'end',pitch:36,velocity:100,startBeat:16,durationBeats:.25}]}]}; const scene={...p.scenes[sceneId],tracks:{p:base,a,b,spacing},rootTrackIds:['p'],backgroundColor:'#000000'}
 const comp={...base,id:'comp',instrumentId:'scene',childIds:[],params:{},sceneBindings:[{sceneId,pitch:60}]}
 project.setState({activeSceneId:sceneId,scenes:{[sceneId]:scene,[mainId]:{...p.scenes[mainId],tracks:{comp},rootTrackIds:['comp']}},tracks:scene.tracks,rootTrackIds:scene.rootTrackIds})
 ui.getState().setCanvasView('scene');time.setState({currentBeat:0,isPlaying:false})
})
await page.waitForFunction(()=>window.__previewRuntime.directParticles&&window.__cabinVisual.getVisualCopyCount('p')===1048576,null,{timeout:120000})
await page.waitForTimeout(3000)
console.log('ready',await page.evaluate(()=>({runtime:window.__previewRuntime,state:window.__cabinVisual.getObjectState('p')?.beat,canvas:{width:window.__three.gl.domElement.width,height:window.__three.gl.domElement.height}})))
const result=await page.evaluate(async()=>{
 const state=window.__r3fState(),gl=state.gl.getContext(),ext=gl.getExtension('EXT_disjoint_timer_query_webgl2'),info=gl.getExtension('WEBGL_debug_renderer_info')
 const rafs=[],advances=[],gpu=[],pending=[],draws=[],times=[],cpu=[];const original=state.advance,draw=gl.drawElementsInstanced.bind(gl),drawPoints=gl.drawArrays.bind(gl)
 gl.drawArrays=(...args)=>{if(args[0]===gl.POINTS&&args[2]>=1048576)draws.push({at:performance.now(),instances:args[2]});return drawPoints(...args)};gl.drawElementsInstanced=(...args)=>{if(args[4]>=1048576)draws.push({at:performance.now(),instances:args[4]});return draw(...args)}
 state.set({advance:(...args)=>{const start=performance.now(),q=ext&&gl.createQuery();if(q)gl.beginQuery(ext.TIME_ELAPSED_EXT,q);original(...args);if(q){gl.endQuery(ext.TIME_ELAPSED_EXT);pending.push(q)}advances.push(start);cpu.push(performance.now()-start)}})
 let animation=0,start=performance.now();const time=window.__cabinStores.time
 const tick=now=>{rafs.push(now);time.setState({currentBeat:(now-start)/500,isPlaying:true});while(pending.length&&gl.getQueryParameter(pending[0],gl.QUERY_RESULT_AVAILABLE)){const q=pending.shift();if(!gl.getParameter(ext.GPU_DISJOINT_EXT))gpu.push(gl.getQueryParameter(q,gl.QUERY_RESULT)/1e6);gl.deleteQuery(q)}animation=requestAnimationFrame(tick)}
 animation=requestAnimationFrame(tick);await new Promise(r=>setTimeout(r,7000));cancelAnimationFrame(animation);time.setState({isPlaying:false});state.set({advance:original});gl.drawElementsInstanced=draw;gl.drawArrays=drawPoints
 const warm=advances.filter(t=>t>start+2000);for(let i=1;i<warm.length;i++)times.push(warm[i]-warm[i-1]);const sorted=times.toSorted((a,b)=>a-b),g=gpu.slice(100).toSorted((a,b)=>a-b),c=cpu.slice(100).toSorted((a,b)=>a-b)
 const scenes=[...window.__cabinVisual.getMountedRenderScenes().values()];const meshes=[];for(const s of scenes)s.traverse(o=>{if(o.name==='Factored Particle instances')meshes.push(o)})
 const mesh=meshes[0];let pick=null
 if(mesh){const u=mesh.material.uniforms,m=u.uPlacement.value.clone(),tmp=m.clone();for(let i=0;i<u.uStages.value;i++)m.multiply(tmp.fromArray(u.uLayouts.value.image.data,u.uOffsets.value[i]*16));const pos=mesh.position.clone().setFromMatrixPosition(m);pos.project(state.camera);state.raycaster.setFromCamera({x:pos.x,y:pos.y},state.camera);const hits=[];const start=performance.now();mesh.raycast(state.raycaster,hits);pick={hits:hits.length,ms:performance.now()-start,ndc:[pos.x,pos.y],distance:hits[0]?.distance}}
 return {canvas:[state.gl.domElement.width,state.gl.domElement.height],visibility:document.visibilityState,screen:[screen.width,screen.height],rafFrames:rafs.length,renderer:info&&gl.getParameter(info.UNMASKED_RENDERER_WEBGL),runtime:{...window.__previewRuntime,ambient:!!window.__previewRuntime.ambient},fps:1000/(times.reduce((a,b)=>a+b,0)/times.length),frames:warm.length,frameMedianMs:sorted[Math.floor(sorted.length*.5)],frameP95Ms:sorted[Math.floor(sorted.length*.95)],gpuMedianMs:g[Math.floor(g.length*.5)],gpuP95Ms:g[Math.floor(g.length*.95)],cpuMedianMs:c[Math.floor(c.length*.5)],drawCount:draws.length,instances:draws[0]?.instances,meshes:meshes.length,pick,error:gl.getError()}
});result.errors=errors;result.capacityMode=capacity;result.note=capacity?'Browser display cap disabled: this measures render capacity, not presented display FPS.':'Default browser display timing.';console.log(JSON.stringify(result));await writeFile(resolve(output, 'results.json'),JSON.stringify(result,null,2));await page.screenshot({path:resolve(output, 'editor.png')})
if(errors.length || result.error || result.instances!==1048576 || !result.pick?.hits) process.exitCode=1
}finally{await browser.close()}
