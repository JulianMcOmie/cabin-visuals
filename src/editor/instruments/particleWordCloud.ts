import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  NormalBlending,
  Points,
  PointsMaterial,
} from 'three'
import { seededRand } from '../core/visual/instrumentFrame'
import { FORCE_TRANSPARENT_KEY } from '../core/visual/animatedOpacity'
import { fieldHash } from './particleFieldCore'

// The particle-words mode of the Text Display instrument, adapted from a
// standalone three.js sketch: thousands of additive-blended points that morph
// between target shapes with an ease-in-out lerp. Words are rasterized to an
// offscreen canvas (in the track's chosen font) and particles scatter over the
// filled glyph pixels; the idle shape before the first word is the sketch's
// fibonacci sphere.
//
// Everything here is deterministic (seededRand, no per-frame integration), so
// the caller can derive morph progress purely from beat-distance to a note and
// keep the pause invariant: scrub == playback.

// Frame updates reuse deterministic samples and allocated buffers; the
// remaining cost of high counts includes fill-rate from
// overlapping dots, which the per-word brightness normalization already keeps
// in check.
export const MAX_PARTICLES = 30000
/** World-space height of the word sample canvas (glyphs fill ~65% of it). */
export const WORLD_TEXT_HEIGHT = 2.4
const WORD_DEPTH = 0.22
const SAMPLE_HEIGHT = 140
const SAMPLE_FONT = 92
const MAX_SAMPLE_WIDTH = SAMPLE_HEIGHT * 4.5
const SPHERE_RADIUS = 1.25

export interface ParticleFont {
  css: string
  weight: number
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

// The sketch's fibonacci sphere with jittered radius - the idle shape before
// the first word note, and the morph source for word one.
const SPHERE_TARGETS: Float32Array = (() => {
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

/** A word's particle formation plus its glyph coverage (filled sample-canvas
 *  pixels) - the coverage is what brightness normalization divides by. */
export interface WordShape {
  targets: Float32Array
  fill: number
}

// The sphere's nominal coverage in the same sample-canvas-pixel units as the
// words, so morphs to/from it normalize on the same scale. A shell projects
// bigger than any word but spreads its dots in depth; this sits in between.
export const SPHERE_SHAPE: WordShape = { targets: SPHERE_TARGETS, fill: 8000 }

// Word shapes, cached per (word, font) - the same word in a different face is
// a different cloud.
const wordShapeCache = new Map<string, WordShape | null>()
const WORD_CACHE_MAX = 64

/** Rasterize a word in the given font and scatter MAX_PARTICLES deterministic
 *  targets over its filled pixels. Null when the word rasterizes to nothing. */
export function wordShape(word: string, font: ParticleFont): WordShape | null {
  const key = `${word}|${font.css}|${font.weight}`
  const cached = wordShapeCache.get(key)
  if (cached !== undefined) return cached

  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null

  let fontSize = SAMPLE_FONT
  const fontStr = (size: number) => `${font.weight} ${size}px ${font.css}`
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

  let shape: WordShape | null = null
  if (xs.length > 0) {
    const targets = new Float32Array(MAX_PARTICLES * 3)
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
    shape = { targets, fill: xs.length }
  }

  if (wordShapeCache.size >= WORD_CACHE_MAX) {
    const firstKey = wordShapeCache.keys().next().value
    if (firstKey !== undefined) wordShapeCache.delete(firstKey)
  }
  wordShapeCache.set(key, shape)
  return shape
}

/** The sketch's ease-in-out quad. */
export function easeInOutQuad(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
}

export interface ParticleCloudHandles {
  points: Points
  positionAttr: BufferAttribute
  colorAttr: BufferAttribute
  /** Cache key of the last per-particle color fill. */
  lastColorKey: string
  /** Initialized prefix; count increases must fill newly visible particles. */
  colorCount: number
}

export function createParticleCloud(): ParticleCloudHandles {
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
  return { points, positionAttr, colorAttr, lastColorKey: '', colorCount: 0 }
}

export function disposeParticleCloud(handles: ParticleCloudHandles): void {
  handles.points.geometry.dispose()
  ;(handles.points.material as PointsMaterial).dispose()
}

const _baseColor = new Color()

export interface ParticleCloudFrame {
  count: number
  dotSize: number
  /** HDR lift over the bloom threshold (steady - no automatic note pulsing). */
  glow: number
  /** Opaque dots: paint over the background instead of adding to it, so a dot
   *  reads the same brightness over black or over another bright layer. */
  opaque: boolean
  color: string
  variation: number
  prevTargets: Float32Array
  curTargets: Float32Array
  /** Overall morph progress, 0..1 (1 = settled on curTargets). */
  progress: number
  /** Per-morph salt so each transition scatters its stagger differently. */
  morphSeed: number
  stagger: number
  /** Radial swell multiplier (1 = at rest). */
  pulseScale: number
  /** Stacking compensation for additive mode: how the current word's on-screen
   *  glyph area compares to a typical word's, per particle. Multiplied into the
   *  glow lift so per-pixel brightness - which is what legibility reads - stays
   *  constant across short/long words, sizes, and particle counts. */
  stackComp: number
}

// These samples depend only on particle index, not on the color or beat.
// A colorizer used to repeat 90,000 sine hashes on EVERY color change, even
// when only 8,000 particles were visible. Float64 preserves the original JS
// numbers exactly; rounding cached samples to Float32 changes final vertices.
let colorJitter: Float64Array | undefined
let colorJitterCount = 0

function cloudColorJitter(count: number): Float64Array {
  colorJitter ??= new Float64Array(MAX_PARTICLES * 3)
  for (let i = colorJitterCount; i < count; i++) {
    colorJitter[i * 3] = seededRand(i * 5.13) - 0.5
    colorJitter[i * 3 + 1] = seededRand(i * 5.13 + 17.7) - 0.5
    colorJitter[i * 3 + 2] = seededRand(i * 5.13 + 35.4) - 0.5
  }
  colorJitterCount = Math.max(colorJitterCount, count)
  return colorJitter
}

// A cloud has one transition; field mode can have the current word and its
// departing predecessor. Keep just two salts per mounted cloud, so a long
// lyric/export never accumulates a random table for every word it passes.
const morphSamples = new WeakMap<ParticleCloudHandles, Map<number, { values: Float64Array; count: number }>>()
function cloudMorphSamples(handles: ParticleCloudHandles, seed: number, count: number): Float64Array {
  let cache = morphSamples.get(handles)
  if (!cache) { cache = new Map(); morphSamples.set(handles, cache) }
  let samples = cache.get(seed)
  if (!samples) {
    if (cache.size >= 2) {
      const oldest = cache.keys().next().value!
      samples = cache.get(oldest)!
      cache.delete(oldest)
      samples.count = 0
    } else {
      samples = { values: new Float64Array(MAX_PARTICLES), count: 0 }
    }
  } else {
    cache.delete(seed)
  }
  cache.set(seed, samples)
  for (let i = samples.count; i < count; i++) samples.values[i] = seededRand(seed + i * 7.7)
  samples.count = Math.max(samples.count, count)
  return samples.values
}

// Three clears ranges after an upload. A hidden cloud may keep updating
// without uploading, so merge pending writes into ONE prefix instead of
// accumulating a range per frame (and retain older, larger color writes).
function markParticlePrefix(attribute: BufferAttribute, count: number): void {
  let end = count * 3
  for (const range of attribute.updateRanges) end = Math.max(end, range.start + range.count)
  attribute.clearUpdateRanges()
  attribute.addUpdateRange(0, end)
  attribute.needsUpdate = true
}

/** Only fill the visible prefix, extending it when the count grows. Shared by
 *  cloud and field mode; switching modes cannot expose stale particle colors. */
function fillCloudColors(handles: ParticleCloudHandles, color: string, variation: number, count: number): void {
  const colorKey = `${color}|${variation}`
  const sameColor = colorKey === handles.lastColorKey
  if (sameColor && count <= handles.colorCount) return
  const start = sameColor ? handles.colorCount : 0
  handles.lastColorKey = colorKey
  handles.colorCount = count
  _baseColor.set(color)
  const colors = handles.colorAttr.array as Float32Array
  const jitter = cloudColorJitter(count)
  for (let i = start; i < count; i++) {
    const i3 = i * 3
    colors[i3] = Math.max(0, _baseColor.r * (1 + jitter[i3] * variation))
    colors[i3 + 1] = Math.max(0, _baseColor.g * (1 + jitter[i3 + 1] * variation))
    colors[i3 + 2] = Math.max(0, _baseColor.b * (1 + jitter[i3 + 2] * variation))
  }
  markParticlePrefix(handles.colorAttr, count)
}

/** Write one frame of the cloud: per-particle colors (cached by key), material
 *  size/glow, and the staggered eased lerp of every particle position. The
 *  caller owns material opacity (via setAnimatedOpacity) and group transforms. */
export function updateParticleCloud(handles: ParticleCloudHandles, frame: ParticleCloudFrame): void {
  const { points, positionAttr } = handles
  const count = Math.max(1, Math.min(MAX_PARTICLES, Math.round(frame.count)))

  fillCloudColors(handles, frame.color, frame.variation, count)

  const material = points.material as PointsMaterial
  material.size = frame.dotSize
  // Bloom control. The scene bloom thresholds at luminance 1.15, and additive
  // blending SUMS overlapping dots - a word scaled small packs thousands of
  // particles into a few hundred pixels, stacking dozens per fragment, so with
  // additive blending NO color multiplier can keep the accumulated sum under
  // the threshold. Glow 0 therefore leaves additive blending entirely: normal
  // alpha blending paints each dot at its own (≤1) color, overlaps never
  // accumulate, and the bloom pass stays dark.
  //
  // Above zero, additive returns, and the slider (0..1) is raised to the 4th
  // power: with hundreds-deep stacks the visually useful multipliers run from
  // ~0.0001 up, so the quartic spreads that tiny range across real slider
  // travel (0.1 → 1e-4, 0.3 → 8e-3, 1 → 1) - effectively a log slider without
  // the UI needing one.
  //
  // Opaque mode sidesteps all of that: normal blending paints the dot OVER the
  // background, so it reads identically on black or on a bright layer behind
  // it. No stacking sums either, so glow maps linearly - the glow term pushes
  // the dot's own color over the 1.15 bloom threshold for a per-dot halo.
  //
  // Both modes divide the glow term by the color's LUMINANCE: the bloom pass
  // thresholds on luma, whose channel weights are wildly uneven (G .72, R .21,
  // B .07) - unnormalized, blue/purple words bloom ~13x less than yellow at
  // the same slider and their dim un-bloomed dots read as vanishing particles.
  // Dividing makes the slider mean the same bloom energy at every hue; the
  // floor keeps a near-black color from exploding the multiplier.
  _baseColor.set(frame.color)
  const luma = Math.max(0.05, 0.2126 * _baseColor.r + 0.7152 * _baseColor.g + 0.0722 * _baseColor.b)
  const g = frame.glow
  if (frame.opaque) {
    material.blending = NormalBlending
    const lift = 1 + (g * 4) / luma
    material.color.setRGB(lift, lift, lift)
  } else {
    const additive = g > 0.0005
    material.blending = additive ? AdditiveBlending : NormalBlending
    // stackComp: per-pixel brightness is (particles per glyph pixel) x lift, so
    // the lift is scaled by area/count to hold that product constant - a short
    // word no longer blazes and a long one no longer washes out.
    const lift = additive ? ((g * g * g * g) / luma) * frame.stackComp : 1
    material.color.setRGB(lift, lift, lift)
  }

  const { prevTargets, curTargets, progress, morphSeed, stagger, pulseScale } = frame
  const positions = positionAttr.array as Float32Array
  const samples = cloudMorphSamples(handles, morphSeed, count)
  for (let i = 0; i < count; i++) {
    const i3 = i * 3
    // Staggered onset per particle; everything still lands exactly at
    // progress 1 (delay < 1 always, so the divisor never vanishes).
    const delay = samples[i] * stagger * 0.6
    const t = progress >= 1 ? 1 : Math.max(0, Math.min(1, (progress - delay) / (1 - delay)))
    const e = easeInOutQuad(t)
    positions[i3] = (prevTargets[i3] + (curTargets[i3] - prevTargets[i3]) * e) * pulseScale
    positions[i3 + 1] = (prevTargets[i3 + 1] + (curTargets[i3 + 1] - prevTargets[i3 + 1]) * e) * pulseScale
    positions[i3 + 2] = (prevTargets[i3 + 2] + (curTargets[i3 + 2] - prevTargets[i3 + 2]) * e) * pulseScale
  }
  points.geometry.setDrawRange(0, count)
  markParticlePrefix(positionAttr, count)
}

// --- Field mode ---
// The cloud's sibling behavior (Text Display's "Field Mode"): instead of the
// WHOLE cloud being the word, a screen-filling slab of ambient particles sits
// still forever, and only the ones recruited near the text anchor condense
// into glyphs - then fly back to exactly the homes they left. Recruitment maps
// come from particleFieldCore (cached by the caller); this updater is just the
// per-frame position/material write.

/** One text formation: the glyph shape, which field particles it borrows
 *  (rank r forms target r), where it sits, and where it is in its life. */
export interface FieldFormation {
  shape: WordShape
  map: Uint32Array
  anchorX: number
  anchorY: number
  /** World units per shape-canvas unit (the cloud path's sizeAt x 0.22). */
  scale: number
  /** 0..1 formation progress (pre-ease, pre-stagger). */
  progress: number
  /** 0..1 dissolve progress (0 while held). */
  release: number
  /** Per-formation stagger salt. */
  seed: number
}

export interface ParticleFieldFrame {
  beat: number
  count: number
  dotSize: number
  glow: number
  opaque: boolean
  color: string
  variation: number
  stagger: number
  /** Ambient wander amount 0..1; stills where a formation has settled. */
  drift: number
  /** World-space basis for the wander amplitude (min viewport dimension). */
  driftScale: number
  /** The ambient slab (particleFieldCore.fieldPositions), count*3 long. */
  ambient: Float32Array
  cur: FieldFormation | null
  prev: FieldFormation | null
}

export function updateParticleField(handles: ParticleCloudHandles, frame: ParticleFieldFrame): void {
  const { points, positionAttr } = handles
  const count = Math.max(1, Math.min(MAX_PARTICLES, Math.round(frame.count)))

  fillCloudColors(handles, frame.color, frame.variation, count)

  // Material: dot size + bloom lift. Unlike the word cloud's hundreds-deep
  // additive stacks, the field is mostly UNstacked (spread over the whole
  // frame), so glow maps near-directly: a floor keeps dots visible at 0, the
  // quartic top end pushes single dots over the 1.15 bloom threshold. Both
  // branches normalize by luminance so blue reads like yellow (see the cloud
  // updater's note).
  const material = points.material as PointsMaterial
  material.size = frame.dotSize
  _baseColor.set(frame.color)
  const luma = Math.max(0.05, 0.2126 * _baseColor.r + 0.7152 * _baseColor.g + 0.0722 * _baseColor.b)
  if (frame.opaque) {
    material.blending = NormalBlending
    const lift = 1 + (frame.glow * 4) / luma
    material.color.setRGB(lift, lift, lift)
  } else {
    material.blending = AdditiveBlending
    const lift = (0.35 + 3.5 * frame.glow ** 4) / luma
    material.color.setRGB(lift, lift, lift)
  }

  const positions = positionAttr.array as Float32Array
  const { ambient, beat: b } = frame
  const driftAmp = frame.drift * 0.05 * frame.driftScale

  // Ambient home + gentle deterministic wander, damped by `settle` so a formed
  // letter holds still instead of shimmering off its glyph.
  const writeAmbient = (i: number, settle: number) => {
    const i3 = i * 3
    const wander = driftAmp * (1 - settle)
    positions[i3] = ambient[i3] + Math.sin(b * 0.9 + fieldHash(i * 1.7) * 6.283) * wander
    positions[i3 + 1] = ambient[i3 + 1] + Math.cos(b * 0.7 + fieldHash(i * 2.9) * 6.283) * wander
    positions[i3 + 2] = ambient[i3 + 2] + Math.sin(b * 0.5 + fieldHash(i * 4.3) * 6.283) * wander * 0.5
  }

  for (let i = 0; i < count; i++) writeAmbient(i, 0)

  // Fly rank r of the formation's map toward glyph target r. Stagger salts the
  // formation per particle (everyone still lands at 1); dissolve staggers with
  // the same salt so a letter frays apart the way it condensed.
  const applyFormation = (f: FieldFormation) => {
    const { shape, map } = f
    const samples = cloudMorphSamples(handles, f.seed, Math.min(map.length, MAX_PARTICLES))
    for (let r = 0; r < map.length; r++) {
      const i = map[r]
      if (i >= count) continue
      const delay = samples[r] * frame.stagger * 0.6
      const tIn = f.progress >= 1 ? 1 : Math.max(0, Math.min(1, (f.progress - delay) / (1 - delay)))
      const tOut = f.release <= 0 ? 0 : f.release >= 1 ? 1 : Math.max(0, Math.min(1, (f.release - delay) / (1 - delay)))
      const amp = easeInOutQuad(tIn) * (1 - easeInOutQuad(tOut))
      if (amp <= 0) continue
      const i3 = i * 3
      const r3 = r * 3
      writeAmbient(i, amp)
      positions[i3] += (f.anchorX + shape.targets[r3] * f.scale - positions[i3]) * amp
      positions[i3 + 1] += (f.anchorY + shape.targets[r3 + 1] * f.scale - positions[i3 + 1]) * amp
      positions[i3 + 2] += (shape.targets[r3 + 2] * f.scale - positions[i3 + 2]) * amp
    }
  }

  // Previous text first (still flying home), current second - the current one
  // wins any particle both claim, which IS the handoff between words.
  if (frame.prev) applyFormation(frame.prev)
  if (frame.cur) applyFormation(frame.cur)

  points.geometry.setDrawRange(0, count)
  markParticlePrefix(positionAttr, count)
}
