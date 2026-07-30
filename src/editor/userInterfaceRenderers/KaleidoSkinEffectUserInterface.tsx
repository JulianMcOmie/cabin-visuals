'use client'

import { useEffect, useRef, useState } from 'react'
import { isNumberParam, type NumberParamDef } from '../instruments/types'
import { kaleidoSkinPlugin } from '../effects/shaders/kaleidoSkin'
import { ParamControl, ParamHueSlider, ParamSlider, ParamStepper } from './ParameterControl'
import { ParameterList } from './ParametersUserInterface'
import type { UserInterfaceParameter, UserInterfaceRendererDefinition } from './types'

// Kaleido Skin settings. The preview is not a drawing OF the effect - it runs
// the plugin's own `fragmentShader` in a small WebGL context, over a lit-sphere
// stand-in for the mesh, so it cannot drift out of sync with what renders. It
// mirrors ShaderWrapper's two stages too (shader pass into a byte FBO, then the
// linear→sRGB output pass), which is what makes the colors match the viewport.
//
// A rAF clock drives `time` here. That is fine in PANEL code - the pause
// invariant governs the rendered visual, where `time` is the beat; this canvas
// is chrome, like the animated disc in the Kaleidoscope panel.

const PREVIEW_PX = 132
// Preview clock: ~120bpm, so Drift reads at the tempo most projects sit near.
const BEATS_PER_SECOND = 2

const QUAD_VERT = `
  attribute vec2 aPos;
  varying vec2 vUv;
  void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }
`

// Same conversion as ShaderWrapper's OUTPUT_FRAG: the pass chain works in
// linear space, so without this the preview reads far darker than the viewport.
const SRGB_FRAG = `
  precision highp float;
  uniform sampler2D tDiffuse;
  varying vec2 vUv;
  vec3 lin2srgb(vec3 c) {
    return mix(c * 12.92, 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
  }
  void main() {
    vec4 t = texture2D(tDiffuse, vUv);
    gl_FragColor = vec4(lin2srgb(t.rgb), t.a);
  }
`

type NumberBound = { definition: NumberParamDef; value: number; setValue: (value: number | string) => void }

function findNumber(parameters: readonly UserInterfaceParameter[], key: string): NumberBound | null {
  const bound = parameters.find((p) => p.definition.key === key)
  if (!bound || !isNumberParam(bound.definition) || typeof bound.value !== 'number') return null
  return bound as NumberBound
}

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type)
  if (!shader) return null
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.warn('[KaleidoSkin preview] shader compile failed:', gl.getShaderInfoLog(shader))
    gl.deleteShader(shader)
    return null
  }
  return shader
}

function link(gl: WebGLRenderingContext, vertSource: string, fragSource: string): WebGLProgram | null {
  const vert = compile(gl, gl.VERTEX_SHADER, vertSource)
  const frag = compile(gl, gl.FRAGMENT_SHADER, fragSource)
  if (!vert || !frag) return null
  const program = gl.createProgram()
  if (!program) return null
  gl.attachShader(program, vert)
  gl.attachShader(program, frag)
  gl.linkProgram(program)
  gl.deleteShader(vert)
  gl.deleteShader(frag)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.warn('[KaleidoSkin preview] program link failed:', gl.getProgramInfoLog(program))
    gl.deleteProgram(program)
    return null
  }
  return program
}

/** The stand-in "mesh": a lit sphere, opaque inside the circle and fully
 *  transparent outside it. The alpha is what the shader masks against, and the
 *  bright-to-dark ramp is what its luminance shading reads - so the preview
 *  demonstrates both the silhouette clip and the form modelling. */
function meshStandIn(): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 128
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas
  const gradient = ctx.createRadialGradient(46, 40, 4, 64, 64, 82)
  gradient.addColorStop(0, '#ffffff')
  gradient.addColorStop(0.4, '#9a9a9a')
  gradient.addColorStop(0.8, '#3a3a3a')
  gradient.addColorStop(1, '#101010')
  ctx.fillStyle = gradient
  ctx.beginPath()
  ctx.arc(64, 64, 60, 0, Math.PI * 2)
  ctx.fill()
  return canvas
}

function KaleidoSkinPreview({ facets, scale, drift, hue }: {
  facets: number
  scale: number
  drift: number
  hue: number
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [failed, setFailed] = useState(false)

  // The rAF loop reads the LIVE param values through a ref, so dragging a
  // slider retargets the running animation instead of restarting the context.
  const paramsRef = useRef({ facets, scale, drift, hue })
  paramsRef.current = { facets, scale, drift, hue }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: false, antialias: false })
    if (!gl) { setFailed(true); return }

    const patternProgram = link(gl, QUAD_VERT, `precision highp float;\n${kaleidoSkinPlugin.fragmentShader ?? ''}`)
    const outputProgram = link(gl, QUAD_VERT, SRGB_FRAG)
    if (!patternProgram || !outputProgram) { setFailed(true); return }

    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const size = Math.max(1, Math.round(PREVIEW_PX * dpr))
    canvas.width = size
    canvas.height = size

    const quad = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, quad)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)

    const meshTexture = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, meshTexture)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, meshStandIn())
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)

    // Byte-precision intermediate, matching the real pipeline's render targets -
    // so highlights clip in the preview exactly where they clip on screen.
    const fboTexture = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, fboTexture)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    const fbo = gl.createFramebuffer()
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fboTexture, 0)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)

    gl.disable(gl.DEPTH_TEST)
    gl.disable(gl.BLEND)
    gl.viewport(0, 0, size, size)

    const uniforms = {
      tDiffuse: gl.getUniformLocation(patternProgram, 'tDiffuse'),
      resolution: gl.getUniformLocation(patternProgram, 'resolution'),
      time: gl.getUniformLocation(patternProgram, 'time'),
      facets: gl.getUniformLocation(patternProgram, 'facets'),
      scale: gl.getUniformLocation(patternProgram, 'scale'),
      drift: gl.getUniformLocation(patternProgram, 'drift'),
      hue: gl.getUniformLocation(patternProgram, 'hue'),
    }
    const outputDiffuse = gl.getUniformLocation(outputProgram, 'tDiffuse')

    const bindQuad = (program: WebGLProgram) => {
      const loc = gl.getAttribLocation(program, 'aPos')
      gl.bindBuffer(gl.ARRAY_BUFFER, quad)
      gl.enableVertexAttribArray(loc)
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
    }

    let frame = 0
    const start = performance.now()

    const draw = () => {
      const beat = ((performance.now() - start) / 1000) * BEATS_PER_SECOND
      const p = paramsRef.current

      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.useProgram(patternProgram)
      bindQuad(patternProgram)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, meshTexture)
      gl.uniform1i(uniforms.tDiffuse, 0)
      gl.uniform2f(uniforms.resolution, size, size)
      gl.uniform1f(uniforms.time, beat)
      gl.uniform1f(uniforms.facets, p.facets)
      gl.uniform1f(uniforms.scale, p.scale)
      gl.uniform1f(uniforms.drift, p.drift)
      gl.uniform1f(uniforms.hue, p.hue)
      gl.drawArrays(gl.TRIANGLES, 0, 3)

      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.useProgram(outputProgram)
      bindQuad(outputProgram)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, fboTexture)
      gl.uniform1i(outputDiffuse, 0)
      gl.drawArrays(gl.TRIANGLES, 0, 3)

      frame = requestAnimationFrame(draw)
    }
    frame = requestAnimationFrame(draw)

    return () => {
      cancelAnimationFrame(frame)
      gl.deleteFramebuffer(fbo)
      gl.deleteTexture(fboTexture)
      gl.deleteTexture(meshTexture)
      gl.deleteBuffer(quad)
      gl.deleteProgram(patternProgram)
      gl.deleteProgram(outputProgram)
      // Panels mount and unmount constantly as tracks are selected; without
      // this the browser's WebGL context budget runs out and the VIEWPORT is
      // what loses its context.
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    }
  }, [])

  return (
    <div className="mb-3 flex justify-center rounded-[3px] border border-[var(--border)] bg-[var(--bg-canvas-deep)] py-2">
      {failed ? (
        <div
          className="flex items-center justify-center text-[10px] text-[var(--text-muted)]"
          style={{ width: PREVIEW_PX, height: PREVIEW_PX }}
        >
          preview unavailable
        </div>
      ) : (
        <canvas
          ref={canvasRef}
          data-testid="kaleido-skin-preview"
          aria-label="Kaleido Skin preview"
          title="Live preview: the effect running on a stand-in sphere"
          style={{ width: PREVIEW_PX, height: PREVIEW_PX }}
        />
      )}
    </div>
  )
}

function Leftovers({ parameters, placed }: { parameters: readonly UserInterfaceParameter[]; placed: readonly string[] }) {
  const placedSet = new Set(placed)
  const rest = parameters.filter((p) => !placedSet.has(p.definition.key))
  if (rest.length === 0) return null
  return (
    <div className="mt-3 border-t border-[var(--border)] pt-3">
      {rest.map((p) => {
        const numeric = typeof p.value === 'number'
        return (
          <ParamControl
            key={p.definition.key}
            param={p.definition}
            numValue={numeric ? (p.value as number) : undefined}
            strValue={numeric ? undefined : (p.value as string)}
            onNum={p.setValue}
            onStr={p.setValue}
          />
        )
      })}
    </div>
  )
}

export const KaleidoSkinEffectUserInterfaceRenderer: UserInterfaceRendererDefinition = ({ parameters }) => {
  const facets = findNumber(parameters, 'facets')
  const scale = findNumber(parameters, 'scale')
  const drift = findNumber(parameters, 'drift')
  const hue = findNumber(parameters, 'hue')
  if (!facets || !scale || !drift || !hue) {
    return <ParameterList parameters={parameters} />
  }

  return (
    <section data-testid="kaleido-skin-effect-user-interface">
      <KaleidoSkinPreview facets={facets.value} scale={scale.value} drift={drift.value} hue={hue.value} />
      <ParamStepper
        label={facets.definition.label}
        value={facets.value}
        min={facets.definition.min}
        max={facets.definition.max}
        step={facets.definition.step}
        onChange={facets.setValue}
        downLabel="Fewer facets"
        upLabel="More facets"
      />
      <ParamSlider
        label={scale.definition.label}
        value={scale.value}
        min={scale.definition.min}
        max={scale.definition.max}
        step={scale.definition.step}
        onChange={scale.setValue}
      />
      <ParamSlider
        label={drift.definition.label}
        value={drift.value}
        min={drift.definition.min}
        max={drift.definition.max}
        step={drift.definition.step}
        onChange={drift.setValue}
      />
      <ParamHueSlider
        label={hue.definition.label}
        value={hue.value}
        min={hue.definition.min}
        max={hue.definition.max}
        step={hue.definition.step}
        onChange={hue.setValue}
      />
      <Leftovers parameters={parameters} placed={['facets', 'scale', 'drift', 'hue']} />
    </section>
  )
}
