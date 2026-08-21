import { useEffect, useRef } from 'react'
import { useThree } from '@react-three/fiber'
import { CanvasTexture, LinearFilter, Mesh, MeshBasicMaterial } from 'three'
import { useInstrumentFrame, seededRand, beatInBlock } from '../core/visual/instrumentFrame'
import { FORCE_TRANSPARENT_KEY } from '../core/visual/animatedOpacity'
import type { ObjectInstrumentDef, ParamDef } from './types'

// Starfield: a full-frame field of drifting dots - the ambient backdrop that
// used to live inside Midi Roll, decoupled into its own instrument so a roll
// is just notes and any scene can wear the dust. At the default settings a
// track reproduces the roll's old starfield pixel-for-pixel (same seeds, same
// drift constant, same warm-dust sprinkle).
//
// PURE VISUAL and block-gated: no block at the playhead, no stars (the
// ambient-layers rule). Pause invariant: every dot's position, size and
// shimmer derive from (state.beat, params) - drift and twinkle are functions
// of the beat, never of wall-clock time.

const PARAMS: ParamDef[] = [
  { key: 'color', label: 'Star Color', type: 'color', default: '#ffffff' },
  // 0.4 = the roll's old default (68 dots); the scale matches its Starfield
  // knob 1:1 so a value carried over reads identically. Quadratic sliders
  // (curve) on both: the everyday sub-1 band keeps its resolution under
  // the tall ceilings.
  { key: 'density', label: 'Density', min: 0, max: 20, step: 0.05, default: 0.4, curve: 2 },
  { key: 'size', label: 'Dot Size', min: 0.4, max: 10, step: 0.05, default: 1, curve: 2 },
  // How far back the field stretches BEHIND the nearest stars. The front of
  // the field is the anchor: it keeps the classic near-star drift at every
  // depth, and raising the knob pushes the far stars away - slower and
  // slower, toward frozen at 100 - so the field gets deeper, not faster.
  // 0 collapses everything onto the front plane; 1 is the classic look
  // (bit-identical). Brightness/size spread caps at the 2x band so a deep
  // field stays a starfield. Quadratic slider (curve) so the everyday 0-2
  // band keeps its resolution under the 100 ceiling.
  { key: 'depth', label: 'Depth', min: 0, max: 200, step: 0.05, default: 1, curve: 2 },
  // Multiplies the drift rate; the base speed is the roll's scroll-matched
  // constant, so 1 beside a Midi Roll moves exactly like its old backdrop.
  { key: 'speed', label: 'Drift Speed', min: 0, max: 4, step: 0.05, default: 1 },
  {
    key: 'direction', label: 'Drift Direction', type: 'select', default: 0, options: [
      { value: 0, label: 'Left' },
      { value: 1, label: 'Right' },
      { value: 2, label: 'Up' },
      { value: 3, label: 'Down' },
    ],
  },
  // Seeded per-star shimmer, phased off the beat - 0 is the roll's steady dots.
  { key: 'twinkle', label: 'Twinkle', min: 0, max: 1, step: 0.05, default: 0 },
  // The every-7th warm-toned mote among the white, like the reference frames.
  { key: 'warmDust', label: 'Warm Dust', type: 'boolean', default: 1 },
]

const TEXTURE_HEIGHT = 1024
/** Density 20 fills the table (20 x 170 dots); the seeded layer/x/y of star i
 *  never changes, so they are rolled once instead of three seededRand calls
 *  per star per frame (the same memo Midi Roll's starfield carried). */
const MAX_STARS = 3400
let starTable: Float64Array | null = null
function starConsts(): Float64Array {
  if (starTable) return starTable
  starTable = new Float64Array(MAX_STARS * 3)
  for (let i = 0; i < MAX_STARS; i++) {
    starTable[i * 3] = seededRand(i * 3.7 + 2.2)
    starTable[i * 3 + 1] = seededRand(i * 3.7 + 0.4)
    starTable[i * 3 + 2] = seededRand(i * 3.7 + 1.3)
  }
  return starTable
}

function StarfieldVisual({ trackId }: { trackId: string }) {
  const { viewport, invalidate } = useThree()
  const meshRef = useRef<Mesh>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null)
  const textureRef = useRef<CanvasTexture | null>(null)
  const aspect = viewport.height > 0 ? viewport.width / viewport.height : 1
  const textureWidth = Math.max(256, Math.min(2048, Math.round((TEXTURE_HEIGHT * aspect) / 64) * 64))

  useEffect(() => {
    const canvas = document.createElement('canvas')
    canvas.width = textureWidth
    canvas.height = TEXTURE_HEIGHT
    canvasRef.current = canvas
    ctxRef.current = canvas.getContext('2d')

    const texture = new CanvasTexture(canvas)
    texture.minFilter = LinearFilter
    texture.magFilter = LinearFilter
    textureRef.current = texture
    invalidate()

    return () => {
      texture.dispose()
      canvasRef.current = null
      ctxRef.current = null
      textureRef.current = null
    }
  }, [invalidate, textureWidth])

  useInstrumentFrame(trackId, (state) => {
    const canvas = canvasRef.current
    const ctx = ctxRef.current
    const texture = textureRef.current
    const mesh = meshRef.current
    if (!canvas || !ctx || !texture || !mesh) return false

    // PRESENCE-driven, not note-gated (the `scene` composition def's
    // convention): a track with no notes shows its stars for the whole
    // timeline - a freshly added backdrop that renders nothing reads as
    // broken - while drawing notes turns the same track into a gate (their
    // blocks' bounds are the on-screen region, the ambient-layers rule).
    // Block bounds ride on NOTES in the resolved stream, so an empty block
    // cannot gate anything anyway - the empty track is the always-on case.
    const inBlock = state.notes.length === 0 || beatInBlock(state)
    mesh.visible = inBlock
    if (!inBlock) return

    const W = canvas.width
    const H = canvas.height
    const p = state.params
    const color = state.stringParams.color || '#ffffff'
    const density = p.density ?? 0.4
    const sizeK = p.size ?? 1
    const depth = p.depth ?? 1
    const speed = p.speed ?? 1
    const direction = Math.round(p.direction ?? 0)
    const twinkle = p.twinkle ?? 0
    const warmDust = (p.warmDust ?? 1) >= 0.5

    const beat = state.beat
    ctx.clearRect(0, 0, W, H)

    const count = Math.min(MAX_STARS, Math.round(density * 170))
    const table = starConsts()
    // Depth anchors the FRONT of the field: the nearest star always drifts
    // at the classic near-star rate, and the knob stretches the field away
    // behind it - the farthest star's rate divides down toward zero as
    // depth grows. Chosen over multiplying the near end up, which read as
    // "everything gets faster" instead of "the field gets deeper". At
    // depth 1 `backRate + span * t` is exactly the classic `0.3 + t`, so
    // the default look is bit-identical; depth 0 collapses everyone onto
    // the front plane (uniform near-star speed).
    const FRONT_RATE = 1.3
    const backRate = FRONT_RATE / (1 + (FRONT_RATE / 0.3 - 1) * depth)
    const rateSpan = FRONT_RATE - backRate
    const lookDepth = Math.min(depth, 2)
    for (let i = 0; i < count; i++) {
      const t = table[i * 3] // seeded depth position: 0 = far, 1 = near
      // Brightness/size anchor at the front too, capped at the 2x band so a
      // deep field dims toward the back without turning near stars into
      // giant hot squares.
      const layer = Math.max(0, 1 - (1 - t) * lookDepth) // look: brighter = closer
      const sx = table[i * 3 + 1]
      const sy = table[i * 3 + 2]
      // The roll's scroll-matched drift constant, nearer layers moving faster.
      const drift = beat * 0.0035 * speed * (backRate + rateSpan * t)
      let x = sx
      let y = sy
      if (direction === 0) x = sx - drift
      else if (direction === 1) x = sx + drift
      else if (direction === 2) y = sy - drift
      else y = sy + drift
      x = ((x % 1) + 1) % 1
      y = ((y % 1) + 1) % 1
      ctx.fillStyle = warmDust && i % 7 === 0 ? '#cfc39a' : color
      let alpha = 0.16 + layer * 0.42
      if (twinkle > 0) {
        // Each star shimmers on its own seeded rate/phase - a pure function
        // of the beat, so a paused frame holds one glitter pattern still.
        const shimmer = 0.5 + 0.5 * Math.sin(beat * (1.5 + layer * 3) * Math.PI + sx * 37)
        alpha *= 1 - twinkle * 0.8 * shimmer
      }
      ctx.globalAlpha = alpha
      const size = (1 + layer * 1.6) * sizeK
      ctx.fillRect(x * W, y * H, size, size)
    }
    ctx.globalAlpha = 1

    texture.needsUpdate = true
    const material = mesh.material as MeshBasicMaterial
    if (material.map !== texture) {
      material.map = texture
      material.needsUpdate = true
    }

    // Dev-only probe (see "renderer bugs: probe first"): the drawn layer plus
    // this frame's inputs, for console/Playwright checks.
    if (process.env.NODE_ENV !== 'production') {
      ;(window as unknown as Record<string, unknown>).__starfieldDebug = { canvas, count, inBlock, beat }
    }
  })

  return (
    <mesh ref={meshRef}>
      <planeGeometry args={[viewport.width, viewport.height]} />
      {/* FORCE_TRANSPARENT_KEY: a full-frame quad of low-alpha dots is exactly
          the applyMaterialOpacity trap - without the key the plane flips
          opaque at full track opacity and blacks out the scene behind it. */}
      <meshBasicMaterial transparent depthWrite={false} toneMapped={false} userData={{ [FORCE_TRANSPARENT_KEY]: true }} />
    </mesh>
  )
}

export const starfieldInstrument: ObjectInstrumentDef = {
  id: 'starfield',
  name: 'Starfield',
  kind: 'object',
  userInterfaceRenderer: 'parameters',
  params: PARAMS,
  component: StarfieldVisual,
  fullFrame: true,
}
