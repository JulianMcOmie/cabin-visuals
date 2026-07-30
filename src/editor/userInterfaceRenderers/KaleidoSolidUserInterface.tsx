'use client'

import { useEffect, useRef, useState } from 'react'
import { KALEIDO_FIELD_GLSL } from '../effects/materials/kaleidoField'
import {
  FUNDAMENTAL_GEOMETRIES,
  normalizeFundamentalGeometry,
  type FundamentalGeometryId,
} from '../instruments/FundamentalGeometry'
import { isNumberParam, type NumberParamDef } from '../instruments/types'
import { ParamControl, ParamHueSlider, ParamSlider, ParamStepper } from './ParameterControl'
import { ParameterList } from './ParametersUserInterface'
import type { UserInterfaceParameter, UserInterfaceRendererDefinition } from './types'

// Kaleido Solid settings: a geometry row, a live preview, then the four knobs.
//
// The preview runs the instrument's own KALEIDO_FIELD_GLSL, so the field cannot
// drift from what renders. It evaluates it over an orthographic sphere - the
// object-space direction at each pixel of a front-facing sphere is just
// (x, y, sqrt(1-x²-y²)) - tilted so the pole mandala faces the viewer. Lighting
// here is a single lambert term, not the scene's real physical material, so read
// it as the pattern's character rather than an exact colour match.
//
// A rAF clock drives `time`. That is fine in PANEL code - the pause invariant
// governs the rendered visual, where the shader's beat comes from the transport;
// this canvas is chrome.

const PREVIEW_PX = 148
const BEATS_PER_SECOND = 2

const QUAD_VERT = `
  attribute vec2 aPos;
  varying vec2 vUv;
  void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }
`

const PREVIEW_FRAG = `
  precision highp float;
  varying vec2 vUv;
${KALEIDO_FIELD_GLSL}
  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float r2 = dot(p, p);
    if (r2 > 1.0) { gl_FragColor = vec4(0.0); return; }
    // Object-space direction on a front-facing unit sphere.
    vec3 dir = vec3(p.x, p.y, sqrt(max(0.0, 1.0 - r2)));
    // Tilt the pole toward the viewer so the mandala reads, like looking down at a globe.
    float ca = cos(0.62), sa = sin(0.62);
    dir = vec3(dir.x, ca * dir.y - sa * dir.z, sa * dir.y + ca * dir.z);

    vec3 col = kaleidoField(dir);
    float lam = clamp(dot(normalize(vec3(-0.45, 0.6, 0.75)), dir), 0.0, 1.0);
    col *= 0.35 + 0.9 * lam;
    col += pow(lam, 6.0) * 0.16;
    gl_FragColor = vec4(col, 1.0);
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
    console.warn('[KaleidoSolid preview] shader compile failed:', gl.getShaderInfoLog(shader))
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
    console.warn('[KaleidoSolid preview] program link failed:', gl.getProgramInfoLog(program))
    gl.deleteProgram(program)
    return null
  }
  return program
}

function KaleidoPreview({ facets, scale, drift, hue }: {
  facets: number
  scale: number
  drift: number
  hue: number
}) {
  // The canvas is created INSIDE the effect, not rendered by React: cleanup calls
  // loseContext(), which permanently kills that canvas's context, and StrictMode
  // double-invokes effects in dev - a React-owned canvas would come back with a
  // dead context and every compile would fail with an empty info log.
  const hostRef = useRef<HTMLDivElement>(null)
  const [failed, setFailed] = useState(false)

  const paramsRef = useRef({ facets, scale, drift, hue })
  paramsRef.current = { facets, scale, drift, hue }

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const canvas = document.createElement('canvas')
    canvas.dataset.testid = 'kaleido-solid-preview'
    canvas.setAttribute('aria-label', 'Kaleido Solid preview')
    canvas.title = 'Live preview: the instrument’s own field, on a sphere'
    canvas.style.width = `${PREVIEW_PX}px`
    canvas.style.height = `${PREVIEW_PX}px`
    canvas.style.borderRadius = '50%'
    host.appendChild(canvas)

    const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: false, antialias: true })
    if (!gl || gl.isContextLost()) { setFailed(true); canvas.remove(); return }

    const program = link(gl, QUAD_VERT, PREVIEW_FRAG)
    if (!program) { setFailed(true); canvas.remove(); return }

    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const size = Math.max(1, Math.round(PREVIEW_PX * dpr))
    canvas.width = size
    canvas.height = size

    const quad = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, quad)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    const loc = gl.getAttribLocation(program, 'aPos')
    gl.enableVertexAttribArray(loc)
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)

    const U = {
      beat: gl.getUniformLocation(program, 'uKBeat'),
      facets: gl.getUniformLocation(program, 'uKFacets'),
      scale: gl.getUniformLocation(program, 'uKScale'),
      drift: gl.getUniformLocation(program, 'uKDrift'),
      hue: gl.getUniformLocation(program, 'uKHue'),
      twist: gl.getUniformLocation(program, 'uKTwist'),
    }

    gl.disable(gl.DEPTH_TEST)
    gl.disable(gl.BLEND)
    gl.viewport(0, 0, size, size)
    gl.useProgram(program)

    let frame = 0
    const start = performance.now()
    const draw = () => {
      const p = paramsRef.current
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.uniform1f(U.beat, ((performance.now() - start) / 1000) * BEATS_PER_SECOND)
      gl.uniform1f(U.facets, p.facets)
      gl.uniform1f(U.scale, p.scale)
      gl.uniform1f(U.drift, p.drift)
      gl.uniform1f(U.hue, p.hue)
      gl.uniform1f(U.twist, 0)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      frame = requestAnimationFrame(draw)
    }
    frame = requestAnimationFrame(draw)

    return () => {
      cancelAnimationFrame(frame)
      gl.deleteBuffer(quad)
      gl.deleteProgram(program)
      // Panels mount and unmount on every track selection; without this the
      // browser's WebGL context budget runs out and the VIEWPORT loses its
      // context. Safe because this canvas is ours and is discarded next.
      gl.getExtension('WEBGL_lose_context')?.loseContext()
      canvas.remove()
    }
  }, [])

  return (
    <div className="mb-3 flex justify-center rounded-[3px] border border-[var(--border)] bg-[var(--bg-canvas-deep)] py-2.5">
      {failed ? (
        <div
          className="flex items-center justify-center text-[10px] text-[var(--text-muted)]"
          style={{ width: PREVIEW_PX, height: PREVIEW_PX }}
        >
          preview unavailable
        </div>
      ) : (
        <div ref={hostRef} style={{ width: PREVIEW_PX, height: PREVIEW_PX }} />
      )}
    </div>
  )
}

function GeometryRow({ bound }: { bound: UserInterfaceParameter }) {
  const selected: FundamentalGeometryId = normalizeFundamentalGeometry(bound.value)
  return (
    <div className="mb-3 grid grid-cols-6 gap-1">
      {FUNDAMENTAL_GEOMETRIES.map((option) => {
        const active = option.id === selected
        return (
          <button
            key={option.id}
            data-testid={`kaleido-geometry-${option.id}`}
            aria-label={`Use ${option.label} geometry`}
            aria-pressed={active}
            onClick={() => bound.setValue(option.id)}
            className={`flex min-w-0 items-center justify-center rounded-[3px] border py-1.5 text-[6px] font-semibold tracking-[0.06em] transition-colors ${active
              ? 'border-violet-300/35 bg-violet-500/16 text-violet-100'
              : 'border-white/[0.07] bg-white/[0.025] text-white/30 hover:bg-white/[0.06] hover:text-white/65'}`}
          >
            <span className="max-w-full truncate">{option.shortLabel}</span>
          </button>
        )
      })}
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

export const KaleidoSolidUserInterfaceRenderer: UserInterfaceRendererDefinition = ({ parameters }) => {
  const geometry = parameters.find((p) => p.definition.key === 'geometry')
  const facets = findNumber(parameters, 'facets')
  const scale = findNumber(parameters, 'scale')
  const drift = findNumber(parameters, 'drift')
  const hue = findNumber(parameters, 'hue')
  if (!geometry || !facets || !scale || !drift || !hue) {
    return <ParameterList parameters={parameters} />
  }

  return (
    <section data-testid="kaleido-solid-user-interface">
      <KaleidoPreview facets={facets.value} scale={scale.value} drift={drift.value} hue={hue.value} />
      <GeometryRow bound={geometry} />
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
      <Leftovers parameters={parameters} placed={['geometry', 'facets', 'scale', 'drift', 'hue']} />
    </section>
  )
}
