'use client'

// The Deformer's console. Its shape was chosen from an interactive mock
// (ops=grid, drive=tabs, falloff=section, params=conditional, preview=window),
// and each of those four is a real decision:
//
// - OPERATION is a GRID of twelve glyph tiles, not a segmented strip or a menu.
//   Twelve is far past what a segmented control can hold legibly, and the choice
//   is between SHAPES - a picture says "bend" faster than the word does. Same
//   argument Fundamental Geometry's solid picker makes.
// - DRIVE is the tab rail above the preview, because it is not a parameter of
//   the deformation so much as the clock the whole device runs on: the tabs
//   frame the window rather than sitting in the knob rows.
// - FALLOFF gets its own disclosure. It is four knobs' worth of spatial region
//   that most patches never touch, and inline it doubled the console's height.
// - Only the ACTIVE operation's knobs render. Twelve operations sharing one flat
//   list of fifteen knobs is exactly the spreadsheet this device exists to avoid.
//
// The preview runs the plugin's REAL GLSL (deformFieldGlsl) over a subdivided
// cube, so the picture cannot drift from what the viewport renders - the same
// call KaleidoSolid's panel makes. It is raw WebGL on the shared preview loop
// (console/previewLoop.ts) rather than an r3f <Canvas> because a panel Canvas
// stays black until the transport plays, and a deformation is precisely what
// you dial in while parked.

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { DEFORM_ACCENT } from '../effects/deform/deform'
import { deformFieldGlsl } from '../effects/deform/deformField'
import {
  DEFORM_DRIVES,
  DEFORM_FALLOFFS,
  DEFORM_OPERATIONS,
  DRIVE_STATIC,
  FALLOFF_NONE,
  deformOperation,
} from '../effects/deform/deformOps'
import { subdivideAttributes } from '../effects/deform/subdivideCore'
import { uniformName } from '../effects/uniforms'
import { Console, ControlRow, Knob, PreviewWindow, Segmented, bindPanel, usePreviewLoop } from './console'
import { ParameterList } from './ParametersUserInterface'
import type { UserInterfaceRendererDefinition } from './types'

const PREVIEW_HEIGHT = 156
const PREVIEW_SUFFIX = '_pv'
const BEATS_PER_SECOND = 2
/** Enough that a twist reads as a twist rather than a shear (see
 *  subdivideCore.ts); the preview is one small object, so it can afford one
 *  level more than the effect's own default. */
const PREVIEW_DETAIL = 4

/** Every param the shader reads, so the preview can push all of them each frame
 *  without knowing which operation is live. */
const PREVIEW_UNIFORM_KEYS = [
  'operation', 'drive', 'falloff', 'strength', 'axis', 'angle', 'amount', 'center',
  'width', 'wavelength', 'phase', 'radius', 'seed', 'rate',
  'falloffSize', 'falloffOffset', 'falloffSoftness',
] as const

type PreviewSettings = Record<string, number>

// --- glyphs -----------------------------------------------------------------
// Sketches of the behaviour, not icons of a noun: the tile shows what happens to
// a shape, which is what the user is choosing between.

const GLYPH_PATHS: Record<string, string> = {
  twist: 'M4 3 Q11 6 4 9 M18 3 Q11 6 18 9 M4 12 Q11 15 4 15 M18 12 Q11 9 18 15',
  bend: 'M4 16 Q4 3 18 3 M8 16 Q8 7 18 7',
  taper: 'M4 3 L18 6 L18 10 L4 15 Z',
  shear: 'M4 15 L9 3 L20 3 L15 15 Z',
  bulge: 'M5 3 Q13 9 5 15 M17 3 Q9 9 17 15',
  wave: 'M2 9 Q6 2 10 9 T18 9 M2 14 Q6 7 10 14 T18 14',
  ripple: 'M11 9 m-2 0 a2 2 0 1 0 4 0 a2 2 0 1 0 -4 0 M11 9 m-5 0 a5 5 0 1 0 10 0 a5 5 0 1 0 -10 0 M11 9 m-8 0 a8 8 0 1 0 16 0 a8 8 0 1 0 -16 0',
  inflate: 'M11 9 m-4 0 a4 4 0 1 0 8 0 a4 4 0 1 0 -8 0 M11 2 v3 M11 13 v3 M4 9 h3 M15 9 h3',
  spherify: 'M3 3 h16 v12 h-16 z M11 9 m-5 0 a5 5 0 1 0 10 0 a5 5 0 1 0 -10 0',
  pinch: 'M4 3 Q11 9 4 15 M18 3 Q11 9 18 15',
  melt: 'M5 3 h12 v5 q0 7 -6 7 q-6 0 -6 -7 z',
  jitter: 'M3 9 l3 -5 l2 9 l3 -8 l3 7 l2 -6 l3 4',
}

function Glyph({ id }: { id: string }) {
  return (
    <svg viewBox="0 0 22 18" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[22px]">
      <path d={GLYPH_PATHS[id]} />
    </svg>
  )
}

// --- preview geometry -------------------------------------------------------

/** A non-indexed unit cube with per-face normals, subdivided so the shader has
 *  vertices to move. Built once at module load: it never varies. */
function buildPreviewMesh(): { positions: Float32Array; normals: Float32Array } {
  const positions: number[] = []
  const normals: number[] = []
  // axis, u, v, sign — the six faces as (u, v) grids on the plane at ±1.
  const faces: [number, number, number, number][] = [
    [0, 1, 2, 1], [0, 1, 2, -1],
    [1, 2, 0, 1], [1, 2, 0, -1],
    [2, 0, 1, 1], [2, 0, 1, -1],
  ]
  for (const [axis, uAxis, vAxis, sign] of faces) {
    const corner = (u: number, v: number) => {
      const point = [0, 0, 0]
      point[axis] = sign
      point[uAxis] = u
      point[vAxis] = v
      const normal = [0, 0, 0]
      normal[axis] = sign
      return { point, normal }
    }
    // Two triangles, wound so the outward face survives back-face culling on
    // both signs of the axis.
    const quad = sign > 0
      ? [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, -1), corner(1, 1), corner(-1, 1)]
      : [corner(-1, -1), corner(1, 1), corner(1, -1), corner(-1, -1), corner(-1, 1), corner(1, 1)]
    for (const { point, normal } of quad) {
      positions.push(point[0] * 0.8, point[1] * 0.8, point[2] * 0.8)
      normals.push(normal[0], normal[1], normal[2])
    }
  }
  const [subdividedPositions, subdividedNormals] = subdivideAttributes(
    [
      { array: new Float32Array(positions), itemSize: 3 },
      { array: new Float32Array(normals), itemSize: 3 },
    ],
    PREVIEW_DETAIL,
  )
  return { positions: subdividedPositions.array, normals: subdividedNormals.array }
}

const PREVIEW_MESH = buildPreviewMesh()

const PREVIEW_VERT = `
precision highp float;
attribute vec3 aPos;
attribute vec3 aNrm;
uniform mat4 uProj;
uniform mat4 uView;
uniform float uKBeat;
${deformFieldGlsl(PREVIEW_SUFFIX)}
varying vec3 vN;
void main() {
  vec3 p = fxApply${PREVIEW_SUFFIX}(aPos, aNrm);
  vN = fxDeformNormal${PREVIEW_SUFFIX}(aPos, aNrm, p);
  gl_Position = uProj * uView * vec4(p, 1.0);
}
`

const PREVIEW_FRAG = `
precision highp float;
uniform vec3 uAccent;
varying vec3 vN;
void main() {
  vec3 n = normalize(vN);
  // A stand-in key light, not the scene's real physical material: read the
  // preview as the SHAPE, the way the guide asks of every lit-material preview.
  float key = clamp(dot(n, normalize(vec3(-0.4, 0.75, 0.6))), 0.0, 1.0);
  float fill = clamp(dot(n, normalize(vec3(0.6, -0.3, 0.5))), 0.0, 1.0);
  vec3 col = uAccent * (0.16 + 0.85 * key) + vec3(0.10, 0.13, 0.20) * fill;
  gl_FragColor = vec4(col, 1.0);
}
`

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type)
  if (!shader) return null
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.warn('[Deformer preview] shader compile failed:', gl.getShaderInfoLog(shader))
    gl.deleteShader(shader)
    return null
  }
  return shader
}

function link(gl: WebGLRenderingContext): WebGLProgram | null {
  const vert = compile(gl, gl.VERTEX_SHADER, PREVIEW_VERT)
  const frag = compile(gl, gl.FRAGMENT_SHADER, PREVIEW_FRAG)
  if (!vert || !frag) return null
  const program = gl.createProgram()
  if (!program) return null
  gl.attachShader(program, vert)
  gl.attachShader(program, frag)
  gl.linkProgram(program)
  gl.deleteShader(vert)
  gl.deleteShader(frag)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.warn('[Deformer preview] program link failed:', gl.getProgramInfoLog(program))
    gl.deleteProgram(program)
    return null
  }
  return program
}

function perspective(fov: number, aspect: number, near: number, far: number): Float32Array {
  const f = 1 / Math.tan(fov / 2)
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) / (near - far), -1,
    0, 0, (2 * far * near) / (near - far), 0,
  ])
}

/** Rx(pitch) * Ry(yaw), then pushed back along -Z. Column-major for GL. */
function view(yaw: number, pitch: number, distance: number): Float32Array {
  const cy = Math.cos(yaw), sy = Math.sin(yaw)
  const cp = Math.cos(pitch), sp = Math.sin(pitch)
  return new Float32Array([
    cy, sp * sy, -cp * sy, 0,
    0, cp, sp, 0,
    sy, -sp * cy, cp * cy, 0,
    0, 0, -distance, 1,
  ])
}

function DeformPreview({ settings }: { settings: PreviewSettings }) {
  const [failed, setFailed] = useState(false)
  // The loop reads the LATEST settings without re-running the effect: a
  // knob drag must not tear down and rebuild the GL context per pointermove.
  const settingsRef = useRef(settings)
  settingsRef.current = settings

  // The real draw closes over GL state built in the effect below; the shared
  // loop calls whatever the current mount stashed here.
  const drawImpl = useRef<((tSec: number) => void) | null>(null)
  const hostRef = usePreviewLoop((tSec) => drawImpl.current?.(tSec))

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    // Created here, not rendered by React: loseContext() below permanently kills
    // the canvas, and StrictMode's double-invoke would hand the second mount the
    // dead one (every compile then fails with an empty info log).
    const canvas = document.createElement('canvas')
    canvas.dataset.testid = 'deform-effect-preview'
    canvas.setAttribute('aria-label', 'Deformer preview')
    canvas.style.width = '100%'
    canvas.style.height = '100%'
    canvas.style.display = 'block'
    host.appendChild(canvas)

    const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: false, antialias: true })
    if (!gl || gl.isContextLost()) { setFailed(true); canvas.remove(); return }
    const program = link(gl)
    if (!program) { setFailed(true); canvas.remove(); return }

    const positionBuffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, PREVIEW_MESH.positions, gl.STATIC_DRAW)
    const positionLoc = gl.getAttribLocation(program, 'aPos')
    gl.enableVertexAttribArray(positionLoc)
    gl.vertexAttribPointer(positionLoc, 3, gl.FLOAT, false, 0, 0)

    const normalBuffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, PREVIEW_MESH.normals, gl.STATIC_DRAW)
    const normalLoc = gl.getAttribLocation(program, 'aNrm')
    gl.enableVertexAttribArray(normalLoc)
    gl.vertexAttribPointer(normalLoc, 3, gl.FLOAT, false, 0, 0)

    const uniforms: Record<string, WebGLUniformLocation | null> = {
      uProj: gl.getUniformLocation(program, 'uProj'),
      uView: gl.getUniformLocation(program, 'uView'),
      uAccent: gl.getUniformLocation(program, 'uAccent'),
      uKBeat: gl.getUniformLocation(program, 'uKBeat'),
    }
    for (const key of PREVIEW_UNIFORM_KEYS) {
      uniforms[key] = gl.getUniformLocation(program, uniformName(key, PREVIEW_SUFFIX))
    }

    const accent = [
      parseInt(DEFORM_ACCENT.slice(1, 3), 16) / 255,
      parseInt(DEFORM_ACCENT.slice(3, 5), 16) / 255,
      parseInt(DEFORM_ACCENT.slice(5, 7), 16) / 255,
    ]

    gl.enable(gl.DEPTH_TEST)
    // Deliberately no back-face culling: a deform may invert a triangle's
    // winding (a squash through zero, a mirror-ish taper), and a culled inside
    // face reads as a hole punched in the object.
    gl.disable(gl.CULL_FACE)
    gl.useProgram(program)

    const vertexCount = PREVIEW_MESH.positions.length / 3
    drawImpl.current = (elapsed: number) => {
      // Re-read the size every frame instead of using a ResizeObserver: those
      // starve in a hidden pane, and the inspector's width glides.
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const width = Math.max(1, Math.round(canvas.clientWidth * dpr))
      const height = Math.max(1, Math.round(canvas.clientHeight * dpr))
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width
        canvas.height = height
      }
      gl.viewport(0, 0, width, height)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)

      const current = settingsRef.current
      gl.uniformMatrix4fv(uniforms.uProj, false, perspective(0.85, width / height, 0.1, 40))
      gl.uniformMatrix4fv(uniforms.uView, false, view(elapsed * 0.4, -0.32, 4.4))
      gl.uniform3f(uniforms.uAccent, accent[0], accent[1], accent[2])
      gl.uniform1f(uniforms.uKBeat, elapsed * BEATS_PER_SECOND)
      for (const key of PREVIEW_UNIFORM_KEYS) {
        const location = uniforms[key]
        if (location) gl.uniform1f(location, current[key] ?? 0)
      }
      gl.drawArrays(gl.TRIANGLES, 0, vertexCount)
    }

    return () => {
      drawImpl.current = null
      gl.deleteBuffer(positionBuffer)
      gl.deleteBuffer(normalBuffer)
      gl.deleteProgram(program)
      // Panels mount on every track selection; exhausting the browser's WebGL
      // context budget takes out the main VIEWPORT, not this canvas.
      gl.getExtension('WEBGL_lose_context')?.loseContext()
      canvas.remove()
    }
    // hostRef is the loop hook's stable ref - listed only to satisfy the lint.
  }, [hostRef])

  return (
    <div ref={hostRef} className="h-full w-full">
      {failed && (
        <div className="flex h-full items-center justify-center text-[10px] text-white/35">
          preview unavailable
        </div>
      )}
    </div>
  )
}

// --- chrome -----------------------------------------------------------------

function DriveTabs({ value, options, onChange }: {
  value: number
  options: { value: number; label: string }[]
  onChange: (value: number) => void
}) {
  return (
    <div role="tablist" aria-label="Drive" className="flex gap-1 border-b border-white/[0.06] bg-black/25 px-3">
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(option.value)}
            className={`border-b-2 px-2.5 py-[7px] text-[11px] ${
              active ? 'text-white' : 'border-transparent text-white/40 hover:text-white/70'
            }`}
            style={active ? { borderBottomColor: DEFORM_ACCENT } : undefined}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

function Disclosure({ label, summary, children }: { label: string; summary: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border-t border-white/[0.06] px-3 py-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
        className="flex w-full items-center gap-1.5 text-[10px] text-white/45 hover:text-white/70"
      >
        <span className={`text-[9px] transition-transform ${open ? 'rotate-90' : ''}`}>▸</span>
        <span className="tracking-[0.14em]">{label}</span>
        <span className="ml-auto font-mono text-[10px] text-white/55">{summary}</span>
      </button>
      {open && <div className="pt-2.5">{children}</div>}
    </div>
  )
}

export const DeformEffectUserInterfaceRenderer: UserInterfaceRendererDefinition = ({ parameters }) => {
  // This panel subscribes to no store, so binding during render is safe (the
  // drained-binder trap in this directory's CLAUDE.md only bites panels that
  // re-render on foreign state with the same `parameters`).
  const b = bindPanel(parameters)
  const operation = b.select('operation')
  const drive = b.select('drive')
  const falloff = b.select('falloff')
  const strength = b.num('strength')
  const detail = b.num('detail', { optional: true })
  // Every operation-specific knob is optional: only the active operation's are
  // rendered, and a definition that drops one must not send the whole panel to
  // the generic list.
  // `axis` is deliberately NOT in this list: it is a select, and the binder
  // CLAIMS a key on first lookup, so a `num('axis')` here would swallow it and
  // leave the segmented control below with nothing.
  const knobs: Record<string, ReturnType<typeof b.num>> = {}
  for (const key of ['angle', 'amount', 'center', 'width', 'wavelength', 'phase', 'radius', 'seed', 'rate']) {
    knobs[key] = b.num(key, { optional: true })
  }
  const axis = b.select('axis', { optional: true })
  const falloffSize = b.num('falloffSize', { optional: true })
  const falloffOffset = b.num('falloffOffset', { optional: true })
  const falloffSoftness = b.num('falloffSoftness', { optional: true })

  if (b.missing || !operation || !drive || !falloff || !strength) {
    return <ParameterList parameters={parameters} />
  }

  const active = deformOperation(operation.value)
  const settings: PreviewSettings = {
    operation: operation.value,
    drive: drive.value,
    falloff: falloff.value,
    strength: strength.value,
    axis: axis?.value ?? 1,
    angle: knobs.angle?.value ?? 0,
    amount: knobs.amount?.value ?? 0,
    center: knobs.center?.value ?? 0,
    width: knobs.width?.value ?? 0.6,
    wavelength: knobs.wavelength?.value ?? 1,
    phase: knobs.phase?.value ?? 0,
    radius: knobs.radius?.value ?? 1,
    seed: knobs.seed?.value ?? 0,
    rate: knobs.rate?.value ?? 1,
    falloffSize: falloffSize?.value ?? 2,
    falloffOffset: falloffOffset?.value ?? 0,
    falloffSoftness: falloffSoftness?.value ?? 0.5,
  }

  // The operation's own knobs, minus the axis (a KIND, so it gets a segmented
  // control rather than a knob whose arc means nothing).
  const operationKnobs = active.params.filter((key) => key !== 'axis')
  const showsAxis = active.params.includes('axis')

  return (
    <Console accent={DEFORM_ACCENT} testId="deform-effect-user-interface">
      <DriveTabs value={drive.value} options={DEFORM_DRIVES} onChange={drive.set} />
      <PreviewWindow height={PREVIEW_HEIGHT} title="Live preview: the effect's own GLSL, on a subdivided cube">
        <DeformPreview settings={settings} />
      </PreviewWindow>

      <div className="px-3 pb-1 pt-2.5">
        <div className="mb-1.5 flex items-baseline justify-between">
          <span className="text-[9px] font-bold tracking-[0.22em] text-white/25">OPERATION</span>
          <span className="text-[10px] text-white/40">{active.hint}</span>
        </div>
        <div role="radiogroup" aria-label="Operation" className="grid grid-cols-4 gap-1">
          {DEFORM_OPERATIONS.map((option) => {
            const selected = option.value === operation.value
            return (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={option.label}
                title={option.hint}
                onClick={() => operation.set(option.value)}
                className={`flex flex-col items-center gap-[3px] rounded-[6px] border px-1 pb-[5px] pt-[6px] text-[9px] ${
                  selected ? 'text-white' : 'border-white/[0.07] text-white/45 hover:text-white/75'
                }`}
                style={selected
                  ? { borderColor: `${DEFORM_ACCENT}99`, background: `${DEFORM_ACCENT}38` }
                  : { background: 'rgba(255,255,255,0.035)' }}
              >
                <Glyph id={option.id} />
                <span>{option.label}</span>
              </button>
            )
          })}
        </div>
      </div>

      <ControlRow spill className="flex-wrap gap-4 px-4 pb-3 pt-3">
        <Knob b={strength} label="STRENGTH" large />
        {operationKnobs.map((key) => (
          <Knob key={key} b={knobs[key]} bipolar={key === 'amount' || key === 'angle' || key === 'center'} />
        ))}
        {drive.value !== DRIVE_STATIC && <Knob b={knobs.rate} label="RATE" />}
        <Knob b={detail} label="DETAIL" />
      </ControlRow>

      {showsAxis && (
        <div className="flex items-center gap-2 px-4 pb-3">
          <span className="text-[9px] font-bold tracking-[0.22em] text-white/25">AXIS</span>
          <Segmented b={axis} className="flex-1" />
        </div>
      )}

      <Disclosure label="FALLOFF" summary={DEFORM_FALLOFFS[Math.round(falloff.value)]?.label ?? 'None'}>
        <Segmented b={falloff} />
        {falloff.value !== FALLOFF_NONE && (
          <ControlRow className="gap-4 px-1 pb-1 pt-3">
            <Knob b={falloffSize} label="SIZE" />
            <Knob b={falloffOffset} label="OFFSET" bipolar />
            <Knob b={falloffSoftness} label="SOFTNESS" />
          </ControlRow>
        )}
      </Disclosure>
    </Console>
  )
}
