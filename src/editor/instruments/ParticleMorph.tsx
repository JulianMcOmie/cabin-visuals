import { useEffect, useMemo, useRef } from 'react'
import { useThree } from '@react-three/fiber'
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  Group,
  Points,
  PointsMaterial,
  Quaternion,
  Vector3,
} from 'three'
import { seededRand, useInstrumentFrame } from '../core/visual/instrumentFrame'
import { FORCE_TRANSPARENT_KEY, setAnimatedOpacity } from '../core/visual/animatedOpacity'
import { paramDefault, type ObjectInstrumentDef } from './types'

// Adapted from a standalone three.js sketch: 8000 additive-blended points that
// morph between target shapes with an ease-in-out lerp. Here the targets are
// LYRIC WORDS instead of the sketch's shape cycle - the text param is a lyric
// sheet (same convention as Text Display), a pitch-48 "Next word" note advances
// the word, and the cloud interpolates from the previous word's formation to
// the next. Before the first word note the cloud idles as the sketch's
// fibonacci sphere.
//
// Pause invariant: the sketch lerps from wherever particles happen to be when a
// switch fires; that is per-frame integration and scrub-hostile. Instead each
// morph runs prev-target → cur-target with progress derived from beat-distance
// to the word's onset, and its duration is capped at the gap to the NEXT word
// note - so every morph finishes before the next begins and the closed form
// never jumps. Word targets are sampled deterministically (seededRand) from an
// offscreen text canvas, so the same word always yields the same cloud.

const MAX_PARTICLES = 8000
const PITCH_NEXT_WORD = 48 // same advance pitch as Text Display
const PITCH_PULSE = 47

const DEFAULT_COLOR = '#5b9be6' // the sketch's blue, averaged
/** World-space height of the word canvas (glyphs fill ~55% of it). */
const WORLD_TEXT_HEIGHT = 2.4
/** Depth jitter of a word's particle cloud, world units. */
const WORD_DEPTH = 0.22
const SAMPLE_HEIGHT = 140
const SAMPLE_FONT = 92
const MAX_SAMPLE_WIDTH = SAMPLE_HEIGHT * 4.5
const SPHERE_RADIUS = 1.25
/** Pulse note decay, in beats. */
const PULSE_RELEASE_BEATS = 0.6

export const particleMorphInstrument: ObjectInstrumentDef = {
  id: 'particleMorph',
  name: 'Particle Morph',
  kind: 'object',
  userInterfaceRenderer: 'parameters',
  params: [
    { key: 'text', label: 'Text', type: 'string', default: 'HELLO WORLD', multiline: true },
    { key: 'size', label: 'Size', min: 0.2, max: 4, step: 0.05, default: 1.6 },
    { key: 'color', label: 'Color', type: 'color', default: DEFAULT_COLOR },
    { key: 'colorVariation', label: 'Color Variation', min: 0, max: 1, step: 0.05, default: 0.5 },
    { key: 'glow', label: 'Glow', min: 0, max: 8, step: 0.1, default: 2 },
    { key: 'particles', label: 'Particles', min: 1000, max: MAX_PARTICLES, step: 500, default: 6000 },
    { key: 'dotSize', label: 'Dot Size', min: 0.005, max: 0.1, step: 0.005, default: 0.025 },
    { key: 'morphBeats', label: 'Morph (beats)', min: 0.1, max: 8, step: 0.1, default: 2 },
    { key: 'stagger', label: 'Morph Stagger', min: 0, max: 1, step: 0.05, default: 0.4 },
    { key: 'pulsePush', label: 'Pulse Push', min: 0, max: 1.5, step: 0.05, default: 0.35 },
    { key: 'spin', label: 'Spin Speed', min: 0, max: 4, step: 0.05, default: 0 },
    { key: 'wobble', label: 'Wobble', min: 0, max: 1, step: 0.05, default: 0.3 },
    { key: 'opacity', label: 'Opacity', min: 0, max: 1, step: 0.05, default: 0.9 },
    { key: 'x', label: 'X Position', min: -10, max: 10, step: 0.1, default: 0 },
    { key: 'y', label: 'Y Position', min: -10, max: 10, step: 0.1, default: 0 },
    { key: 'z', label: 'Z Position', min: -10, max: 10, step: 0.1, default: 0 },
  ],
  midiRows: [
    { pitch: PITCH_NEXT_WORD, label: 'Next word', color: '#facc15', emphasized: true },
    { pitch: PITCH_PULSE, label: 'Pulse · outward' },
  ],
  localTransform: ({ params }) => ({
    position: [
      params.x ?? paramDefault(particleMorphInstrument, 'x'),
      params.y ?? paramDefault(particleMorphInstrument, 'y'),
      params.z ?? paramDefault(particleMorphInstrument, 'z'),
    ],
    scale: (params.size ?? paramDefault(particleMorphInstrument, 'size')) / 1.6,
  }),
  component: ParticleMorph,
}

/** Stable per-word seed (FNV-1a), so a word's cloud never depends on where it
 *  sits in the lyric. */
function wordSeed(word: string): number {
  let h = 2166136261
  for (let i = 0; i < word.length; i++) {
    h ^= word.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0) / 4294967295
}

/** Lyric parsing, matching the Text Display conventions that make sense for a
 *  particle cloud: whitespace separates words, !kept together! groups a phrase.
 *  Syllable pipes have no meaning here (a cloud has no shared layout to reveal),
 *  so they are stripped. */
function parseWords(text: string): string[] {
  const words: string[] = []
  const parts = text.split('!')
  for (let i = 0; i < parts.length; i++) {
    const segment = parts[i].replace(/\|/g, '')
    if (i % 2 === 1) {
      const grouped = segment.trim()
      if (grouped) words.push(grouped)
    } else {
      for (const w of segment.split(/\s+/)) if (w) words.push(w)
    }
  }
  return words
}

// The sketch's fibonacci sphere with jittered radius - the idle shape before
// the first word note, and the morph source for word one.
const SPHERE_TARGETS = (() => {
  const pos = new Float32Array(MAX_PARTICLES * 3)
  for (let i = 0; i < MAX_PARTICLES; i++) {
    const i3 = i * 3
    const phi = Math.acos(1 - (2 * (i + 0.5)) / MAX_PARTICLES)
    const theta = Math.PI * (1 + Math.sqrt(5)) * i
    const radius = SPHERE_RADIUS * (1 + seededRand(i * 1.37) * 0.2)
    pos[i3] = radius * Math.sin(phi) * Math.cos(theta)
    pos[i3 + 1] = radius * Math.sin(phi) * Math.sin(theta)
    pos[i3 + 2] = radius * Math.cos(phi)
  }
  return pos
})()

// Word targets, cached per word (the font is fixed, so the word IS the key).
const wordTargetCache = new Map<string, Float32Array | null>()
const WORD_CACHE_MAX = 64

/** Rasterize a word and scatter MAX_PARTICLES deterministic targets over its
 *  filled pixels. Null when the word rasterizes to nothing. */
function wordTargets(word: string): Float32Array | null {
  const cached = wordTargetCache.get(word)
  if (cached !== undefined) return cached

  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null

  let fontSize = SAMPLE_FONT
  const fontStr = (size: number) => `900 ${size}px "Arial Black", Impact, sans-serif`
  ctx.font = fontStr(fontSize)
  let measured = ctx.measureText(word).width
  // Constant glyph height within the cap; very long phrases shrink to fit.
  if (measured > MAX_SAMPLE_WIDTH && measured > 0) {
    fontSize *= MAX_SAMPLE_WIDTH / measured
    measured = MAX_SAMPLE_WIDTH
  }
  canvas.width = Math.max(48, Math.ceil(measured) + 24)
  canvas.height = SAMPLE_HEIGHT
  ctx.font = fontStr(fontSize) // resizing reset the context
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#ffffff'
  ctx.fillText(word, canvas.width / 2, SAMPLE_HEIGHT / 2)

  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
  const xs: number[] = []
  const ys: number[] = []
  for (let py = 0; py < canvas.height; py++) {
    for (let px = 0; px < canvas.width; px++) {
      if (data[(py * canvas.width + px) * 4 + 3] > 128) {
        xs.push(px)
        ys.push(py)
      }
    }
  }

  let targets: Float32Array | null = null
  if (xs.length > 0) {
    targets = new Float32Array(MAX_PARTICLES * 3)
    const scale = WORLD_TEXT_HEIGHT / SAMPLE_HEIGHT
    const seed = wordSeed(word) * 1000
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const i3 = i * 3
      const pick = Math.floor(seededRand(seed + i * 3.17) * xs.length)
      // Sub-pixel jitter so stacked particles on the same pixel still shimmer.
      targets[i3] = (xs[pick] + seededRand(seed + i * 3.17 + 1) - 0.5 - canvas.width / 2) * scale
      targets[i3 + 1] = -(ys[pick] + seededRand(seed + i * 3.17 + 2) - 0.5 - SAMPLE_HEIGHT / 2) * scale
      targets[i3 + 2] = (seededRand(seed + i * 3.17 + 3) - 0.5) * 2 * WORD_DEPTH
    }
  }

  if (wordTargetCache.size >= WORD_CACHE_MAX) {
    const firstKey = wordTargetCache.keys().next().value
    if (firstKey !== undefined) wordTargetCache.delete(firstKey)
  }
  wordTargetCache.set(word, targets)
  return targets
}

/** The sketch's ease-in-out quad. */
function easeInOutQuad(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
}

// Billboard scratch (same pattern as TextDisplay - the scene camera is pitched
// down 13.5°, which keystones a flat word cloud left in world space).
const _bbPos = new Vector3()
const _bbScale = new Vector3()
const _bbParent = new Quaternion()
const _bbFace = new Quaternion()
const _baseColor = new Color()

export function ParticleMorph({ trackId }: { trackId: string }) {
  const rootRef = useRef<Group>(null)
  const spinRef = useRef<Group>(null)
  const lastColorKey = useRef('')

  const { points, positionAttr, colorAttr } = useMemo(() => {
    const geometry = new BufferGeometry()
    const positionAttr = new BufferAttribute(new Float32Array(MAX_PARTICLES * 3), 3)
    positionAttr.setUsage(DynamicDrawUsage)
    const colorAttr = new BufferAttribute(new Float32Array(MAX_PARTICLES * 3), 3)
    geometry.setAttribute('position', positionAttr)
    geometry.setAttribute('color', colorAttr)
    const material = new PointsMaterial({
      size: 0.025,
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      sizeAttenuation: true,
      blending: AdditiveBlending,
      toneMapped: false,
    })
    material.userData[FORCE_TRANSPARENT_KEY] = true
    const points = new Points(geometry, material)
    points.frustumCulled = false
    return { points, positionAttr, colorAttr }
  }, [])

  useEffect(() => () => {
    points.geometry.dispose()
    ;(points.material as PointsMaterial).dispose()
  }, [points])

  const camera = useThree((s) => s.camera)

  useInstrumentFrame(trackId, (state) => {
    const root = rootRef.current
    const spinner = spinRef.current
    if (!root || !spinner) return false

    // Ambient-always by request: the cloud (idle sphere included) stays on
    // screen with no block at the playhead - deliberately NOT block-gated.
    root.visible = true

    const p = state.params
    const glow = p.glow ?? paramDefault(particleMorphInstrument, 'glow')
    const count = Math.max(1, Math.min(MAX_PARTICLES, Math.round(p.particles ?? paramDefault(particleMorphInstrument, 'particles'))))
    const dotSize = p.dotSize ?? paramDefault(particleMorphInstrument, 'dotSize')
    const morphBeats = p.morphBeats ?? paramDefault(particleMorphInstrument, 'morphBeats')
    const stagger = p.stagger ?? paramDefault(particleMorphInstrument, 'stagger')
    const pulsePush = p.pulsePush ?? paramDefault(particleMorphInstrument, 'pulsePush')
    const spin = p.spin ?? paramDefault(particleMorphInstrument, 'spin')
    const wobble = p.wobble ?? paramDefault(particleMorphInstrument, 'wobble')
    const opacity = p.opacity ?? paramDefault(particleMorphInstrument, 'opacity')
    const variation = p.colorVariation ?? paramDefault(particleMorphInstrument, 'colorVariation')

    // Face the camera (keystone fix), keeping any authored/mover rotation as a
    // screen-space rotation on top - same conjugation as TextDisplay.
    state.world.decompose(_bbPos, _bbParent, _bbScale)
    _bbFace.copy(_bbParent).invert().multiply(camera.quaternion)
    root.quaternion.copy(_bbFace).multiply(_bbParent)

    // The sketch's gentle drift, derived from the beat so scrub == playback:
    // continuous y spin (its 0.002/frame ≈ 0.12 rad/s) plus a slow x wobble.
    const sec = state.beat * state.secPerBeat
    spinner.rotation.set(Math.sin(sec * 0.1) * 0.35 * wobble, sec * 0.12 * spin, 0)

    // --- Note derivation (pure) ---
    const wordNotes: typeof state.notes = []
    let lastPulseEnv = 0
    for (const n of state.notes) {
      if (n.pitch === PITCH_NEXT_WORD) {
        wordNotes.push(n) // future notes included: the NEXT onset caps this morph
      } else if (n.pitch === PITCH_PULSE && n.beat <= state.beat) {
        const age = state.beat - n.beat
        if (age < PULSE_RELEASE_BEATS) {
          const decay = 1 - age / PULSE_RELEASE_BEATS
          const velocity = n.velocity <= 1 ? n.velocity : n.velocity / 127
          lastPulseEnv = Math.max(lastPulseEnv, decay * decay * velocity)
        }
      }
    }
    let wordCount = 0
    for (const n of wordNotes) { if (n.beat <= state.beat) wordCount++; else break }

    const words = parseWords(state.stringParams.text ?? 'HELLO WORLD')

    // Morph endpoints: sphere → word 1 → word 2 → ... A word that rasterizes
    // to nothing (or an empty lyric sheet) falls back to the sphere.
    let prevTargets: Float32Array = SPHERE_TARGETS
    let curTargets: Float32Array = SPHERE_TARGETS
    let progress = 1
    let morphSeed = 0
    if (wordCount > 0 && words.length > 0) {
      curTargets = wordTargets(words[(wordCount - 1) % words.length]) ?? SPHERE_TARGETS
      prevTargets = wordCount === 1
        ? SPHERE_TARGETS
        : wordTargets(words[(wordCount - 2) % words.length]) ?? SPHERE_TARGETS
      const curNote = wordNotes[wordCount - 1]
      const nextNote = wordNotes[wordCount] // may be undefined
      // Finish before the next word note fires, so the next morph's start point
      // (this word's full target) is where the particles actually are.
      const duration = Math.max(0.05, Math.min(morphBeats, nextNote ? nextNote.beat - curNote.beat : Infinity))
      progress = Math.min(1, (state.beat - curNote.beat) / duration)
      morphSeed = wordCount * 61.7
    }

    // Per-particle colors: the sketch's per-channel jitter around a base color.
    _baseColor.set(state.stringParams.color || DEFAULT_COLOR)
    const colorKey = `${state.stringParams.color}|${variation}`
    if (colorKey !== lastColorKey.current) {
      lastColorKey.current = colorKey
      const colors = colorAttr.array as Float32Array
      for (let i = 0; i < MAX_PARTICLES; i++) {
        const i3 = i * 3
        colors[i3] = Math.max(0, _baseColor.r * (1 + (seededRand(i * 5.13) - 0.5) * variation))
        colors[i3 + 1] = Math.max(0, _baseColor.g * (1 + (seededRand(i * 5.13 + 17.7) - 0.5) * variation))
        colors[i3 + 2] = Math.max(0, _baseColor.b * (1 + (seededRand(i * 5.13 + 35.4) - 0.5) * variation))
      }
      colorAttr.needsUpdate = true
    }

    const material = points.material as PointsMaterial
    material.size = dotSize
    // HDR lift over the bloom threshold. Deliberately NOT coupled to
    // state.energy - Julia wants no automatic per-note pulsing; the only
    // note-driven swell is the explicit pitch-47 pulse row.
    const lift = 1 + glow * 0.5
    material.color.setRGB(lift, lift, lift)
    setAnimatedOpacity(material, opacity)

    const pulseScale = 1 + pulsePush * lastPulseEnv
    const positions = positionAttr.array as Float32Array
    for (let i = 0; i < count; i++) {
      const i3 = i * 3
      // Staggered onset per particle (seeded per morph so each transition
      // scatters differently); everything still lands exactly at progress 1.
      const delay = seededRand(morphSeed + i * 7.7) * stagger * 0.6
      const t = progress >= 1 ? 1 : Math.max(0, Math.min(1, (progress - delay) / (1 - delay)))
      const e = easeInOutQuad(t)
      positions[i3] = (prevTargets[i3] + (curTargets[i3] - prevTargets[i3]) * e) * pulseScale
      positions[i3 + 1] = (prevTargets[i3 + 1] + (curTargets[i3 + 1] - prevTargets[i3 + 1]) * e) * pulseScale
      positions[i3 + 2] = (prevTargets[i3 + 2] + (curTargets[i3 + 2] - prevTargets[i3 + 2]) * e) * pulseScale
    }
    points.geometry.setDrawRange(0, count)
    positionAttr.needsUpdate = true
  })

  return (
    <group ref={rootRef}>
      <group ref={spinRef}>
        <primitive object={points} />
      </group>
    </group>
  )
}
