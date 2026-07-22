import { useContext, useRef, useEffect, useState } from 'react'
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
import { useInstrumentFrame, seededRand } from '../core/visual/instrumentFrame'
import { ensureFont } from '../core/visual/fonts'
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

/** A shape drawn BEHIND the words, on the same canvas. Same canvas rather than a
 *  second mesh on purpose: echoes, scatter and flight all clone the word texture,
 *  so a backdrop baked into it follows them everywhere for free, and stays exactly
 *  registered with the glyphs at any scale. */
export interface Backdrop {
  /** 0 none, 1 pill, 2 box, 3 blob, 4 ellipse, 5 tape. */
  shape: number
  color: string
  opacity: number
  /** Extra breathing room around the text, as a fraction of the font size. */
  pad: number
}
const NO_BACKDROP: Backdrop = { shape: 0, color: '#000000', opacity: 1, pad: 0 }

/** Stable per-word seed for the irregular shapes. Word LENGTH alone collides on
 *  most of a lyric, which would hand half the song the same blob. */
function textSeed(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0) / 4294967295
}

/** Half-extents of the backdrop around the text, in CSS px. THE single source of
 *  truth: both the canvas sizing and the drawing read it, because they disagreed
 *  once and wide words came out with their blob sliced off at the canvas edge.
 *
 *  Round shapes need a proportional allowance, not a flat one - an ellipse drawn
 *  through a word's corners has to bulge wider the wider the word is, so the
 *  extra grows with textWidth rather than sitting at a fixed number of pixels. */
function backdropExtent(backdrop: Backdrop, textWidth: number, fontSize: number) {
  const round = backdrop.shape === 3 || backdrop.shape === 4
  const padX = fontSize * (0.28 + backdrop.pad) + (round ? textWidth * 0.1 : 0)
  // 0.36 of the em box approximates half the cap height - using the full box
  // leaves a visible band of dead space under short words.
  const padY = fontSize * (0.20 + backdrop.pad * 0.8) + (round ? fontSize * 0.14 : 0)
  return { halfW: textWidth / 2 + padX, halfH: fontSize * 0.36 + padY }
}

function drawBackdrop(
  ctx: CanvasRenderingContext2D,
  backdrop: Backdrop,
  cx: number,
  cy: number,
  textWidth: number,
  fontSize: number,
  seed: number,
) {
  if (backdrop.shape < 1 || backdrop.opacity <= 0) return
  const { halfW, halfH } = backdropExtent(backdrop, textWidth, fontSize)
  ctx.save()
  ctx.globalAlpha = backdrop.opacity
  ctx.fillStyle = backdrop.color
  ctx.beginPath()

  switch (Math.round(backdrop.shape)) {
    case 1: // pill - fully rounded ends
      ctx.roundRect(cx - halfW, cy - halfH, halfW * 2, halfH * 2, halfH)
      break
    case 2: // box - a hint of a radius so it does not read as a UI panel
      ctx.roundRect(cx - halfW, cy - halfH, halfW * 2, halfH * 2, halfH * 0.16)
      break
    case 3: { // blob - a closed curve through wobbled radii, seeded per word so
      // each word keeps its OWN shape frame to frame instead of boiling
      const points = 12
      const pts: [number, number][] = []
      for (let i = 0; i < points; i++) {
        const a = (i / points) * Math.PI * 2
        const wobble = 0.78 + seededRand(seed + i * 7.3) * 0.42
        pts.push([cx + Math.cos(a) * halfW * wobble, cy + Math.sin(a) * halfH * wobble])
      }
      // Midpoint-to-midpoint quadratics keep the outline smooth and closed.
      ctx.moveTo((pts[0][0] + pts[points - 1][0]) / 2, (pts[0][1] + pts[points - 1][1]) / 2)
      for (let i = 0; i < points; i++) {
        const cur = pts[i]
        const next = pts[(i + 1) % points]
        ctx.quadraticCurveTo(cur[0], cur[1], (cur[0] + next[0]) / 2, (cur[1] + next[1]) / 2)
      }
      break
    }
    case 4: // ellipse
      ctx.ellipse(cx, cy, halfW, halfH, 0, 0, Math.PI * 2)
      break
    case 5: { // tape - a torn strip, tilted a little and ragged at both ends
      const tilt = (seededRand(seed + 3.1) - 0.5) * 0.09
      ctx.translate(cx, cy)
      ctx.rotate(tilt)
      const notch = halfH * 0.22
      ctx.moveTo(-halfW, -halfH)
      ctx.lineTo(halfW, -halfH + notch * (seededRand(seed + 1.7) - 0.5))
      ctx.lineTo(halfW - notch, 0)
      ctx.lineTo(halfW, halfH + notch * (seededRand(seed + 2.3) - 0.5))
      ctx.lineTo(-halfW, halfH)
      ctx.lineTo(-halfW + notch, 0)
      ctx.closePath()
      break
    }
  }

  ctx.fill()
  ctx.restore()
}

function createTextCanvas(
  word: TextEntry | string,
  strokeWidth: number,
  font: FontDef,
  color: string,
  strokeColor: string,
  glow = 0,
  backdrop: Backdrop = NO_BACKDROP,
): HTMLCanvasElement {
  const entry = typeof word === 'string' ? singleTextEntry(word) : word
  const key = `${entry.cacheKey}|${strokeWidth}|${font.css}|${font.weight}|${color}|${strokeColor}|${glow}`
    + `|${backdrop.shape}|${backdrop.color}|${backdrop.opacity}|${backdrop.pad}`
  const cached = canvasCache.get(key)
  if (cached) return cached

  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')!

  // Constant glyph height; the canvas WIDTH follows the text (the mesh
  // stretches by the resulting aspect), so every word renders letters the
  // same height - "awesome" comes out wider than "hello", not smaller.
  let fontSize = TEXT_CANVAS_SIZE * 0.35
  // Canvas WIDTH grows with the word, but its HEIGHT is fixed - so unlike the
  // stroke and glow, a tall backdrop cannot simply pad its way out and instead
  // gets its top and bottom sliced off at the canvas edge. Shrink the glyphs
  // until the shape fits: every word shares this fontSize, so they all shrink
  // together and the constant-glyph-height rule still holds.
  if (backdrop.shape >= 1) {
    // halfH is fontSize * (0.36 + 0.20 + pad*0.8) plus the round-shape allowance,
    // all linear in fontSize - so solve it for the half-canvas directly.
    const round = backdrop.shape === 3 || backdrop.shape === 4
    const perPx = 0.56 + backdrop.pad * 0.8 + (round ? 0.14 : 0)
    fontSize = Math.min(fontSize, (TEXT_CANVAS_SIZE * 0.49) / perPx)
  }
  const fontStr = (size: number) => `${font.weight} ${size}px ${font.css}`
  ctx.font = fontStr(fontSize)

  const layoutText = entry.layoutText || entry.text
  // Stroke joins and glow halos poke past the glyph box - pad for both.
  const pad = TEXT_CANVAS_SIZE * 0.04 + strokeWidth * fontSize + glow * fontSize * 0.35
  // A round backdrop also widens PROPORTIONALLY, so it eats into how much text
  // can fit before the aspect cap; divide the budget rather than subtract from it.
  const roundBackdrop = backdrop.shape === 3 || backdrop.shape === 4
  const backdropFixed = backdrop.shape >= 1 ? fontSize * (0.28 + backdrop.pad) : 0
  const maxTextWidth = (TEXT_CANVAS_SIZE * MAX_TEXT_ASPECT - (pad + backdropFixed) * 2)
    / (roundBackdrop ? 1.2 : 1)
  let measured = ctx.measureText(layoutText).width
  if (measured > maxTextWidth && measured > 0) {
    fontSize *= maxTextWidth / measured
    measured = maxTextWidth
  }
  // Widen to whichever needs more room: the glyphs plus their halos, or the whole
  // backdrop. Sizing from backdropExtent is what guarantees the shape never clips.
  let cssWidth = Math.max(64, Math.ceil(measured + pad * 2))
  if (backdrop.shape >= 1) {
    const { halfW } = backdropExtent(backdrop, measured, fontSize)
    cssWidth = Math.max(cssWidth, Math.ceil(halfW * 2 + TEXT_CANVAS_SIZE * 0.02))
  }

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

  // Behind everything, including the stroke - the outline should sit on the
  // backdrop, not be hidden by it.
  drawBackdrop(ctx, backdrop, cx, cy, layoutWidth, fontSize, textSeed(entry.text) * 1000)

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
    ctx.shadowColor = color
    ctx.shadowBlur = glow * fontSize * 0.22
    ctx.fillText(entry.text, drawX, cy)
    ctx.shadowBlur = glow * fontSize * 0.07
    ctx.fillText(entry.text, drawX, cy)
    ctx.shadowBlur = 0
  }
  ctx.fillText(entry.text, drawX, cy)

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
    key: 'backdropShape', label: 'Backdrop', type: 'select', default: 0, options: [
      { value: 0, label: 'None' },
      { value: 1, label: 'Pill' },
      { value: 2, label: 'Box' },
      { value: 3, label: 'Blob' },
      { value: 4, label: 'Ellipse' },
      { value: 5, label: 'Tape' },
    ],
  },
  { key: 'backdropColor', label: 'Backdrop Color', type: 'color', default: '#000000' },
  { key: 'backdropPad', label: 'Backdrop Padding', min: 0, max: 1.5, step: 0.05, default: 0.2 },
  { key: 'backdropOpacity', label: 'Backdrop Opacity', min: 0, max: 1, step: 0.05, default: 1 },
  {
    key: 'layoutMode', label: 'Layout', type: 'select', default: 0, options: [
      { value: 0, label: 'Center' },
      { value: 1, label: 'Scatter' },
    ],
  },
  { key: 'phraseGap', label: 'Phrase Gap (beats)', min: 0.5, max: 8, step: 0.5, default: 2, showIf: 'layoutMode' },
  { key: 'scatterSpread', label: 'Scatter Spread', min: 0.1, max: 1, step: 0.05, default: 0.6, showIf: 'layoutMode' },
  { key: 'glow', label: 'Glow', min: 0, max: 1, step: 0.05, default: 0 },
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
    groupRef.current.quaternion
      .copy(_billboardParent)
      .invert()
      .multiply(camera.quaternion)
      .multiply(_billboardParent)

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
    const strokeWidth = p.strokeWidth ?? 0.05
    const textOpacity = p.opacity ?? 1
    const releaseDuration = p.releaseDuration ?? 0.4
    const heightAmount = p.heightAmount ?? 0.35
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
    // Built once per frame and passed down; every word canvas (main, echo,
    // scatter, flight) bakes the same backdrop so they stay consistent.
    const backdrop: Backdrop = {
      shape: Math.round(p.backdropShape ?? 0),
      color: state.stringParams.backdropColor || '#000000',
      opacity: p.backdropOpacity ?? 1,
      pad: p.backdropPad ?? 0.2,
    }
    const jitter = p.jitter ?? 0
    // Hue Shift rotates whatever color is about to draw (authored or rainbow).
    // Quantized to 1/120th turns so an automated lane reuses a bounded set of
    // cached word canvases instead of minting one per sampled float.
    const hueShift = Math.round((((p.hue ?? 0) % 1) + 1) % 1 * 120) / 120
    const shiftHex = (hex: string) =>
      hueShift > 0 ? `#${_hueColor.set(hex).offsetHSL(hueShift, 0, 0).getHexString()}` : hex

    const entries = parseTextEntries(text)
    if (entries.length === 0) { meshRef.current.visible = false; return }

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

    const baseScale = Math.min(viewport.width, viewport.height) * 0.6 * fontSize

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
          const sprKey = `${entry.cacheKey}|${strokeWidth}|${font.css}|${font.weight}|${canvasColor}|${canvasStrokeColor}|${glow}`
          if (sprKey !== spr.key) {
            spr.key = sprKey
            setTextureCanvas(spr.texture, createTextCanvas(entry, strokeWidth, font, canvasColor, canvasStrokeColor, glow, backdrop))
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

          const scale = baseScale * 0.55 * sizeJ * popScale
          spr.mesh.scale.set(scale * texAspect(spr.texture), scale, 1)
          spr.mesh.position.set(
            nx * viewport.width * scatterSpread,
            ny * viewport.height * scatterSpread * 0.8,
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
    const renderKey = `${currentEntry.cacheKey}|${strokeWidth}|${font.css}|${font.weight}|${canvasColor}|${canvasStrokeColor}|${glow}`
    if (renderKey !== lastRenderKeyRef.current) {
      lastRenderKeyRef.current = renderKey
      setTextureCanvas(textureRef.current, createTextCanvas(currentEntry, strokeWidth, font, canvasColor, canvasStrokeColor, glow, backdrop))
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

        const sprEntry = entries[(Math.max(1, wordCountAt(spawnBeat)) - 1) % entries.length] ?? entries[0]
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
        const sprKey = `${sprEntry.cacheKey}|${strokeWidth}|${font.css}|${font.weight}|${sprColor}|${sprStrokeColor}|${glow}`
        if (sprKey !== spr.key) {
          spr.key = sprKey
          setTextureCanvas(spr.texture, createTextCanvas(sprEntry, strokeWidth, font, sprColor, sprStrokeColor, glow, backdrop))
        }
        spr.mesh.position.set(
          vx * ageSec,
          yOffsetAt(spawnBeat) * viewport.height * heightAmount + vy * ageSec,
          -depth,
        )
        spr.mesh.rotation.set(tumbleX * ageSec, tumbleY * ageSec, 0)
        spr.mesh.scale.set(baseScale * texAspect(spr.texture), baseScale, 1)
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
    const scale = baseScale * onsetScale * bassPopScale * jitterSize
    meshRef.current.scale.set(scale * texAspect(textureRef.current), scale, 1)
    meshRef.current.rotation.z = (seededRand(wordIdx * 131 + 7) - 0.5) * 2 * jitter * 0.12
    meshRef.current.position.x = shakeX
    meshRef.current.position.y = currentYOffset * viewport.height * heightAmount + shakeY
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
      const echoKey = `${echoEntry.cacheKey}|${canvasColor}|${canvasStrokeColor}`
      if (echoKey !== echoLastWordsRef.current[tap]) {
        setTextureCanvas(tex, createTextCanvas(echoEntry, strokeWidth, font, canvasColor, canvasStrokeColor, glow, backdrop))
        echoLastWordsRef.current[tap] = echoKey
      }

      const tapScale = baseScale * Math.max(0.1, 1 - delayScaleFalloff * tapNum)
      mesh.scale.set(tapScale * texAspect(tex), tapScale, 1)
      mesh.position.x = pingPongEnabled ? (tapNum % 2 === 1 ? -1 : 1) * pingPongWidth * viewport.width * 0.5 : 0
      mesh.position.y = yOffsetAt(echoNote.beat) * viewport.height * heightAmount
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
