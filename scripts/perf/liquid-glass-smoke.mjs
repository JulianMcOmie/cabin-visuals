// Render the production shader against real texture pixels, including the
// WebGL1 inspector preview. Run: node scripts/perf/liquid-glass-smoke.mjs
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'

const source = `
import * as T from 'three'
import { liquidGlassScenePlugin as plugin } from './src/editor/effects/scene/liquidGlass'
import { sceneFxPreviewFragment } from './src/editor/effects/scene/previewFrame'
const W = 960, H = 600;
const backdrop = document.createElement('canvas'); backdrop.width=W; backdrop.height=H;
const ctx=backdrop.getContext('2d');
ctx.fillStyle='#091522';ctx.fillRect(0,0,W,H);
for (const [x,y,r,color] of [[220,210,300,'#285fff'],[720,320,300,'#ff6540'],[460,490,250,'#00bb99']]) {
  const gradient=ctx.createRadialGradient(x,y,0,x,y,r);
  gradient.addColorStop(0,color);gradient.addColorStop(1,'transparent');
  ctx.fillStyle=gradient;ctx.fillRect(0,0,W,H);
}
ctx.strokeStyle='#ffffff55';ctx.lineWidth=1;
for(let x=0;x<W;x+=40){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,H);ctx.stroke()}
for(let y=0;y<H;y+=40){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke()}
ctx.fillStyle='#ffffff';ctx.font='700 85px sans-serif';ctx.textAlign='center';ctx.fillText('LIQUID / LIGHT',W/2,H/2+25);
const texture=new T.CanvasTexture(backdrop);texture.generateMipmaps=false;texture.minFilter=T.LinearFilter;
const renderer=new T.WebGLRenderer({antialias:false});renderer.setSize(W,H);
renderer.toneMapping=T.NoToneMapping;renderer.outputColorSpace=T.LinearSRGBColorSpace;
document.body.append(renderer.domElement);
const uniforms={tDiffuse:{value:texture},aspect:{value:W/H},time:{value:2}};
for(const p of plugin.params)uniforms[p.key]={value:p.default};
const material=new T.ShaderMaterial({uniforms,depthTest:false,depthWrite:false,
  vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position,1.0);}',fragmentShader:plugin.fragmentShader});
const scene=new T.Scene();const quad=new T.Mesh(new T.PlaneGeometry(2,2),material);scene.add(quad);
const camera=new T.OrthographicCamera(-1,1,1,-1,0,2);
const target=new T.WebGLRenderTarget(W,H);
const same=(a,b)=>a.every((v,i)=>v===b[i]);
function check(value,message){if(!value)throw Error(message)}
function draw(){renderer.setRenderTarget(target);renderer.render(scene,camera);
 const bytes=new Uint8Array(W*H*4);renderer.readRenderTargetPixels(target,0,0,W,H,bytes);
 check(renderer.getContext().getError()===0,'WebGL error');return bytes;}
const wet=draw();uniforms.amount.value=0;const dry=draw();
check(!same(wet,dry),'Default glass has no visible effect');
// Independent exact bypass: compare with a plain texture copy shader.
const copy=new T.ShaderMaterial({uniforms,vertexShader:material.vertexShader,fragmentShader:'uniform sampler2D tDiffuse;varying vec2 vUv;void main(){gl_FragColor=texture2D(tDiffuse,vUv);}'});
quad.material=copy;check(same(dry,draw()),'Amount zero is not a bit-exact texture copy');quad.material=material;
uniforms.amount.value=1;
for(let y=0;y<H;y++)for(let x=0;x<W;x++){
 if(x>W*0.2&&x<W*0.8&&y>H*0.18&&y<H*0.82)continue;
 const i=(y*W+x)*4;for(let c=0;c<4;c++)check(wet[i+c]===dry[i+c],'Glass changes pixels outside its panel');
}
for(const [key,value] of Object.entries({refraction:0,frost:1,width:0.3,height:0.3,corners:1,positionX:0.4,positionY:0.4,angle:30,ripple:1,flow:1.4,sheen:0,fringe:1})){
 const previous=uniforms[key].value;uniforms[key].value=value;
 check(!same(wet,draw()),key+' has no effect on pixels');uniforms[key].value=previous;
}
uniforms.time.value=7;const at7=draw();uniforms.time.value=1;draw();uniforms.time.value=7;
const back7=draw();check(same(at7,back7),'Seek-back differs from direct seek: '+at7.reduce((n,v,i)=>n+(v!==back7[i]?1:0),0)+' channels; max '+at7.reduce((n,v,i)=>Math.max(n,Math.abs(v-back7[i])),0));
uniforms.flow.value=0;const frozen=draw();uniforms.time.value=13;const frozenAgain=draw();check(same(frozen,frozenAgain),'Flow zero still animates: '+frozen.reduce((n,v,i)=>n+(v!==frozenAgain[i]?1:0),0)+' channels; max '+frozen.reduce((n,v,i)=>Math.max(n,Math.abs(v-frozenAgain[i])),0));
uniforms.flow.value=0.5;uniforms.time.value=2;
// Preserve arbitrary scene alpha, even where the refracted sample is opaque.
const alphaData=new Uint8Array(64*64*4);
for(let i=0;i<64*64;i++){alphaData[i*4]=i%256;alphaData[i*4+1]=127;alphaData[i*4+2]=210;alphaData[i*4+3]=i%251;}
const alphaTexture=new T.DataTexture(alphaData,64,64);alphaTexture.needsUpdate=true;uniforms.tDiffuse.value=alphaTexture;
const alphaWet=draw();uniforms.amount.value=0;const alphaDry=draw();
check(alphaWet.every((v,i)=>i%4!==3||v===alphaDry[i]),'Glass changes scene alpha');
uniforms.tDiffuse.value=texture;uniforms.amount.value=1;
// Exercise portrait framing, rotated/off-frame and all parameter extremes.
uniforms.aspect.value=9/16;check(!same(draw(),dry),'Portrait glass is missing');
for(const edge of ['min','max']){for(const p of plugin.params)uniforms[p.key].value=p[edge];draw()}
for(const p of plugin.params)uniforms[p.key].value=p.default;
uniforms.aspect.value=W/H;
// Compile the actual transformed inspector shader on its WebGL1 path too.
const preview=document.createElement('canvas').getContext('webgl');
const program=preview.createProgram();
for(const [type,code] of [[preview.VERTEX_SHADER,'attribute vec2 aPos;varying vec2 vUv;void main(){vUv=aPos*0.5+0.5;gl_Position=vec4(aPos,0.,1.);}'],[preview.FRAGMENT_SHADER,sceneFxPreviewFragment(plugin.fragmentShader)]]){
 const shader=preview.createShader(type);preview.shaderSource(shader,code);preview.compileShader(shader);
 check(preview.getShaderParameter(shader,preview.COMPILE_STATUS),preview.getShaderInfoLog(shader));preview.attachShader(program,shader);
}
preview.linkProgram(program);check(preview.getProgramParameter(program,preview.LINK_STATUS),preview.getProgramInfoLog(program));
window.glassCapture=(amount)=>{uniforms.amount.value=amount;renderer.setRenderTarget(null);renderer.render(scene,camera);return renderer.domElement.toDataURL();};
window.glassResults=['Production and inspector shaders compile without GL errors','All 13 controls affect pixels; exterior pixels and alpha are preserved','Amount zero is an exact bypass; Flow zero freezes; seek-back is pixel exact','Portrait, rotation, off-frame positions and parameter extremes render'];
`
const built = await build({ stdin: { contents: source, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'iife' })
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] })
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 600 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(String(error)))
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
  await page.setContent('<!doctype html><html><body style="margin:0"></body></html>')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  const results = await page.evaluate(() => window.glassResults)
  if (errors.length || !results) throw Error(errors.join('\n') || 'GPU checks did not finish')
  await mkdir('artifacts/liquid-glass', { recursive: true })
  for (const [name, amount] of [['before', 0], ['after', 1]]) {
    const png = await page.evaluate((value) => window.glassCapture(value), amount)
    const { writeFile } = await import('node:fs/promises')
    await writeFile(`artifacts/liquid-glass/${name}.png`, Buffer.from(png.split(',')[1], 'base64'))
  }
  console.log(results.join('\n'))
} finally { await browser.close() }
