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

export const MAX_PARTICLES = 8000
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
export const SPHERE_TARGETS: Float32Array = (() => {
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

// Word targets, cached per (word, font) - the same word in a different face is
// a different cloud.
const wordTargetCache = new Map<string, Float32Array | null>()
const WORD_CACHE_MAX = 64

/** Rasterize a word in the given font and scatter MAX_PARTICLES deterministic
 *  targets over its filled pixels. Null when the word rasterizes to nothing. */
export function wordTargets(word: string, font: ParticleFont): Float32Array | null {
  const key = `${word}|${font.css}|${font.weight}`
  const cached = wordTargetCache.get(key)
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
  wordTargetCache.set(key, targets)
  return targets
}

/** The sketch's ease-in-out quad. */
function easeInOutQuad(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
}

export interface ParticleCloudHandles {
  points: Points
  positionAttr: BufferAttribute
  colorAttr: BufferAttribute
  /** Cache key of the last per-particle color fill. */
  lastColorKey: string
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
  return { points, positionAttr, colorAttr, lastColorKey: '' }
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
}

/** Write one frame of the cloud: per-particle colors (cached by key), material
 *  size/glow, and the staggered eased lerp of every particle position. The
 *  caller owns material opacity (via setAnimatedOpacity) and group transforms. */
export function updateParticleCloud(handles: ParticleCloudHandles, frame: ParticleCloudFrame): void {
  const { points, positionAttr, colorAttr } = handles
  const count = Math.max(1, Math.min(MAX_PARTICLES, Math.round(frame.count)))

  // Per-particle colors: the sketch's per-channel jitter around a base color.
  const colorKey = `${frame.color}|${frame.variation}`
  if (colorKey !== handles.lastColorKey) {
    handles.lastColorKey = colorKey
    _baseColor.set(frame.color)
    const colors = colorAttr.array as Float32Array
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const i3 = i * 3
      colors[i3] = Math.max(0, _baseColor.r * (1 + (seededRand(i * 5.13) - 0.5) * frame.variation))
      colors[i3 + 1] = Math.max(0, _baseColor.g * (1 + (seededRand(i * 5.13 + 17.7) - 0.5) * frame.variation))
      colors[i3 + 2] = Math.max(0, _baseColor.b * (1 + (seededRand(i * 5.13 + 35.4) - 0.5) * frame.variation))
    }
    colorAttr.needsUpdate = true
  }

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
  // it. No stacking sums either, so glow maps linearly - past ~0.05 the dot's
  // own color crosses the 1.15 bloom threshold and grows a halo of its own.
  const g = frame.glow
  if (frame.opaque) {
    material.blending = NormalBlending
    const lift = 1 + g * 4
    material.color.setRGB(lift, lift, lift)
  } else {
    const additive = g > 0.0005
    material.blending = additive ? AdditiveBlending : NormalBlending
    const lift = additive ? g * g * g * g : 1
    material.color.setRGB(lift, lift, lift)
  }

  const { prevTargets, curTargets, progress, morphSeed, stagger, pulseScale } = frame
  const positions = positionAttr.array as Float32Array
  for (let i = 0; i < count; i++) {
    const i3 = i * 3
    // Staggered onset per particle; everything still lands exactly at
    // progress 1 (delay < 1 always, so the divisor never vanishes).
    const delay = seededRand(morphSeed + i * 7.7) * stagger * 0.6
    const t = progress >= 1 ? 1 : Math.max(0, Math.min(1, (progress - delay) / (1 - delay)))
    const e = easeInOutQuad(t)
    positions[i3] = (prevTargets[i3] + (curTargets[i3] - prevTargets[i3]) * e) * pulseScale
    positions[i3 + 1] = (prevTargets[i3 + 1] + (curTargets[i3 + 1] - prevTargets[i3 + 1]) * e) * pulseScale
    positions[i3 + 2] = (prevTargets[i3 + 2] + (curTargets[i3 + 2] - prevTargets[i3 + 2]) * e) * pulseScale
  }
  points.geometry.setDrawRange(0, count)
  positionAttr.needsUpdate = true
}
