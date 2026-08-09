import { useEffect, useRef } from 'react'
import { useThree } from '@react-three/fiber'
import { CanvasTexture, LinearFilter, Mesh, MeshBasicMaterial } from 'three'
import { useInstrumentFrame, seededRand, beatInBlock } from '../core/visual/instrumentFrame'
import type { ObjectInstrumentDef, ParamDef } from './types'

// Midi Roll: the track's notes as a scrolling piano roll, modeled on a VIDI
// Studio reference capture - hollow neon bars drifting right-to-left past a
// fixed playhead at center, where a glowing diamond marks each sounding note,
// the played stretch of a bar fills in bright, and a faint starfield drifts
// behind. PURE VISUAL: no chrome, no UI, nothing interactive in the frame.
//
// Pitch AUTO-FIT: the vertical layout is derived from the whole track's pitch
// range - adjacent semitones sit at most `Max Note Spacing` apart (a 3-note
// motif stays pleasantly close, not scattered across the frame) and the
// spacing shrinks automatically when the range is too wide to fit (the
// squish). Computed from ALL notes, future included, so the layout never
// re-flows mid-song.
//
// Pause invariant: every mark is a function of (beat, notes, params) - the
// scroll position, played fills, marker fades, ripples, and even the star
// drift derive from state.beat, so scrub == playback.

const PARAMS: ParamDef[] = [
  { key: 'color', label: 'Note Color', type: 'color', default: '#35e0e0' },
  { key: 'window', label: 'Time Window (beats)', min: 2, max: 32, step: 1, default: 8 },
  { key: 'thickness', label: 'Note Thickness', min: 0.006, max: 0.05, step: 0.002, default: 0.016 },
  // The auto-fit ceiling: adjacent semitones never sit farther apart than
  // this fraction of the frame height. Wide ranges squish below it on their own.
  { key: 'maxGap', label: 'Max Note Spacing', min: 0.02, max: 0.15, step: 0.005, default: 0.07 },
  {
    key: 'style', label: 'Note Style', type: 'select', default: 0, options: [
      { value: 0, label: 'Outline' },
      { value: 1, label: 'Filled' },
      { value: 2, label: 'Line' },
    ],
  },
  { key: 'rounded', label: 'Rounded', type: 'boolean', default: 0 },
  {
    key: 'marker', label: 'Marker', type: 'select', default: 1, options: [
      { value: 0, label: 'None' },
      { value: 1, label: 'Diamond' },
      { value: 2, label: 'Dot' },
      { value: 3, label: 'Square' },
    ],
  },
  { key: 'markerSize', label: 'Marker Size', min: 0.5, max: 3, step: 0.1, default: 1.8, showIf: 'marker' },
  { key: 'hitFlash', label: 'Hit Flash', min: 0, max: 1, step: 0.05, default: 0.6 },
  // Off by default: no rings are visible in the reference frames - the knob
  // is here because the reference APP offers ripple styles.
  { key: 'ripple', label: 'Ripple', min: 0, max: 1, step: 0.05, default: 0 },
  { key: 'glow', label: 'Glow', min: 0, max: 1, step: 0.05, default: 0.6 },
  { key: 'stars', label: 'Starfield', min: 0, max: 1, step: 0.05, default: 0.4 },
  { key: 'playhead', label: 'Playhead Line', type: 'boolean', default: 0 },
]

const TEXTURE_HEIGHT = 1024
/** Marker keeps glowing this long (beats) after its note releases. */
const MARKER_FADE_BEATS = 0.4
/** Onset flash / ripple lifetime, beats. */
const FLASH_BEATS = 0.35
const RIPPLE_BEATS = 0.6

function MidiRollVisual({ trackId }: { trackId: string }) {
  const { viewport, invalidate } = useThree()
  const meshRef = useRef<Mesh>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const textureRef = useRef<CanvasTexture | null>(null)
  const aspect = viewport.height > 0 ? viewport.width / viewport.height : 1
  const textureWidth = Math.max(256, Math.min(2048, Math.round((TEXTURE_HEIGHT * aspect) / 64) * 64))

  useEffect(() => {
    const canvas = document.createElement('canvas')
    canvas.width = textureWidth
    canvas.height = TEXTURE_HEIGHT
    canvasRef.current = canvas

    const texture = new CanvasTexture(canvas)
    texture.minFilter = LinearFilter
    texture.magFilter = LinearFilter
    textureRef.current = texture
    invalidate()

    return () => {
      texture.dispose()
      canvasRef.current = null
      textureRef.current = null
    }
  }, [invalidate, textureWidth])

  useInstrumentFrame(trackId, (state) => {
    const canvas = canvasRef.current
    const texture = textureRef.current
    const mesh = meshRef.current
    if (!canvas || !texture || !mesh) return false
    const ctx = canvas.getContext('2d')
    if (!ctx) return false

    // Blocks are the on-screen region: no block at the playhead, no roll.
    const inBlock = beatInBlock(state)
    mesh.visible = inBlock
    if (!inBlock) return

    const W = canvas.width
    const H = canvas.height
    const p = state.params
    const color = state.stringParams.color || '#35e0e0'
    const windowBeats = Math.max(2, p.window ?? 8)
    const thickness = p.thickness ?? 0.016
    const maxGap = p.maxGap ?? 0.07
    const style = Math.round(p.style ?? 0)
    const rounded = (p.rounded ?? 0) >= 0.5
    const marker = Math.round(p.marker ?? 1)
    const markerSize = p.markerSize ?? 1.4
    const hitFlash = p.hitFlash ?? 0.6
    const ripple = p.ripple ?? 0.25
    const glow = p.glow ?? 0.6
    const stars = p.stars ?? 0.4
    const showPlayhead = (p.playhead ?? 0) >= 0.5

    const beat = state.beat
    ctx.clearRect(0, 0, W, H)

    // --- Starfield: deterministic dots, drifting slowly with the roll ---
    if (stars > 0) {
      const count = Math.round(stars * 170)
      for (let i = 0; i < count; i++) {
        const layer = seededRand(i * 3.7 + 2.2) // depth: brighter = faster
        const sx = seededRand(i * 3.7 + 0.4)
        const sy = seededRand(i * 3.7 + 1.3)
        const drift = beat * 0.0035 * (0.3 + layer)
        const x = (((sx - drift) % 1) + 1) % 1
        // A sprinkle of warm dust among the white, like the reference.
        ctx.fillStyle = i % 7 === 0 ? '#cfc39a' : '#ffffff'
        ctx.globalAlpha = 0.16 + layer * 0.42
        const size = 1 + layer * 1.6
        ctx.fillRect(x * W, sy * H, size, size)
      }
      ctx.globalAlpha = 1
    }

    // --- Pitch auto-fit over the WHOLE track ---
    let minPitch = Infinity
    let maxPitch = -Infinity
    for (const note of state.notes) {
      if (note.pitch < minPitch) minPitch = note.pitch
      if (note.pitch > maxPitch) maxPitch = note.pitch
    }
    const hasNotes = minPitch !== Infinity
    const range = hasNotes ? maxPitch - minPitch : 0
    const usableH = H * 0.86
    // Capped spread for narrow material, automatic squish for wide.
    const spacing = Math.min(maxGap * H, usableH / Math.max(3, range))
    const midPitch = (minPitch + maxPitch) / 2
    const yOf = (pitch: number) => H / 2 - (pitch - midPitch) * spacing

    const playheadX = W / 2
    const pxPerBeat = W / windowBeats
    const h = Math.max(3, thickness * H)
    const radius = rounded ? h / 2 : 0
    const outlineW = Math.max(1.5, H * 0.0022)

    const barPath = (x: number, y: number, w: number, bh: number) => {
      ctx.beginPath()
      if (radius > 0) ctx.roundRect(x, y, w, bh, Math.min(radius, w / 2))
      else ctx.rect(x, y, w, bh)
    }

    if (showPlayhead) {
      ctx.strokeStyle = color
      ctx.globalAlpha = 0.16
      ctx.lineWidth = Math.max(1, H * 0.0015)
      ctx.beginPath()
      ctx.moveTo(playheadX, 0)
      ctx.lineTo(playheadX, H)
      ctx.stroke()
      ctx.globalAlpha = 1
    }

    // --- Notes ---
    if (hasNotes) {
      for (const note of state.notes) {
        const xStart = playheadX + (note.beat - beat) * pxPerBeat
        const xEnd = xStart + Math.max(0.05, note.durationBeats) * pxPerBeat
        if (xEnd < -60 || xStart > W + 60) continue

        const yMid = yOf(note.pitch)
        const y = yMid - h / 2
        const w = Math.max(2, xEnd - xStart)
        const sounding = beat >= note.beat && beat < note.beat + note.durationBeats
        const onsetAge = beat - note.beat
        const flash = onsetAge >= 0 && onsetAge < FLASH_BEATS
          ? hitFlash * (1 - onsetAge / FLASH_BEATS)
          : 0

        // Ripple: a ring expanding from the hit point at the playhead.
        if (ripple > 0 && onsetAge >= 0 && onsetAge < RIPPLE_BEATS) {
          const t = onsetAge / RIPPLE_BEATS
          ctx.strokeStyle = color
          // Barely-there by default - the reference's rings are a suggestion,
          // not a target reticle.
          ctx.globalAlpha = ripple * (1 - t) * (1 - t) * 0.7
          ctx.lineWidth = Math.max(1, H * 0.0012)
          ctx.beginPath()
          ctx.arc(playheadX, yMid, (0.15 + t * 0.85) * H * 0.09 * (0.5 + ripple), 0, Math.PI * 2)
          ctx.stroke()
          ctx.globalAlpha = 1
        }

        // The bar itself.
        if (style === 1) {
          ctx.fillStyle = color
          ctx.globalAlpha = 0.55 + flash * 0.45
          barPath(xStart, y, w, h)
          ctx.fill()
        } else if (style === 2) {
          ctx.fillStyle = color
          ctx.globalAlpha = 0.75 + flash * 0.25
          barPath(xStart, yMid - h * 0.2, w, h * 0.4)
          ctx.fill()
        } else {
          ctx.strokeStyle = color
          ctx.globalAlpha = 0.85 + flash * 0.15
          ctx.lineWidth = outlineW + flash * outlineW
          barPath(xStart + outlineW / 2, y, Math.max(2, w - outlineW), h)
          ctx.stroke()
        }
        ctx.globalAlpha = 1

        // Played stretch: while the note sounds, the part left of the
        // playhead fills in bright (the reference's bars "charge up" as they
        // cross, then relax back to outlines once passed).
        if (sounding) {
          const fillW = Math.max(0, Math.min(playheadX, xEnd) - xStart)
          if (fillW > 1) {
            ctx.fillStyle = color
            ctx.globalAlpha = 0.85
            // A whisper of halo - the reference's charged bar stays a crisp
            // thin bar, it does not balloon.
            if (glow > 0) {
              ctx.shadowColor = color
              ctx.shadowBlur = glow * h * 0.35
            }
            barPath(xStart, y, fillW, h)
            ctx.fill()
            ctx.shadowBlur = 0
            ctx.globalAlpha = 1
          }
        }
      }

      // --- Markers: on every sounding note, lingering briefly after release ---
      if (marker > 0) {
        for (const note of state.notes) {
          const age = beat - note.beat
          if (age < 0) continue
          const pastEnd = age - note.durationBeats
          if (pastEnd >= MARKER_FADE_BEATS) continue
          const fade = pastEnd > 0 ? 1 - pastEnd / MARKER_FADE_BEATS : 1
          const yMid = yOf(note.pitch)
          // A subtle overshoot as the note lands - the reference's diamond
          // pops, it does not explode.
          const pop = age < 0.12 ? 1 + 0.22 * (1 - age / 0.12) : 1
          const s = h * markerSize * pop * (0.65 + 0.35 * fade)

          // Two passes, NO shadowBlur: blur melted the diamond's points into
          // a knob (capture comparison). A soft enlarged low-alpha halo
          // underneath, then the crisp full-alpha shape on top.
          const shape = (size: number) => {
            ctx.beginPath()
            if (marker === 1) {
              ctx.moveTo(playheadX, yMid - size)
              ctx.lineTo(playheadX + size, yMid)
              ctx.lineTo(playheadX, yMid + size)
              ctx.lineTo(playheadX - size, yMid)
              ctx.closePath()
            } else if (marker === 2) {
              ctx.arc(playheadX, yMid, size * 0.8, 0, Math.PI * 2)
            } else {
              ctx.rect(playheadX - size * 0.75, yMid - size * 0.75, size * 1.5, size * 1.5)
            }
          }
          ctx.fillStyle = color
          if (glow > 0) {
            ctx.globalAlpha = fade * glow * 0.28
            shape(s * 1.5)
            ctx.fill()
          }
          ctx.globalAlpha = fade
          shape(s)
          ctx.fill()
          ctx.globalAlpha = 1
        }
      }
    }

    texture.needsUpdate = true
    const material = mesh.material as MeshBasicMaterial
    if (material.map !== texture) {
      material.map = texture
      material.needsUpdate = true
    }
  })

  return (
    <mesh ref={meshRef}>
      <planeGeometry args={[viewport.width, viewport.height]} />
      <meshBasicMaterial transparent depthWrite={false} toneMapped={false} />
    </mesh>
  )
}

export const midiRollInstrument: ObjectInstrumentDef = {
  id: 'midiRoll',
  name: 'Midi Roll',
  kind: 'object',
  userInterfaceRenderer: 'parameters',
  params: PARAMS,
  // No midiRows: the whole point is the full piano roll - every pitch lands
  // on the auto-fit lane layout.
  component: MidiRollVisual,
  fullFrame: true,
}
