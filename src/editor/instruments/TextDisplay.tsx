import { useContext, useRef, useEffect, useMemo, useState } from 'react'
import { useThree } from '@react-three/fiber'
import {
  AddEquation,
  CanvasTexture,
  Color,
  CustomBlending,
  DoubleSide,
  Group,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  NormalBlending,
  OneFactor,
  OneMinusDstColorFactor,
  OneMinusSrcAlphaFactor,
  PlaneGeometry,
  Quaternion,
  SrcAlphaFactor,
  Vector3,
  type Material,
} from 'three'
import { useInstrumentFrame, seededRand, paramAtBeat } from '../core/visual/instrumentFrame'
import { ensureFont } from '../core/visual/fonts'
import {
  MAX_PARTICLES,
  SPHERE_SHAPE,
  createParticleCloud,
  disposeParticleCloud,
  easeInOutQuad,
  updateParticleCloud,
  wordShape,
  type WordShape,
} from './particleWordCloud'
import { FORCE_TRANSPARENT_KEY, setAnimatedOpacity } from '../core/visual/animatedOpacity'
import { FinalInvertMaskContext } from '../core/visual/finalInvertMask'
import type { ResolvedNote } from '../core/visual/types'
import type { ObjectInstrumentDef, ParamDef } from './types'

// Ported from Excellent DAW. Displays text a word at a time, advancing on each MIDI note
// and filling the frame. Words are rendered to a canvas + CanvasTexture on screen-filling
// planes. Supports delay echoes, per-note height offset (pitch 60-72), flight mode (words
// zoom toward the camera), and rainbow hue cycling. Tyler's Google-font loader and palette
// are dropped; everything (word index, bounce/release/pop ages, echoes, flight sprites)
// is derived per frame from the resolved note list, so scrub == playback.

// Pitch roles (kept from Tyler): a dedicated "next word" pitch advances the word, a bass
// "pop" pitch punches the current word, and a 60-72 band sets a vertical height offset.
const PITCH_BASS_POP = 47
const PITCH_NEXT_WORD = 48
const PITCH_HEIGHT_MIN = 60 // C4
const PITCH_HEIGHT_MAX = 72 // C5
const PITCH_HEIGHT_CENTER = 66 // F#4 = no offset
const MAX_DELAY_TAPS = 8

// Font stacks. 0-3 are system stacks; the rest are self-hosted template faces
// (core/visual/fonts.ts) - the frame callback gates on `load` being ready and
// retries, so a word canvas is never baked with the fallback family. `weight`
// matters: IM Fell ships only 400, and asking canvas for 900 would synthesize
// a fake bold that ruins the old-press look.
interface FontDef { css: string; weight: number; load?: string }
// Ordered so the list reads as a spread of MOODS rather than a pile of families:
// the four workhorses first, then the self-hosted display faces, then the system
// character faces. Indices are stored in projects, so new entries only ever go on
// the END - reordering would silently restyle every existing lyric video.
const FONT_STACKS: FontDef[] = [
  { css: '"Arial Black", Impact, sans-serif', weight: 900 },
  { css: 'Georgia, "Times New Roman", serif', weight: 900 },
  { css: '"Courier New", monospace', weight: 900 },
  { css: 'Arial, Helvetica, sans-serif', weight: 900 },
  { css: '"IM Fell English SC", Georgia, serif', weight: 400, load: 'IM Fell English SC' },
  { css: '"IM Fell English", Georgia, serif', weight: 400, load: 'IM Fell English' },
  { css: '"Playfair Display", Georgia, serif', weight: 900, load: 'Playfair Display' },
  { css: '"Bebas Neue", "Arial Narrow", sans-serif', weight: 400, load: 'Bebas Neue' },
  { css: 'Righteous, "Arial Black", sans-serif', weight: 400, load: 'Righteous' },
  { css: '"Abril Fatface", Georgia, serif', weight: 400, load: 'Abril Fatface' },
  // System character faces. No files to ship, but availability varies by OS, so
  // each carries a fallback that keeps the MOOD rather than dropping to Arial:
  // a script degrades to another script, a slab to another slab.
  { css: '"Comic Sans MS", "Chalkboard SE", cursive', weight: 700 },
  { css: '"Brush Script MT", "Snell Roundhand", cursive', weight: 400 },
  { css: '"Palatino Linotype", Palatino, "Book Antiqua", serif', weight: 700 },
  { css: '"Times New Roman", Times, serif', weight: 700 },
  { css: 'Consolas, "Lucida Console", Menlo, monospace', weight: 700 },
]
const fontStack = (i: number) => FONT_STACKS[Math.max(0, Math.min(FONT_STACKS.length - 1, Math.round(i)))]

// Billboard scratch - decompose targets, reused so the frame allocates nothing.
const _billboardPos = new Vector3()
const _billboardScale = new Vector3()
const _billboardParent = new Quaternion()
const _billboardFace = new Quaternion()

function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  let r = 0, g = 0, b = 0
  if (h < 60) { r = c; g = x } else if (h < 120) { r = x; g = c }
  else if (h < 180) { g = c; b = x } else if (h < 240) { g = x; b = c }
  else if (h < 300) { r = x; b = c } else { r = c; b = x }
  const toHex = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, '0')
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

const TEXT_CANVAS_SIZE = 1024
// Widest word canvas, as a multiple of its height. Within the cap, letters
// keep one height and longer words simply get wider canvases (the mesh
// stretches to match); past it - very long grouped phrases - the font shrinks
// to fit, so nothing outgrows the frame.
const MAX_TEXT_ASPECT = 3
const TEXT_ALPHA_TEST = 0.001

/**
 * Invert mode uses fixed-function blending to calculate, per channel:
 *   alpha * (1 - destination) + destination * (1 - alpha)
 * Premultiplying the white glyph makes its RGB equal its coverage alpha, so this
 * remains smooth at antialiased edges without sampling the framebuffer in a shader.
 */
function configureTextMaterial(material: MeshBasicMaterial, invertBehind: boolean): void {
  material.userData[FORCE_TRANSPARENT_KEY] = true
  material.transparent = true
  if (material.premultipliedAlpha === invertBehind
    && material.blending === (invertBehind ? CustomBlending : NormalBlending)) return

  material.premultipliedAlpha = invertBehind
  material.blending = invertBehind ? CustomBlending : NormalBlending
  material.blendEquation = AddEquation
  material.blendSrc = invertBehind ? OneMinusDstColorFactor : SrcAlphaFactor
  material.blendDst = OneMinusSrcAlphaFactor
  material.blendSrcAlpha = invertBehind ? OneFactor : null
  material.blendDstAlpha = invertBehind ? OneMinusSrcAlphaFactor : null
  material.needsUpdate = true
}

interface TextEntry {
  text: string
  layoutText: string
  syllableStart: number
  syllableCount: number
  cacheKey: string
}

function singleTextEntry(text: string): TextEntry {
  return {
    text,
    layoutText: text,
    syllableStart: 0,
    syllableCount: 1,
    cacheKey: text,
  }
}

function entriesForWord(raw: string): TextEntry[] {
  if (!raw.includes('|')) return [singleTextEntry(raw)]

  const parts = raw.split('|').filter((p) => p.length > 0)
  if (parts.length <= 1) return parts.length === 1 ? [singleTextEntry(parts[0])] : []

  const layoutText = parts.join('')
  const entries: TextEntry[] = []
  let start = 0
  for (const part of parts) {
    entries.push({
      text: part,
      layoutText,
      syllableStart: start,
      syllableCount: parts.length,
      cacheKey: `${layoutText}|${start}|${part}`,
    })
    start += part.length
  }
  return entries
}

function parsePipeAwareSegment(segment: string): TextEntry[] {
  const result: TextEntry[] = []
  let i = 0

  while (i < segment.length) {
    while (i < segment.length && /\s/.test(segment[i])) i++
    if (i >= segment.length) break

    if (segment[i] === '|') {
      const close = segment.indexOf('|', i + 1)
      if (close !== -1) {
        const grouped = segment.slice(i + 1, close).trim()
        if (grouped) {
          if (/\s/.test(grouped)) result.push(singleTextEntry(grouped))
          else result.push(...entriesForWord(grouped))
        }
        i = close + 1
        continue
      }
    }

    const start = i
    while (i < segment.length && !/\s/.test(segment[i])) i++
    result.push(...entriesForWord(segment.slice(start, i)))
  }

  return result
}

// Shared canvas cache keyed by (word, stroke, font, color, strokeColor).
const canvasCache = new Map<string, HTMLCanvasElement>()
const CANVAS_CACHE_MAX = 64

function createTextCanvas(
  word: TextEntry | string,
  strokeWidth: number,
  font: FontDef,
  color: string,
  strokeColor: string,
  glow = 0,
  glowContained = false,
  shadow = 0,
): HTMLCanvasElement {
  const entry = typeof word === 'string' ? singleTextEntry(word) : word
  const key = `${entry.cacheKey}|${strokeWidth}|${font.css}|${font.weight}|${color}|${strokeColor}|${glow}|${glowContained}|${shadow}`
  const cached = canvasCache.get(key)
  if (cached) return cached

  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')!

  // Constant glyph height; the canvas WIDTH follows the text (the mesh
  // stretches by the resulting aspect), so every word renders letters the
  // same height - "awesome" comes out wider than "hello", not smaller.
  let fontSize = TEXT_CANVAS_SIZE * 0.35
  const fontStr = (size: number) => `${font.weight} ${size}px ${font.css}`
  ctx.font = fontStr(fontSize)

  const layoutText = entry.layoutText || entry.text
  // Stroke joins, glow halos, and shadow blur poke past the glyph box - pad
  // for all three.
  const pad = TEXT_CANVAS_SIZE * 0.04 + strokeWidth * fontSize + glow * fontSize * 0.35 + shadow * fontSize * 0.3
  const maxTextWidth = TEXT_CANVAS_SIZE * MAX_TEXT_ASPECT - pad * 2
  let measured = ctx.measureText(layoutText).width
  if (measured > maxTextWidth && measured > 0) {
    fontSize *= maxTextWidth / measured
    measured = maxTextWidth
  }
  const cssWidth = Math.max(64, Math.ceil(measured + pad * 2))

  canvas.width = Math.round(cssWidth * dpr)
  canvas.height = TEXT_CANVAS_SIZE * dpr
  ctx.scale(dpr, dpr)
  ctx.font = fontStr(fontSize) // resizing the canvas reset the context

  ctx.textBaseline = 'middle'
  const cx = cssWidth / 2
  const cy = TEXT_CANVAS_SIZE / 2
  const layoutWidth = ctx.measureText(layoutText).width
  const prefixWidth = entry.syllableCount > 1
    ? ctx.measureText(layoutText.slice(0, entry.syllableStart)).width
    : 0
  const drawX = entry.syllableCount > 1
    ? cx - layoutWidth / 2 + prefixWidth
    : cx
  ctx.textAlign = entry.syllableCount > 1 ? 'left' : 'center'

  if (strokeWidth > 0) {
    ctx.lineWidth = Math.max(1, strokeWidth * fontSize)
    ctx.lineJoin = 'round'
    if (strokeColor) {
      ctx.strokeStyle = strokeColor
    } else {
      const r = parseInt(color.slice(1, 3), 16)
      const g = parseInt(color.slice(3, 5), 16)
      const b = parseInt(color.slice(5, 7), 16)
      const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
      ctx.strokeStyle = luminance > 0.5 ? 'black' : 'white'
    }
    ctx.strokeText(entry.text, drawX, cy)
  }
  ctx.fillStyle = color
  if (glow > 0) {
    // Projected-light bloom: a wide soft halo, then a tight inner glow, in the
    // text's own color. The plain fill after clears the shadow and lays the
    // bright core on top.
    const paintGlow = (target: CanvasRenderingContext2D) => {
      target.fillStyle = color
      target.shadowColor = color
      target.shadowBlur = glow * fontSize * 0.22
      target.fillText(entry.text, drawX, cy)
      target.shadowBlur = glow * fontSize * 0.07
      target.fillText(entry.text, drawX, cy)
      target.shadowBlur = 0
    }

    if (!glowContained) {
      paintGlow(ctx)
    } else {
      // Contained: the halo must not spill past the stroke's outer edge. Canvas
      // has no way to clip to a text path (there is no ctx.textPath), so the
      // glow is painted on its own layer and then masked with destination-in
      // against the SAME glyph stroked at the same width - which keeps exactly
      // the pixels the letter-plus-stroke silhouette covers and discards the
      // bleed. With strokeWidth 0 the mask collapses to the letters themselves,
      // so the glow stops at the glyph edge, which is the sensible reading of
      // "contained" when there is no stroke to stop at.
      const newLayer = () => {
        const c = document.createElement('canvas')
        c.width = canvas.width
        c.height = canvas.height
        const g = c.getContext('2d')!
        g.scale(dpr, dpr)
        g.font = fontStr(fontSize)
        g.textBaseline = 'middle'
        g.textAlign = ctx.textAlign
        return [c, g] as const
      }

      // The mask is built on its OWN layer as a single union of stroke + fill,
      // then intersected once. Doing it in place instead - strokeText with
      // destination-in, then fillText with destination-in - looks equivalent and
      // is not: each composite intersects with what survived the last one, so the
      // second pass cuts the stroke band back down to where it overlaps the letter
      // interior. Almost nothing survives, and the glow silently disappears.
      const [maskCanvas, mc] = newLayer()
      mc.fillStyle = '#ffffff'
      mc.strokeStyle = '#ffffff'
      if (strokeWidth > 0) {
        mc.lineWidth = Math.max(1, strokeWidth * fontSize)
        mc.lineJoin = 'round'
        mc.strokeText(entry.text, drawX, cy)
      }
      mc.fillText(entry.text, drawX, cy)

      const [layer, lc] = newLayer()
      paintGlow(lc)
      lc.globalCompositeOperation = 'destination-in'
      lc.drawImage(maskCanvas, 0, 0, cssWidth, TEXT_CANVAS_SIZE)
      lc.globalCompositeOperation = 'source-over'
      // Drawn in CSS px - ctx is already dpr-scaled, and so was the layer.
      ctx.drawImage(layer, 0, 0, cssWidth, TEXT_CANVAS_SIZE)
      ctx.fillStyle = color
    }
  }
  // Soft drop shadow under the final fill - the short-form caption treatment
  // (white bold word floating on footage). Distinct from glow: glow halos in
  // the TEXT's color, shadow grounds it in black.
  if (shadow > 0) {
    ctx.shadowColor = 'rgba(0,0,0,0.85)'
    ctx.shadowBlur = shadow * fontSize * 0.18
    ctx.shadowOffsetY = shadow * fontSize * 0.07
  }
  ctx.fillText(entry.text, drawX, cy)
  if (shadow > 0) {
    ctx.shadowColor = 'transparent'
    ctx.shadowBlur = 0
    ctx.shadowOffsetY = 0
  }

  if (canvasCache.size >= CANVAS_CACHE_MAX) {
    const firstKey = canvasCache.keys().next().value
    if (firstKey !== undefined) canvasCache.delete(firstKey)
  }
  canvasCache.set(key, canvas)
  return canvas
}

/** The texture's canvas width/height - the mesh's x-stretch, so the
 *  constant-height glyphs keep their drawn proportions on screen. */
function texAspect(tex: CanvasTexture): number {
  const img = tex.image as { width?: number; height?: number } | undefined
  return img && img.width && img.height ? img.width / img.height : 1
}

/** Swap a texture's backing canvas. Word canvases vary in WIDTH now, and the
 *  GPU storage three allocates is fixed-size - a different-sized upload
 *  silently no-ops, leaving the previous word's pixels on screen. Dispose
 *  first when the size changed so the storage is reallocated. */
function setTextureCanvas(tex: CanvasTexture, canvas: HTMLCanvasElement) {
  const prev = tex.image as { width?: number; height?: number } | undefined
  if (prev && (prev.width !== canvas.width || prev.height !== canvas.height)) tex.dispose()
  tex.image = canvas
  tex.needsUpdate = true
}

// Parse text into display entries. Whitespace separates words, !...! keeps a
// phrase together, |inside| a word can split syllables, and |... ...| groups
// a phrase with spaces into one display entry.
function parseTextEntries(text: string): TextEntry[] {
  const result: TextEntry[] = []
  const parts = text.split('!')
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 0) {
      result.push(...parsePipeAwareSegment(parts[i]))
    } else {
      const grouped = parts[i].trim()
      if (grouped) result.push(...entriesForWord(grouped))
    }
  }
  return result
}

// Flight sprites are pooled: one mesh+texture reused across subdiv indices, retextured
// only when the (word, styling) key changes.
interface FlightPooled {
  mesh: Mesh
  texture: CanvasTexture
  mat: MeshBasicMaterial
  key: string
  active: boolean
}

const MAX_FLIGHT_SPRITES = 128
const MAX_SCATTER_WORDS = 16

const PARAMS: ParamDef[] = [
  { key: 'text', label: 'Text', type: 'string', default: 'HELLO', multiline: true },
  {
    key: 'font', label: 'Font', type: 'select', default: 0, options: [
      { value: 0, label: 'Impact / Sans' },
      { value: 1, label: 'Serif' },
      { value: 2, label: 'Monospace' },
      { value: 3, label: 'Sans-serif' },
      { value: 4, label: 'Old Press Caps (IM Fell SC)' },
      { value: 5, label: 'Old Press (IM Fell)' },
      { value: 6, label: 'Didone (Playfair)' },
      { value: 7, label: 'Poster (Bebas Neue)' },
      { value: 8, label: 'Neon (Righteous)' },
      { value: 9, label: 'Noir (Abril Fatface)' },
      { value: 10, label: 'Nostalgic (Comic Sans)' },
      { value: 11, label: 'Script (Brush)' },
      { value: 12, label: 'Proper (Palatino)' },
      { value: 13, label: 'Newsprint (Times)' },
      { value: 14, label: 'Terminal (Consolas)' },
    ],
  },
  {
    key: 'layoutMode', label: 'Layout', type: 'select', default: 0, options: [
      { value: 0, label: 'Center' },
      { value: 1, label: 'Scatter' },
    ],
  },
  { key: 'phraseGap', label: 'Phrase Gap (beats)', min: 0.5, max: 8, step: 0.5, default: 2, showIf: 'layoutMode' },
  { key: 'scatterSpread', label: 'Scatter Spread', min: 0.1, max: 1, step: 0.05, default: 0.6, showIf: 'layoutMode' },
  // Where the words sit, as a fraction of the frame from centre: -1/+1 reaches
  // the edge. Screen-relative rather than world units, so it means the same
  // thing at any aspect and survives export at a different resolution.
  //
  // These exist as PARAMS rather than leaving people to a transform effect
  // because params are what the automation lanes target - a child automation
  // track can move the words per word, per line, or along a path, which is the
  // whole point. Automating an effect could only ever move the effect.
  { key: 'posX', label: 'Position X', min: -1, max: 1, step: 0.02, default: 0 },
  { key: 'posY', label: 'Position Y', min: -1, max: 1, step: 0.02, default: 0 },
  // Only matters once Position is AUTOMATED - with a static position the two
  // modes are identical. "Per word" is the default because it is what lyrics
  // almost always want: a word that is still fading should hold the placement it
  // was born with, not slide across the frame chasing the live value while the
  // next word is already being placed somewhere else.
  {
    key: 'posMode', label: 'Position Applies', type: 'select', default: 1, options: [
      { value: 0, label: 'Live (moves every word)' },
      { value: 1, label: 'Per word (latched at onset)' },
    ],
  },
  // The same split for Size, and only meaningful once Size is AUTOMATED. Unlike
  // posMode this defaults to Live: Size has been automatable all along and has
  // always resized every word at once, so per-word by default would quietly
  // restyle existing projects.
  {
    key: 'sizeMode', label: 'Size Applies', type: 'select', default: 0, options: [
      { value: 0, label: 'Live (resizes every word)' },
      { value: 1, label: 'Per word (latched at onset)' },
    ],
  },
  { key: 'glow', label: 'Glow', min: 0, max: 1, step: 0.05, default: 0 },
  // Off = the halo bleeds outward past the stroke onto whatever is behind the
  // words (the original behaviour, kept as the default so no existing project
  // changes). On = it is clipped to the letter-plus-stroke silhouette, so the
  // stroke becomes a hard outer limit for the glow instead of something the
  // glow washes over.
  { key: 'glowContained', label: 'Contain Glow to Stroke', type: 'boolean', default: 0 },
  { key: 'jitter', label: 'Word Jitter', min: 0, max: 1, step: 0.05, default: 0 },
  {
    key: 'colorMode', label: 'Color Mode', type: 'select', default: 0, options: [
      { value: 0, label: 'Custom' },
      { value: 1, label: 'Invert Behind' },
    ],
  },
  { key: 'color', label: 'Text Color', type: 'color', default: '#ffffff' },
  { key: 'strokeColor', label: 'Stroke Color', type: 'color', default: '#000000' },
  { key: 'fontSize', label: 'Font Size', min: 0.1, max: 5, step: 0.1, default: 1 },
  { key: 'strokeWidth', label: 'Stroke Width', min: 0, max: 0.2, step: 0.01, default: 0.05 },
  // Soft black drop shadow under the glyphs - the short-form caption look
  // (white bold words floating over footage), where a stroke reads too hard.
  { key: 'shadow', label: 'Shadow', min: 0, max: 1, step: 0.05, default: 0 },
  { key: 'opacity', label: 'Opacity', min: 0, max: 1, step: 0.05, default: 1 },
  { key: 'releaseDuration', label: 'Release Fade', min: 0, max: 2, step: 0.05, default: 0.4 },
  { key: 'heightAmount', label: 'Height Amount', min: 0, max: 1, step: 0.05, default: 0.35 },
  { key: 'onsetBounce', label: 'Onset Bounce', min: 0, max: 0.5, step: 0.01, default: 0.08 },
  { key: 'delayTaps', label: 'Delay Taps', min: 0, max: MAX_DELAY_TAPS, step: 1, default: 0 },
  { key: 'delayTime', label: 'Delay Time', min: 0.05, max: 2, step: 0.05, default: 0.3, showIf: 'delayTaps' },
  { key: 'delayScaleFalloff', label: 'Delay Scale Falloff', min: 0, max: 0.5, step: 0.02, default: 0.15, showIf: 'delayTaps' },
  { key: 'delayOpacityFalloff', label: 'Delay Opacity Falloff', min: 0, max: 0.5, step: 0.02, default: 0.25, showIf: 'delayTaps' },
  { key: 'pingPongEnabled', label: 'Ping Pong Delay', type: 'boolean', default: 0, showIf: 'delayTaps' },
  { key: 'pingPongWidth', label: 'Ping Pong Width', min: 0.05, max: 1, step: 0.05, default: 0.3, showIf: 'pingPongEnabled' },
  { key: 'flightEnabled', label: 'Flight Mode', type: 'boolean', default: 0 },
  { key: 'flightSpeed', label: 'Flight Speed', min: 2, max: 60, step: 1, default: 15, showIf: 'flightEnabled' },
  { key: 'flightMaxDepth', label: 'Flight Max Depth', min: 10, max: 200, step: 5, default: 50, showIf: 'flightEnabled' },
  { key: 'flightDrift', label: 'Flight Drift', min: 0, max: 3, step: 0.1, default: 0.3, showIf: 'flightEnabled' },
  { key: 'flightTumble', label: 'Flight Tumble', min: 0, max: 5, step: 0.1, default: 0.5, showIf: 'flightEnabled' },
  { key: 'flightSubdivRate', label: 'Flight Spawns/Beat', min: 1, max: 32, step: 1, default: 8, showIf: 'flightEnabled' },
  { key: 'hue', label: 'Hue Shift', min: 0, max: 1, step: 0.01, default: 0 },
  { key: 'rainbowEnabled', label: 'Rainbow', type: 'boolean', default: 0 },
  { key: 'rainbowCycleLength', label: 'Rainbow Cycle Length', min: 2, max: 64, step: 1, default: 12, showIf: 'rainbowEnabled' },
  // --- Particle words: the words as a morphing particle cloud. Everything the
  // text pipeline already has (font, color, size, placement, height) is reused;
  // only what is genuinely particle-specific lives here. ---
  { key: 'particleEnabled', label: 'Particle Words', type: 'boolean', default: 0 },
  { key: 'particleCount', label: 'Particles', min: 1000, max: MAX_PARTICLES, step: 500, default: 6000, showIf: 'particleEnabled' },
  { key: 'particleSize', label: 'Dot Size', min: 0.005, max: 0.1, step: 0.005, default: 0.025, showIf: 'particleEnabled' },
  { key: 'particleGlow', label: 'Particle Glow', min: 0, max: 1, step: 0.001, default: 0.3, showIf: 'particleEnabled' },
  { key: 'particleOpaque', label: 'Opaque Dots', type: 'boolean', default: 0, showIf: 'particleEnabled' },
  { key: 'particleMorphBeats', label: 'Morph (beats)', min: 0.1, max: 8, step: 0.1, default: 2, showIf: 'particleEnabled' },
  { key: 'particleFillGap', label: 'Morph Fills Gap', type: 'boolean', default: 0, showIf: 'particleEnabled' },
  { key: 'particleStagger', label: 'Morph Stagger', min: 0, max: 1, step: 0.05, default: 0.4, showIf: 'particleEnabled' },
  { key: 'particleVariation', label: 'Color Variation', min: 0, max: 1, step: 0.05, default: 0.5, showIf: 'particleEnabled' },
  { key: 'particlePulse', label: 'Pulse Push (bass pop)', min: 0, max: 1.5, step: 0.05, default: 0.35, showIf: 'particleEnabled' },
]
const _hueColor = new Color()

function TextDisplayVisual({ trackId }: { trackId: string }) {
  const renderingFinalInvertMask = useContext(FinalInvertMaskContext)
  const groupRef = useRef<Group>(null)
  const meshRef = useRef<Mesh>(null)
  const textureRef = useRef<CanvasTexture | null>(null)

  // Cache keys for the main texture so we only re-render the canvas when needed.
  const lastRenderKeyRef = useRef('')

  // Delay echoes - one pre-created mesh per tap slot.
  const echoMeshesRef = useRef<Mesh[]>([])
  const echoTexturesRef = useRef<CanvasTexture[]>([])
  const echoLastWordsRef = useRef<string[]>([])

  // Flight mode mesh pool.
  const flightPoolRef = useRef<FlightPooled[]>([])

  // Scatter layout mesh pool - one mesh per visible phrase word.
  const scatterPoolRef = useRef<FlightPooled[]>([])

  // Particle-words mode: one shared cloud that morphs between word formations.
  // The anchor group carries placement + size.
  const particleAnchorRef = useRef<Group>(null)
  const particleCloud = useMemo(() => createParticleCloud(), [])
  useEffect(() => () => disposeParticleCloud(particleCloud), [particleCloud])

  const { viewport, camera } = useThree()
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const tex = new CanvasTexture(createTextCanvas('HELLO', 0.05, fontStack(0), '#ffffff', '#000000'))
    tex.minFilter = LinearFilter
    tex.magFilter = LinearFilter
    textureRef.current = tex

    const meshes: Mesh[] = []
    const textures: CanvasTexture[] = []
    const lastWords: string[] = []
    for (let i = 0; i < MAX_DELAY_TAPS; i++) {
      const echoTex = new CanvasTexture(createTextCanvas('', 0.05, fontStack(0), '#ffffff', '#000000'))
      echoTex.minFilter = LinearFilter
      echoTex.magFilter = LinearFilter
      textures.push(echoTex)
      lastWords.push('')
      const mat = new MeshBasicMaterial({ map: echoTex, transparent: true, alphaTest: TEXT_ALPHA_TEST, depthWrite: false, opacity: 0 })
      configureTextMaterial(mat, false)
      const mesh = new Mesh(new PlaneGeometry(1, 1), mat)
      mesh.visible = false
      meshes.push(mesh)
    }
    echoMeshesRef.current = meshes
    echoTexturesRef.current = textures
    echoLastWordsRef.current = lastWords

    setReady(true)
    return () => {
      tex.dispose()
      for (const t of textures) t.dispose()
      for (const m of meshes) { (m.material as Material).dispose(); m.geometry.dispose() }
      for (const spr of flightPoolRef.current) {
        spr.texture.dispose()
        spr.mat.dispose()
        spr.mesh.geometry.dispose()
      }
      flightPoolRef.current = []
      for (const spr of scatterPoolRef.current) {
        spr.texture.dispose()
        spr.mat.dispose()
        spr.mesh.geometry.dispose()
      }
      scatterPoolRef.current = []
    }
  }, [])

  // Parent the echo meshes onto the group once ready.
  useEffect(() => {
    if (!ready || !groupRef.current) return
    const g = groupRef.current
    for (const mesh of echoMeshesRef.current) g.add(mesh)
    return () => { for (const mesh of echoMeshesRef.current) g.remove(mesh) }
  }, [ready])

  function acquirePooled(pool: FlightPooled[], group: Group): FlightPooled {
    for (const spr of pool) {
      if (!spr.active) { spr.active = true; spr.mesh.visible = true; return spr }
    }
    const texture = new CanvasTexture(createTextCanvas('', 0.05, fontStack(0), '#ffffff', '#000000'))
    texture.minFilter = LinearFilter
    texture.magFilter = LinearFilter
    const mat = new MeshBasicMaterial({ map: texture, transparent: true, alphaTest: TEXT_ALPHA_TEST, opacity: 1, side: DoubleSide, depthWrite: false, toneMapped: false })
    configureTextMaterial(mat, false)
    const mesh = new Mesh(new PlaneGeometry(1, 1), mat)
    group.add(mesh)
    const entry: FlightPooled = { mesh, texture, mat, key: '', active: true }
    pool.push(entry)
    return entry
  }
  const acquireFlightSprite = (group: Group) => acquirePooled(flightPoolRef.current, group)

  useInstrumentFrame(trackId, (state) => {
    if (!textureRef.current || !meshRef.current || !groupRef.current) return false

    // Face the camera. R3F's Canvas silently calls camera.lookAt(0,0,0) when no
    // rotation is given, so the scene camera is pitched down atan(1.2/5) = 13.5
    // degrees. Full-frame instruments never notice - screenAnchor copies the
    // camera quaternion - but this instrument left fullFrame behind (c8c7c11,
    // "Unpin the text instrument from the camera") and landed in world space at
    // zero rotation, where that pitch keystones a flat plane: the top of a word
    // projected ~14% larger than its bottom. That taper is what read as the text
    // being tilted downward.
    //
    // Billboarding fixes the tilt without undoing c8c7c11 - the words still live
    // at a world POSITION, so movers and the camera still carry them around; only
    // their orientation is pinned. Conjugating by the parent's rotation rather
    // than overwriting it keeps any authored/mover rotation, which now applies on
    // top of the camera facing (i.e. it spins the billboard in screen space)
    // instead of being silently discarded.
    state.world.decompose(_billboardPos, _billboardParent, _billboardScale)
    // parentRotation⁻¹ * cameraRotation: the rotation that takes camera-space
    // into this group's parent space. Both the facing and the offset below need
    // it, so it is computed once.
    _billboardFace.copy(_billboardParent).invert().multiply(camera.quaternion)
    groupRef.current.quaternion.copy(_billboardFace).multiply(_billboardParent)

    // Position X/Y move the words across the FRAME, so the offset is built in
    // camera space and then rotated into the parent's. Setting group.position
    // directly would drag the words along world axes instead, which the 13.5
    // degree camera pitch turns into a diagonal - "up" would drift toward the
    // viewer as well as up the screen.
    // In Live mode the whole group carries the offset, so everything on screen
    // moves together. In Per-word mode the group stays put and each word carries
    // its OWN offset, sampled at the beat it was placed (see placementAt below).
    const livePlacement = (state.params.posMode ?? 1) < 0.5
    groupRef.current.position
      .set(
        livePlacement ? (state.params.posX ?? 0) * viewport.width * 0.5 : 0,
        livePlacement ? (state.params.posY ?? 0) * viewport.height * 0.5 : 0,
        0,
      )
      .applyQuaternion(_billboardFace)

    const p = state.params
    const text = state.stringParams.text ?? 'HELLO'
    const font = fontStack(p.font ?? 0)
    // A template face that hasn't finished loading yet: retry next frame
    // rather than baking fallback-family canvases into the cache.
    if (font.load && !ensureFont(font.load)) return false
    const color = state.stringParams.color || '#ffffff'
    const invertBehind = (p.colorMode ?? 0) >= 0.5
    const strokeColor = state.stringParams.strokeColor || ''
    const fontSize = p.fontSize ?? 1
    // Live by default: Size has always been automatable and has always resized
    // every word on screen at once, so defaulting to per-word would silently
    // restyle existing projects (same reasoning as glowContained).
    const perWordSize = (p.sizeMode ?? 0) >= 0.5
    const strokeWidth = p.strokeWidth ?? 0.05
    const textOpacity = p.opacity ?? 1
    const releaseDuration = p.releaseDuration ?? 0.4
    const heightAmount = p.heightAmount ?? 0.35
    // Placement latched at the beat a word was placed. With Position automated,
    // this is what stops a word that is still fading from sliding across the frame
    // to follow the live value while the next word is placed somewhere else.
    // Returns 0,0 in Live mode - the group is already carrying the offset there.
    const perWordPlacement = (p.posMode ?? 1) >= 0.5
    const placeX = (b: number) => (perWordPlacement
      ? paramAtBeat(state, 'posX', b) * viewport.width * 0.5 : 0)
    const placeY = (b: number) => (perWordPlacement
      ? paramAtBeat(state, 'posY', b) * viewport.height * 0.5 : 0)
    const onsetBounce = p.onsetBounce ?? 0.08
    const delayTaps = Math.round(p.delayTaps ?? 0)
    const delayTime = p.delayTime ?? 0.3
    const delayScaleFalloff = p.delayScaleFalloff ?? 0.15
    const delayOpacityFalloff = p.delayOpacityFalloff ?? 0.25
    const pingPongEnabled = (p.pingPongEnabled ?? 0) >= 0.5
    const pingPongWidth = p.pingPongWidth ?? 0.3
    const flightEnabled = (p.flightEnabled ?? 0) >= 0.5
    const flightSpeed = p.flightSpeed ?? 15
    const flightMaxDepth = p.flightMaxDepth ?? 50
    const flightDrift = p.flightDrift ?? 0.3
    const flightTumble = p.flightTumble ?? 0.5
    const flightSubdivRate = p.flightSubdivRate ?? 8
    const rainbowEnabled = (p.rainbowEnabled ?? 0) >= 0.5
    const rainbowCycleLength = p.rainbowCycleLength ?? 12
    const scatterMode = (p.layoutMode ?? 0) >= 0.5
    const phraseGap = p.phraseGap ?? 2
    const scatterSpread = p.scatterSpread ?? 0.6
    const glow = p.glow ?? 0
    const glowContained = (p.glowContained ?? 0) >= 0.5
    const shadow = p.shadow ?? 0
    const particleMode = (p.particleEnabled ?? 0) >= 0.5
    const jitter = p.jitter ?? 0
    // Hue Shift rotates whatever color is about to draw (authored or rainbow).
    // Quantized to 1/120th turns so an automated lane reuses a bounded set of
    // cached word canvases instead of minting one per sampled float.
    const hueShift = Math.round((((p.hue ?? 0) % 1) + 1) % 1 * 120) / 120
    const shiftHex = (hex: string) =>
      hueShift > 0 ? `#${_hueColor.set(hex).offsetHSL(hueShift, 0, 0).getHexString()}` : hex

    // Word size, either live or latched at the beat a word was placed - the same
    // split posMode makes for placement. `sizeAt` is called with whichever beat
    // owns the thing being drawn (this word's onset, an echo tap's note, a
    // flight sprite's spawn), so with Size automated a word keeps the size it
    // was born at instead of resizing under the next word's value.
    const sizeAt = (b: number) => Math.min(viewport.width, viewport.height) * 0.6
      * (perWordSize ? paramAtBeat(state, 'fontSize', b) : fontSize)

    // --- Particle words ---
    // One frame of the cloud, sharing the text pipeline's font, color (rainbow /
    // hue / invert included), size, placement and height offset - only the morph
    // itself has its own params. `word` null = idle: the sketch's sphere, shown
    // whenever there is no word to form yet. The 0.22 matches glyph heights:
    // particle-canvas glyphs fill ~0.46 of their frame vs ~0.245 for the text
    // canvas at scale sizeAt, and 0.245/0.46 * (canvas/world) lands there.
    const driveCloud = (word: null | {
      prev: WordShape
      cur: WordShape
      progress: number
      morphSeed: number
      pulseEnv: number
      /** Placement/size latch beats for the two ends of the morph. */
      fromBeat: number
      toBeat: number
      yOffset: number
    }) => {
      const anchor = particleAnchorRef.current
      if (!anchor) return
      anchor.visible = true
      // Placement and size travel WITH the morph: latched at the outgoing
      // word's onset on one end and the incoming word's on the other, eased by
      // the same curve as the particles - the cloud streams to the next word's
      // spot and lands exactly as it finishes forming, instead of teleporting
      // there on the note.
      const eased = word ? easeInOutQuad(Math.max(0, Math.min(1, word.progress))) : 1
      const from = word?.fromBeat ?? state.beat
      const to = word?.toBeat ?? state.beat
      const scaleFrom = sizeAt(from) * 0.22
      const scaleTo = sizeAt(to) * 0.22
      anchor.scale.setScalar(scaleFrom + (scaleTo - scaleFrom) * eased)
      const xFrom = placeX(from)
      const yFrom = placeY(from)
      anchor.position.set(
        xFrom + (placeX(to) - xFrom) * eased,
        (word?.yOffset ?? 0) * viewport.height * heightAmount + yFrom + (placeY(to) - yFrom) * eased,
        0,
      )
      // Brightness normalization: per-pixel additive stacking is particles per
      // on-screen glyph pixel, so the SAME glow reads blazing on a short word
      // ("I": everything piled on a few hundred pixels) and washed out on a
      // long one. Compensate by each word's glyph area x its latched scale,
      // per particle, eased through the morph like everything else. ~1 for a
      // typical mid-length word at this template's sizes, so tuned glows keep
      // meaning what they meant.
      const prevShape = word?.prev ?? SPHERE_SHAPE
      const curShape = word?.cur ?? SPHERE_SHAPE
      const count = p.particleCount ?? 6000
      const areaFrom = prevShape.fill * scaleFrom * scaleFrom
      const areaTo = curShape.fill * scaleTo * scaleTo
      const stackComp = Math.min(6, Math.max(0.15, (areaFrom + (areaTo - areaFrom) * eased) / count))
      const cloudSubdiv = Math.floor(state.beat * flightSubdivRate)
      const cloudHue = rainbowEnabled ? ((cloudSubdiv % rainbowCycleLength) / rainbowCycleLength) * 360 : 0
      // Invert mode renders plain white - the invert blending trick is
      // canvas-plane-only, and white additive points read closest to it.
      const cloudColor = invertBehind ? '#ffffff' : shiftHex(rainbowEnabled ? hslToHex(cloudHue, 1, 0.55) : color)
      updateParticleCloud(particleCloud, {
        count,
        dotSize: p.particleSize ?? 0.025,
        glow: p.particleGlow ?? 0.3,
        opaque: (p.particleOpaque ?? 0) >= 0.5,
        color: cloudColor,
        variation: p.particleVariation ?? 0.5,
        prevTargets: prevShape.targets,
        curTargets: curShape.targets,
        progress: word?.progress ?? 1,
        morphSeed: word?.morphSeed ?? 0,
        stagger: p.particleStagger ?? 0.4,
        pulseScale: 1 + (p.particlePulse ?? 0.35) * (word?.pulseEnv ?? 0),
        stackComp,
      })
      setAnimatedOpacity(particleCloud.points.material as Material, textOpacity)
    }
    if (!particleMode && particleAnchorRef.current) particleAnchorRef.current.visible = false

    const entries = parseTextEntries(text)
    if (entries.length === 0) {
      meshRef.current.visible = false
      if (particleMode) driveCloud(null) // no words on the sheet yet: idle sphere
      return
    }

    const currentBeat = state.beat
    const secPerBeat = state.secPerBeat

    // --- Note derivation (pure) ---
    // Every visual below is a function of the beat and the resolved note list: the
    // word index is the count of past "next word" onsets, and every age (bounce,
    // release fade, bass pop, sprite flight) is measured from a note's beat.
    const nextWordNotes: ResolvedNote[] = []
    const heightNotes: ResolvedNote[] = []
    let lastBassNote: ResolvedNote | null = null
    let lastWordEndBeat = -1
    for (const n of state.notes) {
      if (n.beat > currentBeat) break // notes are sorted by beat
      if (n.pitch === PITCH_NEXT_WORD) {
        nextWordNotes.push(n)
        lastWordEndBeat = Math.max(lastWordEndBeat, n.beat + n.durationBeats)
      } else if (n.pitch === PITCH_BASS_POP) {
        lastBassNote = n
      } else if (n.pitch >= PITCH_HEIGHT_MIN && n.pitch <= PITCH_HEIGHT_MAX) {
        heightNotes.push(n)
      }
    }

    if (nextWordNotes.length === 0) {
      meshRef.current.visible = false
      setAnimatedOpacity(meshRef.current.material as MeshBasicMaterial, 0)
      for (const mesh of echoMeshesRef.current) mesh.visible = false
      for (const spr of flightPoolRef.current) {
        spr.active = false
        spr.mesh.visible = false
      }
      for (const spr of scatterPoolRef.current) {
        spr.active = false
        spr.mesh.visible = false
      }
      if (particleMode) {
        // Anticipate the FIRST word: the sphere starts morphing into it early
        // enough to land fully formed exactly on its note.
        let firstNote: ResolvedNote | undefined
        for (const n of state.notes) {
          if (n.pitch === PITCH_NEXT_WORD) { firstNote = n; break }
        }
        const duration = Math.max(0.05, p.particleMorphBeats ?? 2)
        const morphStart = firstNote ? firstNote.beat - duration : Infinity
        if (!firstNote || currentBeat < morphStart) {
          driveCloud(null) // idle sphere
        } else {
          driveCloud({
            prev: SPHERE_SHAPE,
            cur: wordShape(entries[0].text, font) ?? SPHERE_SHAPE,
            progress: Math.min(1, (currentBeat - morphStart) / duration),
            morphSeed: 61.7,
            pulseEnv: 0,
            // From the live placement where the idle sphere sat when the morph
            // began, to the first word's own latched placement.
            fromBeat: morphStart,
            toBeat: firstNote.beat,
            yOffset: 0,
          })
        }
      }
      return
    }

    // Is some word note sounding at beat b? (gates flight spawns / release fade)
    const nextWordHeldAt = (b: number) => {
      for (const n of nextWordNotes) {
        if (n.beat > b) break
        if (b < n.beat + n.durationBeats) return true
      }
      return false
    }

    // Count of word onsets at or before beat b - the word index at that beat.
    const wordCountAt = (b: number) => {
      let c = 0
      for (const n of nextWordNotes) { if (n.beat <= b) c++; else break }
      return c
    }

    // Height offset at beat b: the highest held 60-72 pitch, else the last one to
    // release stays in effect (sticky, like Tyler's ref did).
    const yOffsetAt = (b: number) => {
      let heldPitch = -1
      let sticky: ResolvedNote | null = null
      for (const n of heightNotes) {
        if (n.beat > b) break
        if (b < n.beat + n.durationBeats && n.pitch > heldPitch) heldPitch = n.pitch
        const end = n.beat + n.durationBeats
        const stickyEnd = sticky ? sticky.beat + sticky.durationBeats : -Infinity
        if (end > stickyEnd || (end === stickyEnd && sticky && n.pitch > sticky.pitch)) sticky = n
      }
      const pitch = heldPitch >= 0 ? heldPitch : sticky ? sticky.pitch : -1
      return pitch < 0 ? 0 : (pitch - PITCH_HEIGHT_CENTER) / (PITCH_HEIGHT_MAX - PITCH_HEIGHT_CENTER)
    }

    const wordCount = nextWordNotes.length
    const lastWordNote = wordCount > 0 ? nextWordNotes[wordCount - 1] : null
    const currentEntry = entries[(Math.max(1, wordCount) - 1) % entries.length] ?? entries[0]
    const isNoteHeld = currentBeat < lastWordEndBeat
    const currentYOffset = yOffsetAt(currentBeat)

    // Rainbow hue cycles on beat subdivisions.
    const rainbowSubdiv = Math.floor(currentBeat * flightSubdivRate)
    const rainbowHue = rainbowEnabled ? ((rainbowSubdiv % rainbowCycleLength) / rainbowCycleLength) * 360 : 0
    const effectiveColor = shiftHex(rainbowEnabled ? hslToHex(rainbowHue, 1, 0.55) : color)
    const canvasColor = invertBehind ? '#ffffff' : effectiveColor
    const canvasStrokeColor = invertBehind ? '#ffffff' : strokeColor

    // --- Particle words: the cloud replaces every plane-based word visual ---
    if (particleMode) {
      meshRef.current.visible = false
      setAnimatedOpacity(meshRef.current.material as MeshBasicMaterial, 0)
      for (const mesh of echoMeshesRef.current) mesh.visible = false
      for (const spr of flightPoolRef.current) { spr.active = false; spr.mesh.visible = false }
      for (const spr of scatterPoolRef.current) { spr.active = false; spr.mesh.visible = false }

      const curIdx = wordCount - 1 // note index of the word on screen
      const curNote = nextWordNotes[curIdx]
      // Morph endpoints: sphere → word 1 → word 2 → ... A word that rasterizes
      // to nothing falls back to the sphere.
      const shapeFor = (i: number) => (i < 0
        ? SPHERE_SHAPE
        : wordShape(entries[i % entries.length].text, font) ?? SPHERE_SHAPE)

      // Anticipatory morphing: the transition into a word plays out in the gap
      // BEFORE its note and lands exactly ON the beat, rather than starting at
      // the note and arriving late. Duration = min(Morph beats, the gap): with
      // room to spare the word holds, then departs just in time; with none the
      // whole gap IS the morph. Morph Fills Gap skips the cap entirely - every
      // transition spans the full distance between its two notes, so the cloud
      // is always in motion at whatever speed the lyric is moving.
      let nextNote: ResolvedNote | undefined
      for (const n of state.notes) {
        if (n.beat > currentBeat && n.pitch === PITCH_NEXT_WORD) { nextNote = n; break }
      }
      const fillGap = (p.particleFillGap ?? 0) >= 0.5
      const morphStart = nextNote
        ? (fillGap
          ? curNote.beat
          : nextNote.beat - Math.max(0.05, Math.min(p.particleMorphBeats ?? 2, nextNote.beat - curNote.beat)))
        : Infinity

      // Bass pop, in cloud form: a decaying outward swell instead of the punch.
      let pulseEnv = 0
      if (lastBassNote) {
        const age = currentBeat - lastBassNote.beat
        if (age < 0.6) {
          const decay = 1 - age / 0.6
          const velocity = lastBassNote.velocity <= 1 ? lastBassNote.velocity : lastBassNote.velocity / 127
          pulseEnv = decay * decay * velocity
        }
      }

      if (nextNote && currentBeat >= morphStart) {
        // In transit to the upcoming word.
        driveCloud({
          prev: shapeFor(curIdx),
          cur: shapeFor(curIdx + 1),
          progress: Math.min(1, (currentBeat - morphStart) / (nextNote.beat - morphStart)),
          morphSeed: (curIdx + 2) * 61.7,
          pulseEnv,
          fromBeat: curNote.beat,
          toBeat: nextNote.beat,
          yOffset: currentYOffset,
        })
      } else {
        // Holding the current word, fully formed.
        driveCloud({
          prev: shapeFor(curIdx),
          cur: shapeFor(curIdx),
          progress: 1,
          morphSeed: (curIdx + 1) * 61.7,
          pulseEnv,
          fromBeat: curNote.beat,
          toBeat: curNote.beat,
          yOffset: currentYOffset,
        })
      }
      return
    }

    const invertInThisPass = invertBehind && !renderingFinalInvertMask
    configureTextMaterial(meshRef.current.material as MeshBasicMaterial, invertInThisPass)
    for (const mesh of echoMeshesRef.current) configureTextMaterial(mesh.material as MeshBasicMaterial, invertInThisPass)
    for (const spr of flightPoolRef.current) configureTextMaterial(spr.mat, invertInThisPass)

    // --- Scatter layout ---
    // The phrase accumulates as a loose collage: each word lands at a seeded
    // scattered anchor (position, tilt, size all keyed to its word index, so a
    // scrub reproduces the exact arrangement), earlier phrase words stay dimmed,
    // and a gap of `phraseGap` beats between word onsets hard-clears the canvas
    // by starting a new phrase. Echo taps and flight mode are Center-layout
    // features and stay dormant here.
    if (scatterMode) {
      meshRef.current.visible = false
      setAnimatedOpacity(meshRef.current.material as MeshBasicMaterial, 0)
      for (const mesh of echoMeshesRef.current) mesh.visible = false
      for (const spr of flightPoolRef.current) { spr.active = false; spr.mesh.visible = false }

      // Phrase start: the most recent onset gap of phraseGap beats or more.
      let phraseStart = 0
      for (let k = wordCount - 1; k >= 1; k--) {
        if (nextWordNotes[k].beat - nextWordNotes[k - 1].beat >= phraseGap) { phraseStart = k; break }
      }
      phraseStart = Math.max(phraseStart, wordCount - MAX_SCATTER_WORDS)

      let releaseOpacity = 1
      if (!isNoteHeld && lastWordNote) {
        const releaseAge = (currentBeat - lastWordEndBeat) * secPerBeat
        releaseOpacity = releaseDuration > 0 ? Math.max(0, 1 - releaseAge / releaseDuration) : 0
      }

      const onsetAge = lastWordNote ? (currentBeat - lastWordNote.beat) * secPerBeat : 1
      const bassPopAge = lastBassNote ? (currentBeat - lastBassNote.beat) * secPerBeat : 1
      const bassPopDecay = Math.max(0, 1 - bassPopAge / 0.25)
      const bassPopScale = 1 + 0.25 * bassPopDecay * bassPopDecay

      for (const spr of scatterPoolRef.current) { spr.active = false; spr.mesh.visible = false }
      if (releaseOpacity > 0) {
        const placedAnchors: [number, number][] = []
        for (let i = phraseStart; i < wordCount; i++) {
          const entry = entries[i % entries.length]
          const spr = acquirePooled(scatterPoolRef.current, groupRef.current)
          configureTextMaterial(spr.mat, invertInThisPass)
          const sprKey = `${entry.cacheKey}|${strokeWidth}|${font.css}|${font.weight}|${canvasColor}|${canvasStrokeColor}|${glow}|${shadow}`
          if (sprKey !== spr.key) {
            spr.key = sprKey
            setTextureCanvas(spr.texture, createTextCanvas(entry, strokeWidth, font, canvasColor, canvasStrokeColor, glow, glowContained, shadow))
          }

          const s = i * 131
          const newest = i === wordCount - 1

          // Seeded anchor with collision retries: take the first candidate far
          // enough from the phrase's recent words (still deterministic - the
          // attempt sequence is fixed per word index), so stacked overlapping
          // words are rare instead of common.
          let nx = 0
          let ny = 0
          for (let attempt = 0; attempt < 6; attempt++) {
            nx = seededRand(s + 5 + attempt * 17) - 0.5
            ny = seededRand(s + 6 + attempt * 17) - 0.5
            let clear = true
            for (let k = Math.max(0, placedAnchors.length - 3); k < placedAnchors.length; k++) {
              const dx = nx - placedAnchors[k][0]
              // Words are wide: vertical separation clears an overlap sooner
              // than horizontal, so weight dy up.
              const dy = (ny - placedAnchors[k][1]) * 1.6
              if (dx * dx + dy * dy < 0.32 * 0.32) { clear = false; break }
            }
            if (clear) break
          }
          placedAnchors.push([nx, ny])
          const rot = (seededRand(s + 7) - 0.5) * 2 * (0.03 + jitter * 0.12)
          const sizeJ = 1 + (seededRand(s + 8) - 0.5) * 2 * jitter * 0.18
          // Newest word pops on: overshoot scale plus a 2-frame brightness
          // flicker, both closed-form from the onset age.
          const onsetT = newest ? Math.min(onsetAge / 0.12, 1) : 1
          const popScale = (1 + onsetBounce * 2 * (1 - onsetT)) * (newest ? bassPopScale : 1)
          const flickerK = newest && onsetAge < 0.1
            ? 0.7 + 0.3 * (Math.floor(onsetAge * 30) % 2)
            : 1

          // This word's own onset - both its latched size and its latched
          // placement are sampled at it.
          const scatterBeat = nextWordNotes[i]?.beat ?? currentBeat
          const scale = sizeAt(scatterBeat) * 0.55 * sizeJ * popScale
          spr.mesh.scale.set(scale * texAspect(spr.texture), scale, 1)
          spr.mesh.position.set(
            nx * viewport.width * scatterSpread + placeX(scatterBeat),
            ny * viewport.height * scatterSpread * 0.8 + placeY(scatterBeat),
            -0.0005 * (wordCount - i),
          )
          spr.mesh.rotation.set(0, 0, rot)
          setAnimatedOpacity(spr.mat, (newest ? 1 : 0.78) * flickerK * releaseOpacity * textOpacity)
        }
      }
      return
    }
    for (const spr of scatterPoolRef.current) { spr.active = false; spr.mesh.visible = false }

    // Re-render main texture when the word or styling changes.
    const renderKey = `${currentEntry.cacheKey}|${strokeWidth}|${font.css}|${font.weight}|${canvasColor}|${canvasStrokeColor}|${glow}|${shadow}`
    if (renderKey !== lastRenderKeyRef.current) {
      lastRenderKeyRef.current = renderKey
      setTextureCanvas(textureRef.current, createTextCanvas(currentEntry, strokeWidth, font, canvasColor, canvasStrokeColor, glow, glowContained, shadow))
      // Invalidate echo caches so they re-render with new styling.
      echoLastWordsRef.current.fill('')
    }

    // --- Flight mode ---
    // One sprite per past flight subdiv where a word note was held. Each sprite's
    // pose is closed-form from its age (no per-frame integration), with drift and
    // tumble seeded from the subdiv index, so scrubbing reproduces it exactly.
    for (const spr of flightPoolRef.current) { spr.active = false; spr.mesh.visible = false }
    if (flightEnabled) {
      const lifeBeats = flightMaxDepth / flightSpeed / secPerBeat
      const kMax = Math.floor(currentBeat * flightSubdivRate)
      const kMin = Math.max(0, Math.ceil((currentBeat - lifeBeats) * flightSubdivRate), kMax - MAX_FLIGHT_SPRITES + 1)
      for (let k = kMin; k <= kMax; k++) {
        const spawnBeat = k / flightSubdivRate
        if (spawnBeat > currentBeat || !nextWordHeldAt(spawnBeat)) continue
        const ageSec = (currentBeat - spawnBeat) * secPerBeat
        const depth = flightSpeed * ageSec
        if (depth > flightMaxDepth) continue

        const sprWordIdx = Math.max(1, wordCountAt(spawnBeat)) - 1
        const sprEntry = entries[sprWordIdx % entries.length] ?? entries[0]
        // Placement latches to the WORD's onset, not to this sprite's subdivision.
        // A word held for two beats emits a sprite every subdiv, and latching each
        // one to its own subdiv meant the trail split across a placement change:
        // the copies emitted after the step jumped to the new spot while the older
        // ones stayed behind. The trail belongs to one word, so it takes one
        // placement - only the NEXT word moves.
        const sprOnsetBeat = nextWordNotes[sprWordIdx]?.beat ?? spawnBeat
        const sprColor = invertBehind
          ? '#ffffff'
          : shiftHex(rainbowEnabled ? hslToHex(((k % rainbowCycleLength) / rainbowCycleLength) * 360, 1, 0.55) : color)
        const seed = k * 13 + 7
        const vx = (seededRand(seed) - 0.5) * flightDrift
        const vy = (seededRand(seed + 1) - 0.5) * flightDrift * 0.6
        const tumbleX = (seededRand(seed + 2) - 0.5) * flightTumble
        const tumbleY = (seededRand(seed + 3) - 0.5) * flightTumble

        const spr = acquireFlightSprite(groupRef.current)
        configureTextMaterial(spr.mat, invertInThisPass)
        const sprStrokeColor = invertBehind ? '#ffffff' : strokeColor
        const sprKey = `${sprEntry.cacheKey}|${strokeWidth}|${font.css}|${font.weight}|${sprColor}|${sprStrokeColor}|${glow}|${shadow}`
        if (sprKey !== spr.key) {
          spr.key = sprKey
          setTextureCanvas(spr.texture, createTextCanvas(sprEntry, strokeWidth, font, sprColor, sprStrokeColor, glow, glowContained, shadow))
        }
        spr.mesh.position.set(
          vx * ageSec + placeX(sprOnsetBeat),
          yOffsetAt(spawnBeat) * viewport.height * heightAmount + vy * ageSec + placeY(sprOnsetBeat),
          -depth,
        )
        spr.mesh.rotation.set(tumbleX * ageSec, tumbleY * ageSec, 0)
        const sprScale = sizeAt(sprOnsetBeat)
        spr.mesh.scale.set(sprScale * texAspect(spr.texture), sprScale, 1)
        const fadeStart = flightMaxDepth * 0.7
        setAnimatedOpacity(spr.mat, depth > fadeStart
          ? textOpacity * Math.max(0, 1 - (depth - fadeStart) / (flightMaxDepth - fadeStart))
          : textOpacity)
      }
    }

    // --- Main mesh ---
    let releaseOpacity = 1
    if (isNoteHeld) {
      releaseOpacity = 1
    } else if (lastWordNote) {
      const releaseAge = (currentBeat - lastWordEndBeat) * secPerBeat
      releaseOpacity = releaseDuration > 0 ? Math.max(0, 1 - releaseAge / releaseDuration) : 0
    }
    meshRef.current.visible = releaseOpacity > 0

    const onsetDuration = 0.12
    const onsetAge = lastWordNote ? (currentBeat - lastWordNote.beat) * secPerBeat : onsetDuration
    const onsetT = Math.min(onsetAge / onsetDuration, 1)
    const onsetScale = 1 + onsetBounce * (1 - onsetT)

    const bassPopDuration = 0.25
    const bassPopAge = lastBassNote ? (currentBeat - lastBassNote.beat) * secPerBeat : bassPopDuration
    const bassPopT = Math.min(bassPopAge / bassPopDuration, 1)
    const bassPopDecay = 1 - bassPopT
    const bassPopScale = 1 + 0.25 * bassPopDecay * bassPopDecay
    const shakeFreq = 35
    const shakeAmount = 0.02 * bassPopDecay * bassPopDecay
    const shakeX = Math.sin(bassPopAge * shakeFreq * Math.PI * 2) * shakeAmount * viewport.width
    const shakeY = Math.cos(bassPopAge * shakeFreq * Math.PI * 2 * 0.7) * shakeAmount * viewport.height

    setAnimatedOpacity(meshRef.current.material as MeshBasicMaterial, textOpacity * releaseOpacity)
    // Word jitter: hand-set-type imperfection, seeded per word index so a
    // scrub lands on the identical tilt/size/baseline for each word.
    const wordIdx = wordCount - 1
    const jitterSize = 1 + (seededRand(wordIdx * 131 + 8) - 0.5) * 2 * jitter * 0.18
    const wordOnsetBeat = lastWordNote ? lastWordNote.beat : currentBeat
    const scale = sizeAt(wordOnsetBeat) * onsetScale * bassPopScale * jitterSize
    meshRef.current.scale.set(scale * texAspect(textureRef.current), scale, 1)
    meshRef.current.rotation.z = (seededRand(wordIdx * 131 + 7) - 0.5) * 2 * jitter * 0.12
    meshRef.current.position.x = shakeX + placeX(wordOnsetBeat)
    meshRef.current.position.y = currentYOffset * viewport.height * heightAmount + shakeY
      + placeY(wordOnsetBeat)
      + (seededRand(wordIdx * 131 + 9) - 0.5) * 2 * jitter * viewport.height * 0.04

    // --- Delay taps ---
    for (let tap = 0; tap < MAX_DELAY_TAPS; tap++) {
      const mesh = echoMeshesRef.current[tap]
      if (!mesh) continue
      if (tap >= delayTaps) { mesh.visible = false; continue }

      const tapNum = tap + 1
      const tapOffset = tapNum * delayTime

      // Most recent word onset whose echo for this tap has already started.
      let echoIdx = -1
      let echoAge = 0
      for (let h = wordCount - 1; h >= 0; h--) {
        const age = (currentBeat - nextWordNotes[h].beat) * secPerBeat - tapOffset
        if (age >= 0) { echoIdx = h; echoAge = age; break }
      }
      if (echoIdx < 0) { mesh.visible = false; continue }

      const echoNote = nextWordNotes[echoIdx]
      const heldSec = echoNote.durationBeats * secPerBeat
      const echoDuration = heldSec > 0 ? heldSec : delayTime
      if (echoAge > echoDuration) { mesh.visible = false; continue }

      const echoEntry = entries[echoIdx % entries.length]
      const tex = echoTexturesRef.current[tap]
      const echoKey = `${echoEntry.cacheKey}|${canvasColor}|${canvasStrokeColor}|${shadow}`
      if (echoKey !== echoLastWordsRef.current[tap]) {
        setTextureCanvas(tex, createTextCanvas(echoEntry, strokeWidth, font, canvasColor, canvasStrokeColor, glow, glowContained, shadow))
        echoLastWordsRef.current[tap] = echoKey
      }

      const tapScale = sizeAt(echoNote.beat) * Math.max(0.1, 1 - delayScaleFalloff * tapNum)
      mesh.scale.set(tapScale * texAspect(tex), tapScale, 1)
      mesh.position.x = (pingPongEnabled ? (tapNum % 2 === 1 ? -1 : 1) * pingPongWidth * viewport.width * 0.5 : 0)
        + placeX(echoNote.beat)
      mesh.position.y = yOffsetAt(echoNote.beat) * viewport.height * heightAmount + placeY(echoNote.beat)
      mesh.position.z = -0.01 * tapNum
      setAnimatedOpacity(mesh.material as MeshBasicMaterial, Math.max(0.01, 1 - delayOpacityFalloff * tapNum) * textOpacity)
      mesh.visible = true
    }
  })

  if (!ready) return null

  return (
    <group ref={groupRef}>
      {/* Hidden until the frame callback has real state: the initial texture
          is a warm-up placeholder ('HELLO'), and before the engine computes
          this track's state nothing runs to replace it - a fresh, paused
          editor would otherwise show the placeholder until first play. */}
      <mesh ref={meshRef} visible={false}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial
          map={textureRef.current}
          transparent
          alphaTest={TEXT_ALPHA_TEST}
          depthWrite={false}
        />
      </mesh>
      {/* Particle-words cloud - hidden until the frame callback drives it. */}
      <group ref={particleAnchorRef} visible={false}>
        <primitive object={particleCloud.points} />
      </group>
    </group>
  )
}

export const textDisplayInstrument: ObjectInstrumentDef = {
  id: 'textDisplay',
  name: 'Text Display',
  kind: 'object',
  userInterfaceRenderer: 'textDisplay',
  params: PARAMS,
  midiRows: [
    { pitch: PITCH_NEXT_WORD, label: 'Next word', color: '#facc15', emphasized: true },
    { pitch: PITCH_BASS_POP, label: 'Bass pop (punch + shake)' },
    { pitch: 72, label: 'Word height · top' },
    { pitch: 69, label: 'Word height · high' },
    { pitch: 66, label: 'Word height · center' },
    { pitch: 63, label: 'Word height · low' },
    { pitch: 60, label: 'Word height · bottom' },
  ],
  component: TextDisplayVisual,
  // NOT fullFrame: the text lives in world space so movers (and the camera)
  // can act on it - it is deliberately not pinned to the viewport.
  defaultOnTop: true,
}
