import { chromium } from 'playwright'
import { build } from 'esbuild'
const bundle=await build({entryPoints:['scripts/perf/particle-plan-fixture.ts'],bundle:true,write:false,format:'iife',globalName:'ParticleBench',define:{'process.env.NODE_ENV':'"production"'}})
import {mkdir,writeFile} from 'node:fs/promises'
const browser=await chromium.launch({headless:false,args:process.platform === 'darwin' ? ['--use-angle=metal'] : []})
try {
const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())})
await page.setContent('<body></body>');await page.addScriptTag({content:bundle.outputFiles[0].text})
const result=await page.evaluate(()=>{
const {THREE:T,createParticlePlanMesh,gridSplitter,mergeDefinitionSettings,compileParticlePlan,particlePlanMatrix}=ParticleBench
const renderer=new T.WebGLRenderer({preserveDrawingBuffer:true});renderer.setSize(640,480);document.body.appendChild(renderer.domElement)
const scene=new T.Scene(),camera=new T.PerspectiveCamera(45,640/480,.1,100);camera.position.z=8;camera.updateMatrixWorld()
const gl=renderer.getContext(),ray=new T.Raycaster(),matrix=new T.Matrix4(),pos=new T.Vector3()
const plan=n=>compileParticlePlan([gridSplitter.resolve({settings:mergeDefinitionSettings(gridSplitter,{rows:n,columns:n,spacing:.3}),notes:[]})])
const pool=createParticlePlanMesh(plan(4),true);pool.mesh.material.uniforms.uMeshScale.value=.02;scene.add(pool.mesh)
const checks=[]
for(const n of [4,32,2,4]){
 const layout=plan(n);pool.update(layout);renderer.render(scene,camera)
 particlePlanMatrix(layout,0,matrix);pos.setFromMatrixPosition(matrix);const expected=pos.distanceTo(camera.position);pos.project(camera);ray.setFromCamera(pos,camera)
 // Reproduce an in-flight thumbnail's pixel-pack binding.
 const pack=gl.createBuffer();gl.bindBuffer(gl.PIXEL_PACK_BUFFER,pack);gl.bufferData(gl.PIXEL_PACK_BUFFER,64,gl.STREAM_READ)
 const beforeTarget=renderer.getRenderTarget(),beforeViewport=renderer.getViewport(new T.Vector4()),hits=[]
 pool.mesh.raycast(ray,hits)
 const restored=beforeTarget===renderer.getRenderTarget()&&beforeViewport.equals(renderer.getViewport(new T.Vector4()))&&gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING)===pack
 gl.bindBuffer(gl.PIXEL_PACK_BUFFER,null);gl.deleteBuffer(pack)
 ray.setFromCamera({x:.99,y:.99},camera);const miss=[];pool.mesh.raycast(ray,miss)
 pool.mesh.visible=false;const hidden=[];pool.mesh.raycast(ray,hidden);pool.mesh.visible=true
 renderer.render(scene,camera)
 checks.push({count:layout.count,drawCount:renderer.info.render.calls,instances:pool.mesh.geometry.drawRange.count,hits:hits.length,distanceError:Math.abs((hits[0]?.distance??0)-expected),misses:miss.length,hidden:hidden.length,restored,error:gl.getError()})
}
pool.dispose();renderer.dispose();return checks
});if(errors.length||result.some(r=>r.hits!==1||r.distanceError>.001||r.misses||r.hidden||!r.restored||r.error||r.instances!==r.count))throw new Error(JSON.stringify({result,errors}));console.log(JSON.stringify({result,errors}));await mkdir('artifacts/million-particles',{recursive:true});await writeFile('artifacts/million-particles/gpu-validation.json',JSON.stringify({result,errors},null,2))
}finally{await browser.close()}
