'use client'

import { useEffect, useMemo, useRef } from 'react'
import { AdditiveBlending, Color, Group, NormalBlending, PointsMaterial, Quaternion, Vector3 } from 'three'
import { useThree } from '@react-three/fiber'
import { seededRand, useInstrumentFrame } from '../core/visual/instrumentFrame'
import {
  createParticleCloud,
  disposeParticleCloud,
  easeInOutQuad,
  wordShape,
  MAX_PARTICLES,
  WORLD_TEXT_HEIGHT,
  type ParticleFont,
  type WordShape,
} from './particleWordCloud'
import { fieldHash, fieldPositions, fieldTimeline, recruitNearest, type TextOnset } from './particleFieldCore'
import { paramDefault, type ObjectInstrumentDef } from './types'

// Particle Field: a screen-filling slab of ambient particles that never moves
// - except where the text is. On a "Next text" note, the particles whose homes
// are nearest the anchor condense into the current word's glyphs; when the
// text dissolves they fly back to exactly the homes they left. Everything is
// f(beat, notes, params): the field is deterministic furniture, recruitment is
// a cached pure assignment, and all motion is eased beat arithmetic.
//
// Distinct from Text Display's Particle Words on purpose: there the WHOLE
// cloud is the word and morphs shape-to-shape; here the word is a local event
// inside a larger, indifferent field - the surrounding particles are the
// point.

const PITCH_NEXT_TEXT = 48

// Stock faces only (no webfont load-wait): mirrors the first four moods of
// Text Display's list. Indices are stored in projects - append, never reorder.
const FONTS: ParticleFont[] = [
  { css: '"Arial Black", Impact, sans-serif', weight: 900 },
  { css: 'Georgia, "Times New Roman", serif', weight: 900 },
  { css: '"Courier New", monospace', weight: 900 },
  { css: 'Arial, Helvetica, sans-serif', weight: 900 },
]

// Billboard scratch (TextDisplay's pattern) - reused, the frame allocates nothing.
const _bbPos = new Vector3()
const _bbScale = new Vector3()
const _bbParent = new Quaternion()
const _bbFace = new Quaternion()
const _color = new Color()

/** Recruitment maps are pure but not free (a sort over the field) - memoize a
 *  handful, keyed by everything the assignment reads. */
interface RecruitCache {
  key: string
  map: Uint32Array
}

function ParticleFieldComponent({ trackId }: { trackId: string }) {
  const groupRef = useRef<Group>(null)
  const cloud = useMemo(() => createParticleCloud(), [])
  useEffect(() => () => disposeParticleCloud(cloud), [cloud])
  const { viewport, camera } = useThree()

  // Caches for the pure-but-costly pieces. Plain memoization of deterministic
  // functions, so the pause invariant holds.
  const ambientRef = useRef<{ key: string; positions: Float32Array } | null>(null)
  const recruitsRef = useRef<RecruitCache[]>([])

  useInstrumentFrame(trackId, (state) => {
    const group = groupRef.current
    if (!group) return false
    const p = state.params
    const def = particleFieldInstrument
    const count = Math.max(1, Math.min(MAX_PARTICLES, Math.round(p.count ?? paramDefault(def, 'count'))))
    const dotSize = p.dotSize ?? paramDefault(def, 'dotSize')
    const glow = p.glow ?? paramDefault(def, 'glow')
    const opaque = (p.opaque ?? paramDefault(def, 'opaque')) >= 0.5
    const variation = p.variation ?? paramDefault(def, 'variation')
    const depth = p.depth ?? paramDefault(def, 'depth')
    const drift = p.drift ?? paramDefault(def, 'drift')
    const textSize = p.textSize ?? paramDefault(def, 'textSize')
    const posX = p.posX ?? paramDefault(def, 'posX')
    const posY = p.posY ?? paramDefault(def, 'posY')
    const textParticles = Math.round(p.textParticles ?? paramDefault(def, 'textParticles'))
    const formBeats = p.formBeats ?? paramDefault(def, 'formBeats')
    const releaseBeats = p.releaseBeats ?? paramDefault(def, 'releaseBeats')
    const stagger = p.stagger ?? paramDefault(def, 'stagger')
    const sustain = (p.sustain ?? paramDefault(def, 'sustain')) >= 0.5
    const color = state.stringParams.color ?? '#8fd8ff'
    const text = state.stringParams.text ?? 'HELLO WORLD'
    const font = FONTS[Math.max(0, Math.min(FONTS.length - 1, Math.round(p.font ?? 0)))]

    // Face the camera (the scene camera is pitched 13.5 degrees down - see
    // TextDisplay's billboard note; a screen-filling slab keystones without
    // this). Authored/mover rotation still applies, in screen space.
    state.world.decompose(_bbPos, _bbParent, _bbScale)
    _bbFace.copy(_bbParent).invert().multiply(camera.quaternion)
    group.quaternion.copy(_bbFace).multiply(_bbParent)

    // The field slab: viewport-sized (a little over, so edges never show).
    const W = viewport.width * 1.06
    const H = viewport.height * 1.06
    const ambientKey = `${count}|${W.toFixed(3)}|${H.toFixed(3)}|${depth}`
    if (ambientRef.current?.key !== ambientKey) {
      ambientRef.current = { key: ambientKey, positions: fieldPositions(count, W, H, depth) }
    }
    const ambient = ambientRef.current.positions

    // Words + the note stream: onset i shows word (i mod words.length).
    const words = text.split(/\s+/).filter(Boolean)
    const onsets: TextOnset[] = []
    for (const n of state.notes) {
      if (n.beat > state.beat) break
      if (n.pitch === PITCH_NEXT_TEXT) onsets.push({ beat: n.beat, endBeat: n.beat + n.durationBeats })
    }
    const tl = fieldTimeline(onsets, state.beat, formBeats, releaseBeats, sustain)

    const anchorX = posX * viewport.width * 0.5
    const anchorY = posY * viewport.height * 0.5
    const glyphScale = (viewport.height * textSize) / WORLD_TEXT_HEIGHT
    const K = Math.min(textParticles, count, MAX_PARTICLES)

    /** The (shape, recruitment) pair for one onset index, both memoized. */
    const formationFor = (onsetIndex: number): { shape: WordShape; map: Uint32Array } | null => {
      if (onsetIndex < 0 || words.length === 0) return null
      const word = words[onsetIndex % words.length]
      const shape = wordShape(word, font)
      if (!shape) return null
      const key = `${word}|${font.css}|${K}|${anchorX.toFixed(2)}|${anchorY.toFixed(2)}|${ambientKey}`
      let cached = recruitsRef.current.find((c) => c.key === key)
      if (!cached) {
        cached = { key, map: recruitNearest(ambient, count, K, anchorX, anchorY) }
        recruitsRef.current.push(cached)
        if (recruitsRef.current.length > 6) recruitsRef.current.shift()
      }
      return { shape, map: cached.map }
    }

    // Per-particle colors around the base, cached by key (same jitter voice as
    // the word cloud).
    const colorKey = `${color}|${variation}`
    if (colorKey !== cloud.lastColorKey) {
      cloud.lastColorKey = colorKey
      _color.set(color)
      const colors = cloud.colorAttr.array as Float32Array
      for (let i = 0; i < MAX_PARTICLES; i++) {
        const i3 = i * 3
        colors[i3] = Math.max(0, _color.r * (1 + (seededRand(i * 5.13) - 0.5) * variation))
        colors[i3 + 1] = Math.max(0, _color.g * (1 + (seededRand(i * 5.13 + 17.7) - 0.5) * variation))
        colors[i3 + 2] = Math.max(0, _color.b * (1 + (seededRand(i * 5.13 + 35.4) - 0.5) * variation))
      }
      cloud.colorAttr.needsUpdate = true
    }

    // Material: dot size + bloom lift. The field is mostly UNstacked (spread
    // over the whole frame), so unlike the word cloud's hundreds-deep additive
    // stacks this maps glow near-directly: a floor keeps dots visible at 0,
    // the quartic top end pushes single dots over the 1.15 bloom threshold.
    // Both branches normalize by luminance so blue reads like yellow.
    const material = cloud.points.material as PointsMaterial
    material.size = dotSize
    _color.set(color)
    const luma = Math.max(0.05, 0.2126 * _color.r + 0.7152 * _color.g + 0.0722 * _color.b)
    if (opaque) {
      material.blending = NormalBlending
      const lift = 1 + (glow * 4) / luma
      material.color.setRGB(lift, lift, lift)
    } else {
      material.blending = AdditiveBlending
      const lift = (0.35 + 3.5 * glow * glow * glow * glow) / luma
      material.color.setRGB(lift, lift, lift)
    }

    // --- Positions ---
    const positions = cloud.positionAttr.array as Float32Array
    const driftAmp = drift * 0.05 * Math.min(viewport.width, viewport.height)
    const b = state.beat

    /** Ambient home + gentle deterministic wander, damped by `settle` so a
     *  formed letter holds still instead of shimmering off its glyph. */
    const writeAmbient = (i: number, settle: number) => {
      const i3 = i * 3
      const wander = driftAmp * (1 - settle)
      positions[i3] = ambient[i3] + Math.sin(b * 0.9 + fieldHash(i * 1.7) * 6.283) * wander
      positions[i3 + 1] = ambient[i3 + 1] + Math.cos(b * 0.7 + fieldHash(i * 2.9) * 6.283) * wander
      positions[i3 + 2] = ambient[i3 + 2] + Math.sin(b * 0.5 + fieldHash(i * 4.3) * 6.283) * wander * 0.5
    }

    for (let i = 0; i < count; i++) writeAmbient(i, 0)

    /** Fly rank r of `map` toward glyph target r by per-particle amplitude. */
    const applyFormation = (formation: { shape: WordShape; map: Uint32Array }, progress: number, release: number, seed: number) => {
      const { shape, map } = formation
      for (let r = 0; r < map.length; r++) {
        const i = map[r]
        if (i >= count) continue
        // Stagger the formation per particle (everyone still lands at 1);
        // dissolve staggers with the same salt so the letter frays apart the
        // way it condensed.
        const delay = seededRand(seed + r * 7.7) * stagger * 0.6
        const tIn = progress >= 1 ? 1 : Math.max(0, Math.min(1, (progress - delay) / (1 - delay)))
        const tOut = release <= 0 ? 0 : release >= 1 ? 1 : Math.max(0, Math.min(1, (release - delay) / (1 - delay)))
        const amp = easeInOutQuad(tIn) * (1 - easeInOutQuad(tOut))
        if (amp <= 0) continue
        const i3 = i * 3
        const r3 = r * 3
        writeAmbient(i, amp)
        positions[i3] += (anchorX + shape.targets[r3] * glyphScale - positions[i3]) * amp
        positions[i3 + 1] += (anchorY + shape.targets[r3 + 1] * glyphScale - positions[i3 + 1]) * amp
        positions[i3 + 2] += (shape.targets[r3 + 2] * glyphScale - positions[i3 + 2]) * amp
      }
    }

    // Previous text first (still flying home), current text second (wins any
    // particle both claim - the handoff IS particles leaving one word for the
    // next).
    if (tl.prevIndex >= 0) {
      const prev = formationFor(tl.prevIndex)
      if (prev) applyFormation(prev, 1, tl.prevRelease, tl.prevIndex * 131.3)
    }
    if (tl.curIndex >= 0) {
      const cur = formationFor(tl.curIndex)
      if (cur) applyFormation(cur, tl.curProgress, tl.curRelease, tl.curIndex * 131.3)
    }

    cloud.points.geometry.setDrawRange(0, count)
    cloud.positionAttr.needsUpdate = true
  })

  return (
    <group ref={groupRef}>
      <primitive object={cloud.points} />
    </group>
  )
}

export const particleFieldInstrument: ObjectInstrumentDef = {
  id: 'particleField',
  name: 'Particle Field',
  kind: 'object',
  userInterfaceRenderer: 'parameters',
  params: [
    { key: 'text', label: 'Text (words in order)', type: 'string', default: 'HELLO WORLD' },
    {
      key: 'font',
      label: 'Font',
      type: 'select',
      options: [
        { value: 0, label: 'Poster (Impact)' },
        { value: 1, label: 'Serif' },
        { value: 2, label: 'Mono' },
        { value: 3, label: 'Sans' },
      ],
      default: 0,
    },
    { key: 'color', label: 'Color', type: 'color', default: '#8fd8ff' },
    { key: 'count', label: 'Particles', min: 1000, max: MAX_PARTICLES, step: 500, default: 12000 },
    { key: 'dotSize', label: 'Dot Size', min: 0.005, max: 0.08, step: 0.005, default: 0.02 },
    { key: 'glow', label: 'Glow', min: 0, max: 1, step: 0.01, default: 0.45 },
    { key: 'opaque', label: 'Opaque Dots', type: 'boolean', default: 0 },
    { key: 'variation', label: 'Color Variation', min: 0, max: 1, step: 0.05, default: 0.35 },
    { key: 'depth', label: 'Field Depth', min: 0, max: 3, step: 0.1, default: 1.2 },
    { key: 'drift', label: 'Field Drift', min: 0, max: 1, step: 0.05, default: 0.25 },
    { key: 'textSize', label: 'Text Size', min: 0.1, max: 1, step: 0.01, default: 0.35 },
    { key: 'posX', label: 'Text X', min: -1, max: 1, step: 0.01, default: 0 },
    { key: 'posY', label: 'Text Y', min: -1, max: 1, step: 0.01, default: 0 },
    { key: 'textParticles', label: 'Text Density', min: 500, max: 20000, step: 250, default: 4000 },
    { key: 'formBeats', label: 'Form (beats)', min: 0.05, max: 4, step: 0.05, default: 0.6 },
    { key: 'releaseBeats', label: 'Dissolve (beats)', min: 0.05, max: 4, step: 0.05, default: 0.8 },
    { key: 'stagger', label: 'Stagger', min: 0, max: 1, step: 0.05, default: 0.3 },
    { key: 'sustain', label: 'Hold Until Next', type: 'boolean', default: 1 },
  ],
  // One row, one job: each note advances to the next word in the text and
  // forms it at the anchor. Duration = how long it holds (unless sustained).
  midiRows: [{ pitch: PITCH_NEXT_TEXT, label: 'Next text' }],
  component: ParticleFieldComponent,
}
