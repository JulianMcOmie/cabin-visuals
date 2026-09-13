import { readFileSync } from 'node:fs'
import { build } from 'esbuild'
import { chromium } from 'playwright'
const file = readFileSync('src/editor/components/visual/VisualScene.tsx', 'utf8')
const part = (start, end) => file.slice(file.indexOf(start), file.indexOf(end, file.indexOf(start)))
// Compile the production material and layer assignment directly, without editor/auth.
const source = `
import { Mesh, MeshBasicMaterial, BufferGeometry, Float32BufferAttribute, Vector2, Vector4,
 CustomBlending, AddEquation, OneMinusDstColorFactor, OneMinusSrcAlphaFactor, OneFactor,
 Scene, OrthographicCamera, WebGLRenderer, WebGLRenderTarget, DataTexture, RGBAFormat,
 UnsignedByteType, LinearSRGBColorSpace, NearestFilter } from 'three'
${part('interface PartitionUniforms {', 'function disposeMountedScene')}
${part('function makeCompositorGeometry()', 'const COLOR_FILTER_VERTEX')}
${part('function setPartitionGeometry(', '/** The per-pass light rig.')}
const renderer = new WebGLRenderer({antialias:false}); renderer.setSize(100,100)
renderer.outputColorSpace = LinearSRGBColorSpace
const scene = new Scene(), camera = new OrthographicCamera(-1,1,1,-1,0,2)
camera.position.z = 1
const mesh = new Mesh(makeCompositorGeometry(),makeCompositorMaterial()); scene.add(mesh)
const output = new WebGLRenderTarget(100,100)
function texture(bytes, w=1,h=1) {const t=new DataTexture(new Uint8Array(bytes),w,h,RGBAFormat,UnsignedByteType);t.needsUpdate=true;t.magFilter=NearestFilter;t.minFilter=NearestFilter;return t}
const red=texture([255,0,0,255]), blue=texture([0,0,255,255])
const layer={directorTrackId:'switcher',sceneId:'b',opacity:1,viewport:{x:0,y:0,width:1,height:1}}
function draw(l,t=blue,s=red){ applyCompositorLayer(mesh,l,0,t,1,s);renderer.setRenderTarget(output);renderer.setClearColor(0,0);renderer.clear();renderer.render(scene,camera);const bytes=new Uint8Array(4);renderer.readRenderTargetPixels(output,50,50,1,1,bytes);return [...bytes] }
function close(a,b){if(a.some((v,i)=>Math.abs(v-b[i])>2))throw Error(JSON.stringify({actual:a,expected:b}))}
close(draw({...layer,crossfade:{sceneId:'a',mix:0}}),[255,0,0,255])
close(draw({...layer,crossfade:{sceneId:'a',mix:.5}}),[128,0,128,255])
close(draw(layer),[0,0,255,255])
close(draw({...layer,motion:{x:.8,y:0,scale:1,rotation:0}}),[0,0,0,0])
close(draw({...layer,motion:{x:0,y:0,scale:2,rotation:Math.PI/4}}),[0,0,255,255])
// A reused material must reset its transform for the next ordinary layer.
close(draw(layer),[0,0,255,255])
if(renderer.getContext().getError()!==0)throw Error('WebGL error')
window.result='PASS: production shaders compile; true midpoint crossfade, motion clipping/rotation/scale, and pooled-material reset match expected pixels'
`
const built = await build({ stdin: { contents: source, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'iife' })
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] })
try {
 const page = await browser.newPage(), errors=[]
 page.on('pageerror', e => errors.push(String(e)))
 page.on('console', m => {if(m.type()==='error') errors.push(m.text())})
 await page.setContent('<!doctype html><body></body>')
 await page.addScriptTag({content: built.outputFiles[0].text})
 const result = await page.evaluate(()=>window.result)
 if(errors.length || !result)throw Error(errors.join('\n') || 'GPU check failed')
 console.log(result)
} finally { await browser.close() }
