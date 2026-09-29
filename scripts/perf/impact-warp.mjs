// Run: node --import tsx scripts/perf/impact-warp.mjs
// Compiles the production compositor shader; compares real GPU pixels.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'
import { IMPACT_WARP_FIELD_GLSL, IMPACT_WARP_SECONDS, impactDrive, impactEnvelope } from '../../src/editor/instruments/ImpactWarp.tsx'
const sceneSource = readFileSync(new URL('../../src/editor/components/visual/VisualScene.tsx', import.meta.url), 'utf8')
const fragment = sceneSource.match(/const IMPACT_WARP_FRAGMENT = `([\s\S]*?)`/)[1].replace('${IMPACT_WARP_FIELD_GLSL}', IMPACT_WARP_FIELD_GLSL)
const samples = [0, .025, .06, .1014, .25, .4, .5148, .68, .78].map(seconds => ({ seconds, amount: impactDrive(impactEnvelope(seconds / IMPACT_WARP_SECONDS)) }))
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] })
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 1050 } })
  await page.setContent('<body style="margin:24px;background:#090d15;color:#ddd;font:14px system-ui"><h2>Impact Warp · production shader</h2><p>Full intensity · smooth attack, recovery, restrained rebound</p><div id="frames" style="display:grid;grid-template-columns:repeat(3,1fr);gap:18px"></div>')
  const result = await page.evaluate(({ fragment, samples }) => {
    const results = []
    for (const [w, h] of [[384, 216], [256, 256], [216, 384]]) {
      const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h
      const gl = canvas.getContext('webgl', { preserveDrawingBuffer: true, antialias: false })
      const compile = (type, source) => {
        const shader = gl.createShader(type); gl.shaderSource(shader, source); gl.compileShader(shader)
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(shader))
        return shader
      }
      const program = gl.createProgram()
      gl.attachShader(program, compile(gl.VERTEX_SHADER, 'attribute vec2 position; varying vec2 vUv; void main(){vUv=position*.5+.5;gl_Position=vec4(position,0.,1.);}'))
      gl.attachShader(program, compile(gl.FRAGMENT_SHADER, 'precision highp float;\n' + fragment)); gl.linkProgram(program)
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(program))
      gl.useProgram(program)
      const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW)
      const attr = gl.getAttribLocation(program, 'position'); gl.enableVertexAttribArray(attr); gl.vertexAttribPointer(attr, 2, gl.FLOAT, false, 0, 0)
      const input = new Uint8Array(w*h*4)
      // Symmetric, sharp landmarks at several radii; grayscale detects RGB drift.
      for(let y=0;y<h;y++) for(let x=0;x<w;x++) {
        const dx=Math.abs((x+.5)/w-.5),dy=Math.abs((y+.5)/h-.5)
        const a=Math.abs(dx-.19)<.035&&Math.abs(dy-.19)<.045
        const b=Math.abs(dx-.36)<.025&&Math.abs(dy-.36)<.035
        const value=a?230:b?140:12, i=(y*w+x)*4
        input.set([value,value,value,255],i)
      }
      const texture = gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture)
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE)
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,input)
      gl.uniform1i(gl.getUniformLocation(program,'tDiffuse'),0)
      const render = amount => {
        gl.uniform1f(gl.getUniformLocation(program,'amount'),amount);gl.drawArrays(gl.TRIANGLES,0,6)
        const pixels=new Uint8Array(w*h*4);gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,pixels);return pixels
      }
      const baseline=render(0)
      if(!baseline.every((v,i)=>v===input[i])) throw Error('zero intensity is not exact identity')
      let peakDifference=0
      for(const sample of samples){
        const pixels=render(sample.amount)
        for(let y=0;y<h;y++)for(let x=0;x<w;x++){
          const i=(y*w+x)*4,mx=(y*w+w-1-x)*4,my=((h-1-y)*w+x)*4
          if(pixels[i]!==pixels[mx]||pixels[i]!==pixels[my])throw Error(`symmetry failed ${w}x${h}`)
          if(pixels[i]!==pixels[i+1]||pixels[i]!==pixels[i+2])throw Error('color channels separated')
        }
        if(sample.seconds===.1014) peakDifference=pixels.filter((v,i)=>v!==baseline[i]).length
        if(w===384){const card=document.createElement('div');card.innerHTML=`<p>${Math.round(sample.seconds*1000)} ms</p><img style="width:100%" src="${canvas.toDataURL()}">`;document.querySelector('#frames').append(card)}
        // Seek away and back must restore exact GPU output.
        render(-.5);const repeated=render(sample.amount)
        if(!pixels.every((v,i)=>v===repeated[i]))throw Error('repeated frame differs')
      }
      results.push({w,h,peakDifference,zeroExact:true,symmetry:true,repeatExact:true})
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    }
    return results
  }, { fragment, samples })
  for (const r of result) assert.ok(r.peakDifference > 1000)
  await page.screenshot({ path: 'artifacts/impact-warp/shader-contact-sheet.png' })
  console.log(JSON.stringify(result))
} finally { await browser.close() }
