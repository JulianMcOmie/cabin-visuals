import assert from 'node:assert/strict'
import {chromium} from 'playwright'
const browser=await chromium.launch({headless:true,args:['--enable-unsafe-swiftshader']})
try{
const page=await browser.newPage({viewport:{width:1200,height:900}}),errors=[]
page.on('pageerror',e=>errors.push(String(e)))
await page.addInitScript(()=>{
 const NativeWorker=window.Worker;window.__workerMessages=[]
 window.Worker=class extends NativeWorker{
  fixtureScene
  constructor(...args){super(...args);this.addEventListener('message',e=>{const d=e.data;if(d.pixels)window.__workerMessages.push({id:d.id,error:d.error,renderError:d.renderError,lit:d.pixels.data.some((v,i)=>i%4!==3&&v>10)})})}
  postMessage(data,...rest){
   if(data&&typeof data.id==='number'&&'beat' in data){
    data={...data,beat:1}
    if(data.project){
     const p=data.project,sceneId=Object.keys(p.scenes).find(id=>!p.scenes[id].isMain)
     this.fixtureScene=sceneId
     const track={id:'production-probe',name:'Cube',instrumentId:'cube',type:'base',color:'#fff',muted:false,solo:false,childIds:[],params:{size:1,textured:1,finish:1},blocks:[{id:'b',startBar:0,durationBars:4,loop:false,notes:[{id:'n',pitch:60,startBeat:0,durationBeats:4,velocity:100}]}]}
     const scene={...p.scenes[sceneId],tracks:{[track.id]:track},rootTrackIds:[track.id]}
     const mainId=Object.keys(p.scenes).find(id=>p.scenes[id].isMain)
     const comp={...track,id:'comp',instrumentId:'scene',blocks:[],sceneBindings:[{sceneId,pitch:60}]}
     data.project={...p,scenes:{...p.scenes,[sceneId]:scene,[mainId]:{...p.scenes[mainId],tracks:{comp},rootTrackIds:['comp']}},tracks:scene.tracks,rootTrackIds:scene.rootTrackIds}
    }
    data.sceneId=this.fixtureScene
   }
   return super.postMessage(data,...rest)
  }
 }
})
await page.goto(`${process.env.BASE ?? 'http://localhost:3197'}/editor`,{waitUntil:'domcontentloaded',timeout:60000})
await page.waitForFunction(()=>{const c=[...document.querySelectorAll('canvas')].find(c=>c.style.pointerEvents==='none'&&c.style.display!=='none'&&c.width>300);return c&&c.getContext('2d').getImageData(0,0,c.width,c.height).data.some((v,i)=>i%4!==3&&v>10)},null,{timeout:30000})
const result=await page.evaluate(()=>({frames:window.__workerMessages,devHooks:!!window.__cabinVisual}))
assert.ok(result.frames.some(f=>f.lit),'cold paused scene must settle without a document edit')
assert.ok(result.frames.every(f=>!f.error&&!f.renderError))
assert.deepEqual(errors,[])
console.log(JSON.stringify({...result,errors,fixture:'initial textured cube at worker protocol boundary'}))
console.log('cold worker presentation passed')
}finally{await browser.close()}
