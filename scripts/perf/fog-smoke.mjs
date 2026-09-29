// Actual WebGL depth + production fog shader, independent of editor/auth.
// Run from the repo root: node scripts/perf/fog-smoke.mjs
import { build } from 'esbuild'
import { chromium } from 'playwright'

const source = `
import * as T from 'three'
import { fogScenePlugin } from './src/editor/effects/scene/fog'
import { createFogUniforms, syncFogUniforms } from './src/editor/effects/scene/fogRuntime'
const renderer = new T.WebGLRenderer({antialias:false}); renderer.setSize(96,64)
renderer.toneMapping=T.NoToneMapping; renderer.outputColorSpace=T.LinearSRGBColorSpace
const target=new T.WebGLRenderTarget(96,64,{stencilBuffer:true})
target.depthTexture=new T.DepthTexture(96,64,T.UnsignedInt248Type); target.depthTexture.format=T.DepthStencilFormat
const output=new T.WebGLRenderTarget(96,64)
const scene=new T.Scene(), camera=new T.PerspectiveCamera(50,1.5,0.1,80)
camera.position.z=10; camera.updateMatrixWorld()
const light=new T.PointLight(0xff0000,18,30); light.position.set(-2,0,2);scene.add(light)
const occluder=new T.Mesh(new T.PlaneGeometry(200,200),new T.MeshBasicMaterial({color:0x000000}))
occluder.visible=false;scene.add(occluder)
const uniforms={...createFogUniforms(),tDiffuse:{value:target.texture},time:{value:0}}
for(const p of fogScenePlugin.params) uniforms[p.key]={value:p.default}
uniforms.amount.value=1;uniforms.density.value=0.7
const material=new T.ShaderMaterial({uniforms,depthTest:false,depthWrite:false,
 vertexShader:'varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position,1.0);}',fragmentShader:fogScenePlugin.fragmentShader})
const post=new T.Scene(),quad=new T.Mesh(new T.PlaneGeometry(2,2),material);post.add(quad)
const postCamera=new T.OrthographicCamera(-1,1,1,-1,0,2)
function draw(){renderer.setRenderTarget(target);renderer.setClearColor(0,1);renderer.clear();renderer.render(scene,camera)
 syncFogUniforms(material,scene,camera,target.depthTexture)
 renderer.setRenderTarget(output);renderer.render(post,postCamera)
 const bytes=new Uint8Array(96*64*4);renderer.readRenderTargetPixels(output,0,0,96,64,bytes)
 if(renderer.getContext().getError()!==0) throw Error('WebGL error')
 return bytes}
const sum=(b,c)=>b.reduce((s,v,i)=>s+(i%4===c?v:0),0)
const same=(a,b)=>a.every((v,i)=>v===b[i])
const red=draw();if(sum(red,0)<1000 || sum(red,1)!==0 || sum(red,2)!==0) throw Error('Fog did not catch red light')
light.color.set(0x0000ff);const blue=draw();if(sum(blue,2)<1000 || sum(blue,0)!==0) throw Error('Light color did not update')
light.position.x=2;const moved=draw();if(same(blue,moved)) throw Error('Moving light did not move fog')
light.visible=false;const dark=draw();if(sum(dark,0)+sum(dark,1)+sum(dark,2)!==0) throw Error('Muted light still illuminates fog')
light.visible=true;uniforms.amount.value=0;const dry=draw();if(!same(dark,dry)) throw Error('Amount zero is not dry')
uniforms.amount.value=1;uniforms.time.value=7;const at7=draw();uniforms.time.value=1;draw();uniforms.time.value=7
if(!same(at7,draw())) throw Error('Seek-back is not pixel exact')
occluder.visible=true;occluder.position.z=9.8;const near=draw();if(sum(near,2)>=sum(at7,2)*0.1) throw Error('Fog leaks through foreground depth')
occluder.position.z=-10;const far=draw();if(sum(far,2)<=sum(near,2)*5) throw Error('Far surfaces do not gather more haze')
// Zero-density must also be a true bypass.
uniforms.density.value=0;if(!same(dry,draw())) throw Error('Zero density changed the image')
window.fogResults=['GLSL compiled with depth-stencil sampling; no GL errors','Moving/colored/muted lights change actual fog pixels','Amount and density zero bypass; seek-back is pixel exact','Opaque near surfaces occlude haze; distant surfaces collect more fog']
renderer.dispose();target.dispose();output.dispose();material.dispose();quad.geometry.dispose();occluder.geometry.dispose();occluder.material.dispose()
`
const built = await build({stdin:{contents:source,resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'iife'})
const browser = await chromium.launch({args:['--enable-unsafe-swiftshader']})
try {
  const page = await browser.newPage()
  const errors=[]
  page.on('pageerror',e=>errors.push(String(e)))
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text())})
  await page.setContent('<!doctype html><html><body></body></html>')
  await page.addScriptTag({content:built.outputFiles[0].text})
  const results=await page.evaluate(()=>window.fogResults)
  if(errors.length || !results) throw Error(errors.join('\n') || 'Fog GPU checks did not finish')
  console.log(results.join('\n'))
} finally {await browser.close()}
