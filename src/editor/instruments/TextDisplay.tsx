import { previewParticleCount } from '../core/visual/liveParticleBudget'
import { midiVelocity } from '../utils/midiVelocity'
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
  SRGBColorSpace,
  SrcAlphaFactor,
  Vector3,
  type Material,
} from 'three'
import { useInstrumentFrame, seededRand, paramAtBeat } from '../core/visual/instrumentFrame'
import {
  PITCH_BASS_POP,
  PITCH_ZOOM_FLASH,
  clipSlotOffset,
  laneIndexForPitch,
  resolveLyricWords,
  resolveStyleLanes,
  singleTextEntry,
  styleLanePitch,
  type TextEntry,
} from '../core/visual/lyricClips'
import { ensureFont } from '../core/visual/fonts'
import {
  MAX_PARTICLES,
  SPHERE_SHAPE,
  createParticleCloud,
  disposeParticleCloud,
  easeInOutQuad,
  updateParticleCloud,
  updateParticleField,
  wordShape,
  type FieldFormation,
  type WordShape,
} from './particleWordCloud'
import { fieldPositions, fieldTimeline, recruitNearest, type TextOnset } from './particleFieldCore'
import { FORCE_TRANSPARENT_KEY, setAnimatedOpacity } from '../core/visual/animatedOpacity'
import { FinalInvertMaskContext } from '../core/visual/finalInvertMask'
import type { ResolvedNote } from '../core/visual/types'
import type { ObjectInstrumentDef, ParamDef } from './types'

// Displays text a word at a time, one word per MIDI note. Since the 2026-08 clips
// redesign the instrument holds NO text: words come from the track's lyric clips
// (core/visual/lyricClips.ts) - a note takes the next unclaimed word of the clip
// its beat falls inside - and the note's PITCH picks a style lane (font / color /
// size / fx), so note height styles the word. The clip also carries a LAYOUT
// (one / row / stack / scatter / grid / circle) that picks the arrangement below.
// Everything (word index, bounce/release/pop ages, echoes, flight sprites) is
// derived per frame from the resolved note list, so scrub == playback.
// Zoom flash: a near-subliminal insert - for ~2 frames the current word renders
// BLOWN UP then snaps back (pitch PITCH_ZOOM_FLASH, kept from the old design).
const ZOOM_FLASH_SECONDS = 0.09
const MAX_DELAY_TAPS = 8
// How far ahead the word-texture prewarm looks (see prewarmAhead in the frame
// callback): the next PREWARM_WORDS words, but only once each is within
// PREWARM_BEATS of the playhead. Two beats covers the common one-word-a-beat
// lyric with a frame or so of slack; further out would just churn the LRU.
const PREWARM_WORDS = 2
const PREWARM_BEATS = 2

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
  // Thick handwritten marker (the beach-lyric look); degrades to Comic Sans
  // so the mood survives a failed font load.
  { css: '"Permanent Marker", "Comic Sans MS", cursive', weight: 400, load: 'Permanent Marker' },
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

// Shared canvas cache keyed by (word, stroke, font, color, strokeColor).
const canvasCache = new Map<string, HTMLCanvasElement>()
const CANVAS_CACHE_MAX = 64

/** Everything a word canvas is drawn from, as the cache key both caches
 *  share. Mirrors createTextCanvas' outline rewrite (a stroke-only glyph forces
 *  a stroke and takes the word's color) so a caller can ask "is this word
 *  already drawn / uploaded?" without drawing it. */
function textureKey(
  entry: TextEntry,
  strokeWidth: number,
  font: FontDef,
  color: string,
  strokeColor: string,
  glow: number,
  glowContained: boolean,
  shadow: number,
  outline: boolean,
): string {
  if (outline) {
    strokeWidth = Math.max(strokeWidth, 0.06)
    strokeColor = color
  }
  return `${entry.cacheKey}|${strokeWidth}|${font.css}|${font.weight}|${color}|${strokeColor}|${glow}|${glowContained}|${shadow}|${outline ? 1 : 0}`
}

function createTextCanvas(
  word: TextEntry | string,
  strokeWidth: number,
  font: FontDef,
  color: string,
  strokeColor: string,
  glow = 0,
  glowContained = false,
  shadow = 0,
  outline = false,
): HTMLCanvasElement {
  const entry = typeof word === 'string' ? singleTextEntry(word) : word
  const key = textureKey(entry, strokeWidth, font, color, strokeColor, glow, glowContained, shadow, outline)
  // Outline (a style-lane fx): the glyph is stroke-only in the word's color -
  // force a visible stroke and skip every fill pass below.
  if (outline) {
    strokeWidth = Math.max(strokeWidth, 0.06)
    strokeColor = color
  }
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
  const padFor = (size: number) => TEXT_CANVAS_SIZE * 0.04 + strokeWidth * size + glow * size * 0.35 + shadow * size * 0.3
  let pad = padFor(fontSize)

  // Multi-word entries (whole-line mode, grouped phrases) WRAP into centered
  // rows instead of one ever-wider strip: a sentence reads as a lyric card
  // and fits a 9:16 frame instead of sailing off both edges. Syllable
  // entries stay single-line by contract (their layout math assumes it).
  const wrapWords = entry.syllableCount === 1 && /\s/.test(entry.text.trim())
    ? entry.text.trim().split(/\s+/)
    : null

  let cssWidth: number
  let lines: { text: string; y: number }[]
  if (wrapWords && wrapWords.length > 1) {
    // As FEW rows as the width cap allows, then balance words across them -
    // "Send this to someone in" should be two even rows, not a ragged
    // four-row tower. rowsWanted comes from the single-line width; the
    // greedy fill targets each row's fair share (with slack) and the guard
    // hands any remainder to the last row.
    const total = ctx.measureText(wrapWords.join(' ')).width
    const spaceW = ctx.measureText(' ').width
    const rowsWanted = Math.max(1, Math.ceil(total / (TEXT_CANVAS_SIZE * 2.4)))
    const targetRow = total / rowsWanted
    const rows: string[] = []
    let line = ''
    let lineW = 0
    for (const word of wrapWords) {
      const wordW = ctx.measureText(word).width
      if (line && rows.length < rowsWanted - 1 && lineW + spaceW + wordW > targetRow * 1.15) {
        rows.push(line)
        line = word
        lineW = wordW
      } else {
        line = line ? `${line} ${word}` : word
        lineW = line === word ? wordW : lineW + spaceW + wordW
      }
    }
    if (line) rows.push(line)
    let lineHeight = fontSize * 1.12
    const maxBlockH = TEXT_CANVAS_SIZE * 0.88
    if (rows.length * lineHeight > maxBlockH) {
      const k = maxBlockH / (rows.length * lineHeight)
      fontSize *= k
      lineHeight *= k
      ctx.font = fontStr(fontSize)
    }
    pad = padFor(fontSize)
    let rowMax = 0
    for (const r of rows) rowMax = Math.max(rowMax, ctx.measureText(r).width)
    cssWidth = Math.max(64, Math.ceil(rowMax + pad * 2))
    const mid = TEXT_CANVAS_SIZE / 2
    lines = rows.map((r, i) => ({ text: r, y: mid - ((rows.length - 1) / 2) * lineHeight + i * lineHeight }))
  } else {
    const maxTextWidth = TEXT_CANVAS_SIZE * MAX_TEXT_ASPECT - pad * 2
    let measured = ctx.measureText(layoutText).width
    if (measured > maxTextWidth && measured > 0) {
      fontSize *= maxTextWidth / measured
      measured = maxTextWidth
    }
    cssWidth = Math.max(64, Math.ceil(measured + pad * 2))
    lines = [{ text: entry.text, y: TEXT_CANVAS_SIZE / 2 }]
  }

  canvas.width = Math.round(cssWidth * dpr)
  canvas.height = TEXT_CANVAS_SIZE * dpr
  ctx.scale(dpr, dpr)
  ctx.font = fontStr(fontSize) // resizing the canvas reset the context

  ctx.textBaseline = 'middle'
  const cx = cssWidth / 2
  const layoutWidth = ctx.measureText(layoutText).width
  const prefixWidth = entry.syllableCount > 1
    ? ctx.measureText(layoutText.slice(0, entry.syllableStart)).width
    : 0
  const drawX = entry.syllableCount > 1
    ? cx - layoutWidth / 2 + prefixWidth
    : cx
  ctx.textAlign = entry.syllableCount > 1 ? 'left' : 'center'
  /** Every paint pass goes through here so wrapped rows and single words
   *  share the stroke/glow/shadow pipeline unchanged. */
  const drawAll = (target: CanvasRenderingContext2D, mode: 'fill' | 'stroke') => {
    for (const l of lines) {
      if (mode === 'fill') target.fillText(l.text, drawX, l.y)
      else target.strokeText(l.text, drawX, l.y)
    }
  }

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
    drawAll(ctx, 'stroke')
  }
  ctx.fillStyle = color
  if (glow > 0 && !outline) {
    // Projected-light bloom: a wide soft halo, then a tight inner glow, in the
    // text's own color. The plain fill after clears the shadow and lays the
    // bright core on top.
    const paintGlow = (target: CanvasRenderingContext2D) => {
      target.fillStyle = color
      target.shadowColor = color
      target.shadowBlur = glow * fontSize * 0.22
      drawAll(target, 'fill')
      target.shadowBlur = glow * fontSize * 0.07
      drawAll(target, 'fill')
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
        drawAll(mc, 'stroke')
      }
      drawAll(mc, 'fill')

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
  if (shadow > 0 && !outline) {
    ctx.shadowColor = 'rgba(0,0,0,0.85)'
    ctx.shadowBlur = shadow * fontSize * 0.18
    ctx.shadowOffsetY = shadow * fontSize * 0.07
  }
  if (!outline) drawAll(ctx, 'fill')
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

// GPU-side twin of canvasCache: ONE CanvasTexture per drawn word canvas, shared
// by every mesh of every Text Display mount (main word, echo taps, flight and
// scatter sprites, splitter copies). A mesh takes a word by pointing its
// material.map at the cached texture - never by re-uploading the canvas into a
// texture of its own - so a word that has been shown (or prewarmed, below)
// costs a pointer swap on the beat instead of a multi-MB upload. Before this,
// each mesh owned a texture and re-uploaded whenever its word changed: eight
// echo taps meant eight uploads of the same canvas, and flight mode's sprite
// pool re-uploaded on every acquisition. LRU by lookup (a lookup per frame per
// mesh in use keeps live words at the fresh end); an evicted texture that is
// still on some mesh's material simply re-uploads if it is drawn again - three
// re-initialises a disposed texture on next use - so eviction is a cost, not
// a bug. Sized for main + next + eight taps + a flight trail's distinct words.
//
// GPU memory: a word texture is TEXT_CANVAS_SIZE*dpr tall and as wide as the
// word (a five-letter word is ~1080 css px, i.e. ~4.4 MB at dpr 1 and ~17 MB
// at dpr 2), so a full cache is not something to leave resident for a whole
// song. Entries idle for TEXTURE_IDLE_TICKS frame callbacks are DISPOSED but
// KEPT (`pruned`): the CanvasTexture object is cheap and its canvas is still
// in canvasCache, and three re-uploads a disposed texture on its next use, so a
// pruned word that comes back (a chorus) costs one upload - which the prewarm
// pays a beat early, since it treats pruned as cold. Steady state is therefore
// the words on screen plus the next couple, not the last sixteen.
//
// TWO textures per canvas can exist, and that is deliberate: the main word
// mesh's texture was assigned through JSX, and r3f stamps SRGBColorSpace on any
// texture it assigns to a color map, while the echo / flight / scatter meshes
// created theirs imperatively and got NoColorSpace - so a coloured word has
// always drawn darker (sRGB-decoded) on the main mesh than the same word on an
// echo tap or a stack card. Preserving that byte-for-byte means the cache is
// keyed on the colour space too (`srgb`); collapsing it to one would recolour
// every stack/scatter/echo word in every existing project.
const textureCache = new Map<string, CanvasTexture>()
const TEXTURE_CACHE_MAX = 16
const textureCacheKey = (srgb: boolean, key: string) => (srgb ? 'S|' : 'N|') + key
const TEXTURE_IDLE_TICKS = 180
/** Advances once per frame callback (any mount); `userData.lastTouch` on each
 *  cached texture is compared against it. Not time - a callback count. */
let textureTick = 0
/** Bumped on every canvas upload this module causes (a fresh texture, or a
 *  pruned one touched again) - the frame callback reads it to keep to ONE
 *  draw + upload per frame (a cold current word has already spent it). */
let textureUploads = 0

/** The cached texture for this word + styling, drawing and creating it on a
 *  miss. Touches the LRU on every call, so call it per frame per mesh in use. */
function wordTexture(
  srgb: boolean,
  entry: TextEntry,
  strokeWidth: number,
  font: FontDef,
  color: string,
  strokeColor: string,
  glow: number,
  glowContained: boolean,
  shadow: number,
  outline: boolean,
): CanvasTexture {
  const key = textureCacheKey(srgb, textureKey(entry, strokeWidth, font, color, strokeColor, glow, glowContained, shadow, outline))
  const hit = textureCache.get(key)
  if (hit) {
    // Re-insert = move to the fresh end (Map iterates in insertion order).
    textureCache.delete(key)
    textureCache.set(key, hit)
    hit.userData.lastTouch = textureTick
    if (hit.userData.pruned) {
      // Its GPU storage was released; the next draw re-uploads the canvas.
      hit.userData.pruned = false
      textureUploads++
    }
    return hit
  }
  const tex = new CanvasTexture(createTextCanvas(entry, strokeWidth, font, color, strokeColor, glow, glowContained, shadow, outline))
  tex.minFilter = LinearFilter
  tex.magFilter = LinearFilter
  if (srgb) tex.colorSpace = SRGBColorSpace
  tex.userData.lastTouch = textureTick
  tex.userData.pruned = false
  // `resident` = this module pushed it to the GPU (gl.initTexture). A draw
  // uploads too, invisibly to us, so a redundant initTexture is possible and
  // harmless: three sees the version already uploaded and does nothing.
  tex.userData.resident = false
  textureUploads++
  if (textureCache.size >= TEXTURE_CACHE_MAX) {
    const oldest = textureCache.keys().next().value
    if (oldest !== undefined) {
      textureCache.get(oldest)?.dispose()
      textureCache.delete(oldest)
    }
  }
  textureCache.set(key, tex)
  return tex
}

/** Release the GPU storage of cache entries nobody has looked up for a while
 *  (see the cache comment). Called once per frame callback; O(cache size). */
function pruneIdleTextures() {
  for (const tex of textureCache.values()) {
    if (tex.userData.pruned || textureTick - (tex.userData.lastTouch as number) <= TEXTURE_IDLE_TICKS) continue
    tex.dispose()
    tex.userData.pruned = true
    tex.userData.resident = false
  }
}

/** The blank-word texture every mesh starts on (and shows when it has no
 *  word): a real cache entry, so it is created lazily on the client and shared. */
const blankTexture = (srgb: boolean) => wordTexture(srgb, singleTextEntry(''), 0.05, fontStack(0), '#ffffff', '#000000', 0, false, 0, false)

// Flight sprites are pooled: one mesh reused across subdiv indices; `texture`
// is whichever cached word texture the sprite currently wears.
interface FlightPooled {
  mesh: Mesh
  texture: CanvasTexture
  mat: MeshBasicMaterial
  active: boolean
}

const MAX_FLIGHT_SPRITES = 128
const MAX_SCATTER_WORDS = 16

const PARAMS: ParamDef[] = [
  // Words, fonts and layout live OUTSIDE the instrument since the clips
  // redesign: lyric clips own the text + arrangement, style lanes own the
  // look (core/visual/lyricClips.ts). Scatter Spread survives as the one
  // scatter-layout knob.
  { key: 'scatterSpread', label: 'Scatter Spread', min: 0.1, max: 1, step: 0.05, default: 0.6 },
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
  { key: 'strokeColor', label: 'Stroke Color', type: 'color', default: '#000000' },
  { key: 'fontSize', label: 'Font Size', min: 0.1, max: 5, step: 0.1, default: 1 },
  { key: 'strokeWidth', label: 'Stroke Width', min: 0, max: 0.2, step: 0.01, default: 0.05 },
  // Soft black drop shadow under the glyphs - the short-form caption look
  // (white bold words floating over footage), where a stroke reads too hard.
  { key: 'shadow', label: 'Shadow', min: 0, max: 1, step: 0.05, default: 0 },
  { key: 'opacity', label: 'Opacity', min: 0, max: 1, step: 0.05, default: 1 },
  // Words never fade on their own: each stays up until the next one replaces
  // it (Release Fade only applies to the very end of the block). The classic
  // lyric-video hold.
  { key: 'sustain', label: 'Hold Until Next Word', type: 'boolean', default: 0 },
  { key: 'releaseDuration', label: 'Release Fade', min: 0, max: 2, step: 0.05, default: 0.4, showIf: 'sustain=0' },
  { key: 'onsetBounce', label: 'Onset Bounce', min: 0, max: 0.5, step: 0.01, default: 0.08 },
  // How far the pitch-46 Zoom flash blows the word up for its ~2 frames. 3
  // keeps the word readable on screen; the reference's ~6.5 is pure fragments.
  { key: 'zoomFlash', label: 'Zoom Flash Scale', min: 1.5, max: 8, step: 0.1, default: 3 },
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
  // Field Mode: instead of the whole cloud BEING the word, a screen-filling
  // slab of ambient particles sits still and only the ones nearest the anchor
  // condense into each word (then fly back to the exact homes they left).
  { key: 'particleField', label: 'Field Mode (ambient screen)', type: 'boolean', default: 0, showIf: 'particleEnabled' },
  { key: 'fieldDepth', label: 'Field Depth', min: 0, max: 3, step: 0.1, default: 1.2, showIf: 'particleField' },
  { key: 'fieldDrift', label: 'Field Drift', min: 0, max: 1, step: 0.05, default: 0.25, showIf: 'particleField' },
  { key: 'fieldDensity', label: 'Text Density', min: 500, max: 20000, step: 250, default: 4000, showIf: 'particleField' },
]
const _hueColor = new Color()

function TextDisplayVisual({ trackId }: { trackId: string }) {
  const renderingFinalInvertMask = useContext(FinalInvertMaskContext)
  const groupRef = useRef<Group>(null)
  const meshRef = useRef<Mesh>(null)
  // The blank cache texture the main material mounts with (so `map` is set
  // from the first program compile); words are swapped in per frame.
  const textureRef = useRef<CanvasTexture | null>(null)

  // Delay echoes - one pre-created mesh per tap slot.
  const echoMeshesRef = useRef<Mesh[]>([])

  // Flight mode mesh pool.
  const flightPoolRef = useRef<FlightPooled[]>([])

  // Scatter layout mesh pool - one mesh per visible phrase word.
  const scatterPoolRef = useRef<FlightPooled[]>([])

  // Particle-words mode: one shared cloud that morphs between word formations.
  // The anchor group carries placement + size.
  const particleAnchorRef = useRef<Group>(null)
  const particleCloud = useMemo(() => createParticleCloud(), [])
  useEffect(() => () => disposeParticleCloud(particleCloud), [particleCloud])

  // Field mode's memoized pure pieces: the ambient slab and a handful of
  // recruitment maps (a sort over the field per word - cheap, but not free).
  const fieldAmbientRef = useRef<{ key: string; positions: Float32Array } | null>(null)
  const fieldRecruitsRef = useRef<Array<{ key: string; map: Uint32Array }>>([])

  const { viewport, camera, gl } = useThree()
  const [ready, setReady] = useState(false)

  useEffect(() => {
    // Word textures live in the module cache and are never disposed per
    // mount - only this mount's meshes, materials and geometries are.
    textureRef.current = blankTexture(true)

    const meshes: Mesh[] = []
    for (let i = 0; i < MAX_DELAY_TAPS; i++) {
      const mat = new MeshBasicMaterial({ map: blankTexture(false), transparent: true, alphaTest: TEXT_ALPHA_TEST, depthWrite: false, opacity: 0 })
      configureTextMaterial(mat, false)
      const mesh = new Mesh(new PlaneGeometry(1, 1), mat)
      mesh.visible = false
      meshes.push(mesh)
    }
    echoMeshesRef.current = meshes

    setReady(true)
    return () => {
      for (const m of meshes) { (m.material as Material).dispose(); m.geometry.dispose() }
      for (const spr of flightPoolRef.current) {
        spr.mat.dispose()
        spr.mesh.geometry.dispose()
      }
      flightPoolRef.current = []
      for (const spr of scatterPoolRef.current) {
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
    const texture = blankTexture(false)
    const mat = new MeshBasicMaterial({ map: texture, transparent: true, alphaTest: TEXT_ALPHA_TEST, opacity: 1, side: DoubleSide, depthWrite: false, toneMapped: false })
    configureTextMaterial(mat, false)
    const mesh = new Mesh(new PlaneGeometry(1, 1), mat)
    group.add(mesh)
    const entry: FlightPooled = { mesh, texture, mat, active: true }
    pool.push(entry)
    return entry
  }
  const acquireFlightSprite = (group: Group) => acquirePooled(flightPoolRef.current, group)
  /** Point a pooled sprite at a cached word texture (a pointer swap: `map`
   *  stays non-null, so no program change and no upload). */
  const wearTexture = (spr: FlightPooled, tex: CanvasTexture) => {
    if (spr.mat.map !== tex) spr.mat.map = tex
    spr.texture = tex
  }

  useInstrumentFrame(trackId, (state) => {
    if (!textureRef.current || !meshRef.current || !groupRef.current) return false
    // One canvas draw + GPU upload per frame at most: the prewarm below stands
    // down on any frame that already minted a texture (a cold word on scrub).
    textureTick++
    const uploadsAtStart = textureUploads

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
    // Style lanes: pitch picks the lane, the lane owns font/color/size/fx.
    const lanes = resolveStyleLanes(state.styleLanes)
    const laneCount = lanes.length
    // A template face that hasn't finished loading yet: retry next frame
    // rather than baking fallback-family canvases into the cache.
    for (const lane of lanes) {
      const f = fontStack(lane.font)
      if (f.load && !ensureFont(f.load)) return false
    }
    // The track's word notes (style-lane band) and their clip resolution: the
    // FULL stream, future included, so layouts can reserve seats (lyric[i]
    // aligns with allWordNotes[i]).
    const allWordNotes = state.notes.filter((n) => laneIndexForPitch(n.pitch, laneCount) >= 0)
    const lyric = resolveLyricWords(allWordNotes, state.lyricClips, laneCount)
    const laneAt = (i: number) => lanes[lyric[i]?.laneIndex ?? 0] ?? lanes[0]
    const entryAt = (i: number): TextEntry | null => lyric[i]?.entry ?? null
    const fontAt = (i: number) => fontStack(laneAt(i).font)
    const outlineAt = (i: number) => laneAt(i).fx?.includes('outline') ?? false
    const laneShakeAt = (i: number) => laneAt(i).fx?.includes('shake') ?? false
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
    // Hold Until Next Word: a word never releases on its own - it stays at
    // full opacity until the next word note replaces it. There is always a
    // current word once one has sounded, so "no release" is the whole
    // implementation; block gating still ends everything with the block.
    const sustainWords = (p.sustain ?? 0) >= 0.5
    // The 60-72 height band retired with the clips redesign (those pitches are
    // style lanes now); kept as constants so the placement math reads unchanged.
    const heightAmount = 0
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
    const zoomFlashScale = p.zoomFlash ?? 3
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
    // Word i's size: the track size at beat b times its lane's multiplier.
    const sizeForWord = (i: number, b: number) => sizeAt(b) * laneAt(i).size

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
      /** The word's lane color (authored; rainbow/invert still win above). */
      baseColor?: string
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
      const count = previewParticleCount(Math.max(1, Math.min(MAX_PARTICLES, Math.round(p.particleCount ?? 6000))))
      const areaFrom = prevShape.fill * scaleFrom * scaleFrom
      const areaTo = curShape.fill * scaleTo * scaleTo
      const stackComp = Math.min(6, Math.max(0.15, (areaFrom + (areaTo - areaFrom) * eased) / count))
      const cloudSubdiv = Math.floor(state.beat * flightSubdivRate)
      const cloudHue = rainbowEnabled ? ((cloudSubdiv % rainbowCycleLength) / rainbowCycleLength) * 360 : 0
      // Invert mode renders plain white - the invert blending trick is
      // canvas-plane-only, and white additive points read closest to it.
      const cloudColor = invertBehind ? '#ffffff' : shiftHex(rainbowEnabled ? hslToHex(cloudHue, 1, 0.55) : (word?.baseColor ?? '#ffffff'))
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
    const fieldMode = particleMode && (p.particleField ?? 0) >= 0.5

    // --- Field mode ---
    // The cloud's sibling behavior: a screen-filling slab of ambient particles
    // that never reacts - except the ones nearest the anchor, which condense
    // into the current word and later fly back to the exact homes they left.
    // Shares the text pipeline's font/color/size/placement latching and the
    // particle params; only the field itself (depth, drift, density) is new.
    // NOTE: called from the two early-exit blocks below with no words - every
    // later-declared closure it touches (yOffsetAt) is gated behind a real
    // formation, so those calls only ever draw the plain field.
    const driveField = (wordNotes: ResolvedNote[]) => {
      const anchor = particleAnchorRef.current
      if (!anchor) return
      // The slab lives in viewport space: the anchor carries no per-word
      // placement here (each formation latches its own).
      anchor.visible = true
      anchor.scale.setScalar(1)
      anchor.position.set(0, 0, 0)

      const count = previewParticleCount(Math.max(1, Math.min(MAX_PARTICLES, Math.round(p.particleCount ?? 6000))))
      const depth = p.fieldDepth ?? 1.2
      const drift = p.fieldDrift ?? 0.25
      const density = Math.round(p.fieldDensity ?? 4000)
      const formBeats = Math.max(0.05, p.particleMorphBeats ?? 2)
      // Release Duration is SECONDS everywhere else in this instrument.
      const releaseBeats = Math.max(0.05, releaseDuration / state.secPerBeat)
      // A little over the viewport so the slab's edges never show.
      const W = viewport.width * 1.06
      const H = viewport.height * 1.06
      const ambientKey = `${count}|${W.toFixed(3)}|${H.toFixed(3)}|${depth}`
      if (fieldAmbientRef.current?.key !== ambientKey) {
        fieldAmbientRef.current = { key: ambientKey, positions: fieldPositions(count, W, H, depth) }
      }
      const ambient = fieldAmbientRef.current.positions

      const onsets: TextOnset[] = wordNotes.map((n) => ({ beat: n.beat, endBeat: n.beat + n.durationBeats }))
      const tl = fieldTimeline(onsets, state.beat, formBeats, releaseBeats, sustainWords)

      const K = Math.min(density, count)
      const formationFor = (onsetIndex: number, progress: number, release: number): FieldFormation | null => {
        if (onsetIndex < 0) return null
        const word = entryAt(onsetIndex)
        if (!word) return null
        const shape = wordShape(word.text, fontAt(onsetIndex))
        if (!shape) return null
        // Anchor, size and height offset latch at the word's own onset, like
        // the cloud path's per-word latching.
        const onsetBeat = onsets[onsetIndex].beat
        const anchorX = placeX(onsetBeat)
        const anchorY = placeY(onsetBeat) + yOffsetAt(onsetBeat) * viewport.height * heightAmount
        const scale = sizeAt(onsetBeat) * 0.22
        const key = `${word.text}|${fontAt(onsetIndex).css}|${K}|${anchorX.toFixed(2)}|${anchorY.toFixed(2)}|${scale.toFixed(3)}|${ambientKey}`
        let cached = fieldRecruitsRef.current.find((c) => c.key === key)
        if (!cached) {
          cached = { key, map: recruitNearest(ambient, count, K, anchorX, anchorY) }
          fieldRecruitsRef.current.push(cached)
          if (fieldRecruitsRef.current.length > 6) fieldRecruitsRef.current.shift()
        }
        return { shape, map: cached.map, anchorX, anchorY, scale, progress, release, seed: (onsetIndex + 1) * 131.3 }
      }

      // Same color voice as the cloud path (rainbow / hue / invert-as-white).
      const fieldSubdiv = Math.floor(state.beat * flightSubdivRate)
      const fieldHue = rainbowEnabled ? ((fieldSubdiv % rainbowCycleLength) / rainbowCycleLength) * 360 : 0
      const fieldColor = invertBehind ? '#ffffff' : shiftHex(rainbowEnabled ? hslToHex(fieldHue, 1, 0.55) : laneAt(Math.max(0, tl.curIndex)).color)

      updateParticleField(particleCloud, {
        beat: state.beat,
        count,
        dotSize: p.particleSize ?? 0.025,
        glow: p.particleGlow ?? 0.3,
        opaque: (p.particleOpaque ?? 0) >= 0.5,
        color: fieldColor,
        variation: p.particleVariation ?? 0.5,
        stagger: p.particleStagger ?? 0.4,
        drift,
        driftScale: Math.min(viewport.width, viewport.height),
        ambient,
        cur: formationFor(tl.curIndex, tl.curProgress, tl.curRelease),
        prev: formationFor(tl.prevIndex, 1, tl.prevRelease),
      })
      setAnimatedOpacity(particleCloud.points.material as Material, textOpacity)
    }

    if (!state.lyricClips?.some((c) => c.words.length > 0)) {
      meshRef.current.visible = false
      if (particleMode) {
        if (fieldMode) driveField([]) // the field is furniture - no words needed
        else driveCloud(null) // no clips with words yet: idle sphere
      }
      return
    }

    const currentBeat = state.beat
    const secPerBeat = state.secPerBeat

    // --- Note derivation (pure) ---
    // Every visual below is a function of the beat and the resolved note list: the
    // word index is the count of past word-note onsets (any style-lane pitch),
    // and every age (bounce, release fade, bass pop, sprite flight) is measured
    // from a note's beat. nextWordNotes is the SUNG prefix of allWordNotes, so
    // index i in either aligns with lyric[i].
    const nextWordNotes: ResolvedNote[] = []
    let lastBassNote: ResolvedNote | null = null
    let lastZoomNote: ResolvedNote | null = null
    let lastWordEndBeat = -1
    for (const n of allWordNotes) {
      if (n.beat > currentBeat) break // notes are sorted by beat
      nextWordNotes.push(n)
      lastWordEndBeat = Math.max(lastWordEndBeat, n.beat + n.durationBeats)
    }
    for (const n of state.notes) {
      if (n.beat > currentBeat) break
      if (n.pitch === PITCH_BASS_POP) lastBassNote = n
      else if (n.pitch === PITCH_ZOOM_FLASH) lastZoomNote = n
    }

    // Rainbow hue cycles on beat subdivisions. Track-level Rainbow paints every
    // word; a lane's 'rainbow' fx paints just that lane's words.
    const rainbowSubdiv = Math.floor(currentBeat * flightSubdivRate)
    const rainbowHue = ((rainbowSubdiv % rainbowCycleLength) / rainbowCycleLength) * 360
    const rainbowOn = (i: number) => rainbowEnabled || (laneAt(i).fx?.includes('rainbow') ?? false)
    const colorAt = (i: number) => shiftHex(rainbowOn(i) ? hslToHex(rainbowHue, 1, 0.55) : laneAt(i).color)
    const canvasColorAt = (i: number) => (invertBehind ? '#ffffff' : colorAt(i))
    const canvasStrokeColor = invertBehind ? '#ffffff' : strokeColor
    /** Word i's texture in this frame's styling (the one call site for the
     *  argument order, so every mesh and the prewarm agree on the key). */
    const wordTextureAt = (srgb: boolean, i: number, entry: TextEntry) =>
      wordTexture(srgb, entry, strokeWidth, fontAt(i), canvasColorAt(i), canvasStrokeColor, glow, glowContained, shadow, outlineAt(i))

    // Prewarm: draw + upload the NEXT word(s) while the current one shows, so
    // the swap on the beat is a pointer swap into an already-resident texture.
    // Spread over frames (one draw+upload per frame, and none on a frame that
    // already minted the current word), a couple of beats ahead at most so
    // the LRU is never churned by a distant future. Pure optimization: which
    // texture a frame SHOWS is decided by its key alone, so the output at any
    // beat is identical warmed or cold - a scrub onto a cold word just pays
    // the upload on that frame, exactly as before. Predicted with THIS frame's
    // styling: a hue lane or rainbow that moves before the word lands makes
    // the prediction miss, and the miss costs nothing but the warm-up.
    // Which cache variant a word will be drawn from: the main mesh (Center
    // layout, its texture stamped sRGB by r3f) or a pooled sprite (every other
    // layout, NoColorSpace) - see the cache comment.
    const srgbForWord = (i: number) => (lyric[i]?.layout ?? { kind: 'one' as const }).kind === 'one'
    const prewarmAhead = (fromIdx: number) => {
      pruneIdleTextures()
      if (textureUploads !== uploadsAtStart) return
      for (let k = 1; k <= PREWARM_WORDS; k++) {
        const i = fromIdx + k
        const note: ResolvedNote | undefined = allWordNotes[i]
        if (!note || note.beat - currentBeat > PREWARM_BEATS) return
        const entry = entryAt(i)
        if (!entry) continue
        const srgb = srgbForWord(i)
        const key = textureCacheKey(srgb, textureKey(entry, strokeWidth, fontAt(i), canvasColorAt(i), canvasStrokeColor, glow, glowContained, shadow, outlineAt(i)))
        if (textureCache.get(key)?.userData.resident) continue
        // Draw into the cache (if cold) and push it to the GPU now, off the
        // beat. A stack card's future words are looked up (drawn) before they
        // are sung but never drawn to the screen until then, so "in the cache"
        // is not "on the GPU" - hence the resident flag rather than a has().
        const tex = wordTextureAt(srgb, i, entry)
        gl.initTexture(tex)
        tex.userData.resident = true
        if (textureUploads === uploadsAtStart) textureUploads++
        return
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
      if (!particleMode) prewarmAhead(-1) // the first word lands warm too
      if (particleMode && fieldMode) {
        driveField([]) // no words sounded yet: just the ambient slab
      } else if (particleMode) {
        // Anticipate the FIRST word: the sphere starts morphing into it early
        // enough to land fully formed exactly on its note.
        const firstNote: ResolvedNote | undefined = allWordNotes[0]
        const duration = Math.max(0.05, p.particleMorphBeats ?? 2)
        const morphStart = firstNote ? firstNote.beat - duration : Infinity
        if (!firstNote || currentBeat < morphStart) {
          driveCloud(null) // idle sphere
        } else {
          driveCloud({
            prev: SPHERE_SHAPE,
            cur: (entryAt(0) ? wordShape(entryAt(0)!.text, fontAt(0)) : null) ?? SPHERE_SHAPE,
            progress: Math.min(1, (currentBeat - morphStart) / duration),
            morphSeed: 61.7,
            pulseEnv: 0,
            // From the live placement where the idle sphere sat when the morph
            // began, to the first word's own latched placement.
            fromBeat: morphStart,
            toBeat: firstNote.beat,
            yOffset: 0,
            baseColor: laneAt(0).color,
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

    // The height band retired with the clips redesign; every placement site
    // reads zero through these so the geometry math stays byte-identical.
    const yOffsetAt = (_b: number) => 0

    const wordCount = nextWordNotes.length
    const lastWordNote = wordCount > 0 ? nextWordNotes[wordCount - 1] : null
    const wordIdx = Math.max(1, wordCount) - 1
    // A starved note (clip ran out / no clip under it) sings nothing: an empty
    // entry bakes an empty canvas, so the frame math runs and draws blank.
    const currentEntry = entryAt(wordIdx) ?? singleTextEntry('')
    const isNoteHeld = currentBeat < lastWordEndBeat
    const currentYOffset = yOffsetAt(currentBeat)
    // The clip owning the CURRENT word picks the arrangement below.
    const currentLayout = lyric[wordIdx]?.layout ?? { kind: 'one' as const }
    const currentClipIndex = lyric[wordIdx]?.clipIndex ?? -1
    const scatterMode = currentLayout.kind === 'scatter'
    const stackMode = currentLayout.kind === 'stack' || currentLayout.kind === 'row'
    const seatsMode = (currentLayout.kind === 'grid' || currentLayout.kind === 'circle') && currentClipIndex >= 0

    // --- Particle words: the cloud replaces every plane-based word visual ---
    if (particleMode) {
      meshRef.current.visible = false
      setAnimatedOpacity(meshRef.current.material as MeshBasicMaterial, 0)
      for (const mesh of echoMeshesRef.current) mesh.visible = false
      for (const spr of flightPoolRef.current) { spr.active = false; spr.mesh.visible = false }
      for (const spr of scatterPoolRef.current) { spr.active = false; spr.mesh.visible = false }

      if (fieldMode) {
        driveField(nextWordNotes)
        return
      }

      const curIdx = wordCount - 1 // note index of the word on screen
      const curNote = nextWordNotes[curIdx]
      // Morph endpoints: sphere → word 1 → word 2 → ... A word that rasterizes
      // to nothing falls back to the sphere.
      const shapeFor = (i: number) => (i < 0
        ? SPHERE_SHAPE
        : (entryAt(i) ? wordShape(entryAt(i)!.text, fontAt(i)) : null) ?? SPHERE_SHAPE)

      // Anticipatory morphing: the transition into a word plays out in the gap
      // BEFORE its note and lands exactly ON the beat, rather than starting at
      // the note and arriving late. Duration = min(Morph beats, the gap): with
      // room to spare the word holds, then departs just in time; with none the
      // whole gap IS the morph. Morph Fills Gap skips the cap entirely - every
      // transition spans the full distance between its two notes, so the cloud
      // is always in motion at whatever speed the lyric is moving.
      let nextNote: ResolvedNote | undefined
      for (const n of allWordNotes) {
        if (n.beat > currentBeat) { nextNote = n; break }
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
          const velocity = midiVelocity(lastBassNote.velocity)
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
          baseColor: laneAt(curIdx + 1).color,
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
          baseColor: laneAt(curIdx).color,
        })
      }
      return
    }

    const invertInThisPass = invertBehind && !renderingFinalInvertMask
    configureTextMaterial(meshRef.current.material as MeshBasicMaterial, invertInThisPass)
    for (const mesh of echoMeshesRef.current) configureTextMaterial(mesh.material as MeshBasicMaterial, invertInThisPass)
    for (const spr of flightPoolRef.current) configureTextMaterial(spr.mat, invertInThisPass)

    // --- Seat layouts (grid / circle) ---
    // The current clip's layout places words by SLOT (clipSlotOffset), so every
    // word's seat is reserved before it is sung and nothing re-flows as words
    // land - the same contract Stack has always kept. Only THIS clip's words
    // are on screen; the previous clip's card cleared when the clip changed.
    if (seatsMode) {
      meshRef.current.visible = false
      setAnimatedOpacity(meshRef.current.material as MeshBasicMaterial, 0)
      for (const mesh of echoMeshesRef.current) mesh.visible = false
      for (const spr of flightPoolRef.current) { spr.active = false; spr.mesh.visible = false }
      for (const spr of scatterPoolRef.current) { spr.active = false; spr.mesh.visible = false }

      let releaseOpacity = 1
      if (!sustainWords && !isNoteHeld && lastWordNote) {
        const releaseAge = (currentBeat - lastWordEndBeat) * secPerBeat
        releaseOpacity = releaseDuration > 0 ? Math.max(0, 1 - releaseAge / releaseDuration) : 0
      }
      const onsetAge = lastWordNote ? (currentBeat - lastWordNote.beat) * secPerBeat : 1
      const bassPopAge = lastBassNote ? (currentBeat - lastBassNote.beat) * secPerBeat : 1
      const bassPopDecay = Math.max(0, 1 - bassPopAge / 0.25)
      const bassPopScale = 1 + 0.25 * bassPopDecay * bassPopDecay

      const total = Math.max(1, lyric[wordIdx]?.totalSlots ?? 1)
      const cols = Math.max(1, Math.round(currentLayout.cols ?? 2))
      // Lattice unit → world units. Grid cells split the frame width; the
      // circle's radius fits the shorter axis. Screen-relative for the same
      // reason posX/posY are: it means the same thing at any aspect and
      // survives an export at another resolution.
      const unitX = currentLayout.kind === 'grid'
        ? viewport.width * 0.84 / cols
        : viewport.width * 0.32
      const unitY = currentLayout.kind === 'grid'
        ? Math.min(viewport.height * 0.26, unitX * 0.6)
        : viewport.height * 0.36

      if (releaseOpacity > 0) {
        for (let i = 0; i < wordCount; i++) {
          if (lyric[i]?.clipIndex !== currentClipIndex) continue
          const entry = entryAt(i)
          if (!entry) continue
          const seat = clipSlotOffset(currentLayout, lyric[i].slotIndex, total)
          if (!seat) continue
          const spr = acquirePooled(scatterPoolRef.current, groupRef.current)
          configureTextMaterial(spr.mat, invertInThisPass)
          wearTexture(spr, wordTextureAt(false, i, entry))
          const newest = i === wordCount - 1
          const wordBeat = nextWordNotes[i]?.beat ?? currentBeat
          const onsetT = newest ? Math.min(onsetAge / 0.12, 1) : 1
          const popScale = (1 + onsetBounce * 2 * (1 - onsetT)) * (newest ? bassPopScale : 1)
          // Long words shrink rather than run into the next seat - the same
          // trade the word canvas already makes when it widens.
          const lengthFit = Math.min(1, 5 / Math.max(1, entry.text.length))
          const fontScale = perWordSize ? paramAtBeat(state, 'fontSize', wordBeat) : fontSize
          const scale = Math.min(viewport.width, viewport.height) * 0.11
            * lengthFit * fontScale * laneAt(i).size * popScale
          const shakeOff = laneShakeAt(i)
            ? (seededRand(Math.floor(currentBeat * 30) * 3 + i * 77) - 0.5) * 0.015 * viewport.width
            : 0
          spr.mesh.scale.set(scale * texAspect(spr.texture), scale, 1)
          spr.mesh.position.set(
            seat.x * unitX + placeX(wordBeat) + shakeOff,
            seat.y * unitY + placeY(wordBeat),
            seat.z * unitX,
          )
          spr.mesh.rotation.set(0, 0, 0)
          setAnimatedOpacity(spr.mat, releaseOpacity * textOpacity)
        }
      }
      prewarmAhead(wordIdx)
      return
    }
    // --- Scatter layout ---
    // The phrase accumulates as a loose collage: each word lands at a seeded
    // scattered anchor (position, tilt, size all keyed to its word index, so a
    // scrub reproduces the exact arrangement), earlier phrase words stay dimmed,
    // and the CLIP is the phrase cutter - a new clip hard-clears the canvas.
    // Echo taps and flight mode are Center-layout features and stay dormant here.
    if (scatterMode) {
      meshRef.current.visible = false
      setAnimatedOpacity(meshRef.current.material as MeshBasicMaterial, 0)
      for (const mesh of echoMeshesRef.current) mesh.visible = false
      for (const spr of flightPoolRef.current) { spr.active = false; spr.mesh.visible = false }

      // Phrase = the current CLIP's sung words (the clip is the phrase cutter).
      let phraseStart = 0
      for (let k = 0; k < wordCount; k++) {
        if (lyric[k]?.clipIndex === currentClipIndex) { phraseStart = k; break }
      }
      phraseStart = Math.max(phraseStart, wordCount - MAX_SCATTER_WORDS)

      let releaseOpacity = 1
      if (!sustainWords && !isNoteHeld && lastWordNote) {
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
          if (lyric[i]?.clipIndex !== currentClipIndex) continue
          const entry = entryAt(i)
          if (!entry) continue
          const spr = acquirePooled(scatterPoolRef.current, groupRef.current)
          configureTextMaterial(spr.mat, invertInThisPass)
          wearTexture(spr, wordTextureAt(false, i, entry))

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
          const scale = sizeForWord(i, scatterBeat) * 0.55 * sizeJ * popScale
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
      prewarmAhead(wordIdx)
      return
    }

    // --- Stack layout ---
    // Words land on centered, stacked CARDS - one card per lyric CLIP (row
    // layout is the single-line variant). The layout is computed over the
    // WHOLE card - future words
    // included, straight from the note list - so every word's place is
    // reserved before it is sung: words never re-flow to make room, each one
    // just takes its spot ("WHO" appears where it will sit once "YOU" and
    // "FOOLIN'?" have joined it). Pure function of (beat, notes): scrub ==
    // playback. Echo taps and flight stay dormant, exactly like Scatter.
    if (stackMode) {
      meshRef.current.visible = false
      setAnimatedOpacity(meshRef.current.material as MeshBasicMaterial, 0)
      for (const mesh of echoMeshesRef.current) mesh.visible = false
      for (const spr of flightPoolRef.current) { spr.active = false; spr.mesh.visible = false }

      // The card IS the current clip: every note bound to it (future included,
      // straight from the resolution) reserves its place before it is sung.
      let cardStart = -1
      let cardEnd = 0 // exclusive
      for (let i = 0; i < allWordNotes.length; i++) {
        if (lyric[i]?.clipIndex === currentClipIndex && lyric[i]?.entry) {
          if (cardStart < 0) cardStart = i
          cardEnd = i + 1
        }
      }
      if (cardStart < 0) { cardStart = 0; cardEnd = 0 }
      const singleLine = currentLayout.kind === 'row'

      let releaseOpacity = 1
      if (!sustainWords && !isNoteHeld && lastWordNote) {
        const releaseAge = (currentBeat - lastWordEndBeat) * secPerBeat
        releaseOpacity = releaseDuration > 0 ? Math.max(0, 1 - releaseAge / releaseDuration) : 0
      }

      const onsetAge = lastWordNote ? (currentBeat - lastWordNote.beat) * secPerBeat : 1
      const onsetT = Math.min(onsetAge / 0.12, 1)
      const popScale = 1 + onsetBounce * 2 * (1 - onsetT)

      // Zoom flash blows the whole card up for its ~2-frame window.
      const zoomAge = lastZoomNote ? (currentBeat - lastZoomNote.beat) * secPerBeat : Infinity
      const zoomFlash = zoomAge < ZOOM_FLASH_SECONDS ? zoomFlashScale : 1

      for (const spr of scatterPoolRef.current) { spr.active = false; spr.mesh.visible = false }
      if (releaseOpacity > 0 && wordCount > 0 && cardEnd > cardStart) {
        const phraseBeat = allWordNotes[cardStart].beat
        // Cards run BIG - three or four words at most, so each word gets real
        // presence (the reference's singles span nearly half the frame).
        const wordScale = sizeAt(phraseBeat) * 0.72 * zoomFlash
        const spaceW = wordScale * 0.26
        const maxLineW = viewport.width * 0.88 * zoomFlash

        // Sprites for EVERY card word; future words reserve their place but
        // stay invisible until sung.
        const sprites: { spr: FlightPooled; width: number; scaleMul: number; sung: boolean; newest: boolean }[] = []
        for (let i = cardStart; i < cardEnd; i++) {
          if (lyric[i]?.clipIndex !== currentClipIndex) continue
          const entry = entryAt(i)
          if (!entry) continue
          const spr = acquirePooled(scatterPoolRef.current, groupRef.current)
          configureTextMaterial(spr.mat, invertInThisPass)
          wearTexture(spr, wordTextureAt(false, i, entry))
          const scaleMul = laneAt(i).size
          sprites.push({
            spr,
            width: wordScale * scaleMul * texAspect(spr.texture),
            scaleMul,
            sung: allWordNotes[i].beat <= currentBeat,
            newest: i === wordCount - 1,
          })
        }

        // Row layout: the card is ONE line, shrunk to fit the frame instead of
        // wrapped. The fit multiplies every sprite (widths and draw scale), so
        // the line is exactly as violent as its longest phrase and never clips.
        let fitK = 1
        if (singleLine) {
          let total = 0
          for (let i = 0; i < sprites.length; i++) total += (i > 0 ? spaceW : 0) + sprites[i].width
          fitK = Math.min(1, maxLineW / Math.max(1e-6, total))
          for (const sp of sprites) sp.width *= fitK
        }
        // Greedy line wrap over the whole card (row mode never overflows).
        const lines: { start: number; end: number; width: number }[] = []
        let lineStart = 0
        let lineWidth = 0
        for (let i = 0; i < sprites.length; i++) {
          const candidate = lineWidth + (lineWidth > 0 ? spaceW : 0) + sprites[i].width
          if (lineWidth > 0 && candidate > maxLineW) {
            lines.push({ start: lineStart, end: i, width: lineWidth })
            lineStart = i
            lineWidth = sprites[i].width
          } else {
            lineWidth = candidate
          }
        }
        lines.push({ start: lineStart, end: sprites.length, width: lineWidth })

        // Tight stack, like the reference's cards: lines sit close (cap-height
        // spacing), the whole card centered on the placement point.
        const lineGap = wordScale * 0.6
        const cardX = placeX(phraseBeat)
        const cardY = currentYOffset * viewport.height * heightAmount + placeY(phraseBeat)
        for (let li = 0; li < lines.length; li++) {
          const line = lines[li]
          const y = cardY + ((lines.length - 1) / 2 - li) * lineGap
          let x = cardX - line.width / 2
          for (let i = line.start; i < line.end; i++) {
            const { spr, width, scaleMul, sung, newest } = sprites[i]
            if (!sung) {
              // Its place is reserved by the layout; it just isn't lit yet.
              spr.mesh.visible = false
              x += width + spaceW
              continue
            }
            const s = wordScale * scaleMul * fitK * (newest ? popScale : 1)
            spr.mesh.scale.set(s * texAspect(spr.texture), s, 1)
            spr.mesh.position.set(x + width / 2, y, -0.0004 * (sprites.length - i))
            spr.mesh.rotation.set(0, 0, 0)
            setAnimatedOpacity(spr.mat, releaseOpacity * textOpacity)
            x += width + spaceW
          }
        }
      }
      prewarmAhead(wordIdx)
      return
    }
    for (const spr of scatterPoolRef.current) { spr.active = false; spr.mesh.visible = false }

    // The main mesh wears the current word's cached texture - a pointer swap
    // when the word or styling changes (the canvas draw + upload happened
    // when the texture was first minted, ideally in the prewarm a beat ago).
    const mainMaterial = meshRef.current.material as MeshBasicMaterial
    const mainTexture = wordTextureAt(true, wordIdx, currentEntry)
    if (mainMaterial.map !== mainTexture) mainMaterial.map = mainTexture

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
        const sprEntry = entryAt(sprWordIdx)
        if (!sprEntry) continue
        // Placement latches to the WORD's onset, not to this sprite's subdivision.
        // A word held for two beats emits a sprite every subdiv, and latching each
        // one to its own subdiv meant the trail split across a placement change:
        // the copies emitted after the step jumped to the new spot while the older
        // ones stayed behind. The trail belongs to one word, so it takes one
        // placement - only the NEXT word moves.
        const sprOnsetBeat = nextWordNotes[sprWordIdx]?.beat ?? spawnBeat
        const sprColor = invertBehind
          ? '#ffffff'
          : shiftHex(rainbowOn(sprWordIdx) ? hslToHex(((k % rainbowCycleLength) / rainbowCycleLength) * 360, 1, 0.55) : laneAt(sprWordIdx).color)
        const seed = k * 13 + 7
        const vx = (seededRand(seed) - 0.5) * flightDrift
        const vy = (seededRand(seed + 1) - 0.5) * flightDrift * 0.6
        const tumbleX = (seededRand(seed + 2) - 0.5) * flightTumble
        const tumbleY = (seededRand(seed + 3) - 0.5) * flightTumble

        const spr = acquireFlightSprite(groupRef.current)
        configureTextMaterial(spr.mat, invertInThisPass)
        // Not wordTextureAt: a flight sprite's rainbow hue is keyed to its own
        // subdiv (sprColor), not the frame's; canvasStrokeColor is the same
        // invert-aware value.
        wearTexture(spr, wordTexture(false, sprEntry, strokeWidth, fontAt(sprWordIdx), sprColor, canvasStrokeColor, glow, glowContained, shadow, outlineAt(sprWordIdx)))
        spr.mesh.position.set(
          vx * ageSec + placeX(sprOnsetBeat),
          yOffsetAt(spawnBeat) * viewport.height * heightAmount + vy * ageSec + placeY(sprOnsetBeat),
          -depth,
        )
        spr.mesh.rotation.set(tumbleX * ageSec, tumbleY * ageSec, 0)
        const sprScale = sizeForWord(sprWordIdx, sprOnsetBeat)
        spr.mesh.scale.set(sprScale * texAspect(spr.texture), sprScale, 1)
        const fadeStart = flightMaxDepth * 0.7
        setAnimatedOpacity(spr.mat, depth > fadeStart
          ? textOpacity * Math.max(0, 1 - (depth - fadeStart) / (flightMaxDepth - fadeStart))
          : textOpacity)
      }
    }

    // --- Main mesh ---
    let releaseOpacity = 1
    if (sustainWords || isNoteHeld) {
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
    const jitterSize = 1 + (seededRand(wordIdx * 131 + 8) - 0.5) * 2 * jitter * 0.18
    const wordOnsetBeat = lastWordNote ? lastWordNote.beat : currentBeat
    // Zoom flash: while its window is open the word renders BLOWN UP, then
    // snaps back. A hard switch, not a ramp: it reads as a subliminal insert.
    const zoomAge = lastZoomNote ? (currentBeat - lastZoomNote.beat) * secPerBeat : Infinity
    const zoomFlash = zoomAge < ZOOM_FLASH_SECONDS ? zoomFlashScale : 1
    // Fit guard: whatever the size and canvas aspect, the word block never
    // overflows the visible frame (a whole-line entry in a 9:16 view used to
    // sail off both edges). Applied BEFORE the zoom flash, whose blow-up is
    // an intentional overflow.
    const aspect = texAspect(mainTexture)
    const baseScale = sizeForWord(wordIdx, wordOnsetBeat) * onsetScale * bassPopScale * jitterSize
    const scale = Math.min(baseScale, (viewport.width * 0.92) / Math.max(0.0001, aspect)) * zoomFlash
    meshRef.current.scale.set(scale * aspect, scale, 1)
    meshRef.current.rotation.z = (seededRand(wordIdx * 131 + 7) - 0.5) * 2 * jitter * 0.12
    const laneShakeX = laneShakeAt(wordIdx)
      ? (seededRand(Math.floor(currentBeat * 30) * 3 + wordIdx * 77) - 0.5) * 0.02 * viewport.width
      : 0
    const laneShakeY = laneShakeAt(wordIdx)
      ? (seededRand(Math.floor(currentBeat * 30) * 3 + wordIdx * 77 + 1) - 0.5) * 0.02 * viewport.height
      : 0
    meshRef.current.position.x = shakeX + laneShakeX + placeX(wordOnsetBeat)
    meshRef.current.position.y = currentYOffset * viewport.height * heightAmount + shakeY + laneShakeY
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

      const echoEntry = entryAt(echoIdx)
      if (!echoEntry) { mesh.visible = false; continue }
      // The tap wears the cached texture of the word it echoes - the same
      // texture the main mesh already uploaded when that word was current.
      const tex = wordTextureAt(false, echoIdx, echoEntry)
      const echoMaterial = mesh.material as MeshBasicMaterial
      if (echoMaterial.map !== tex) echoMaterial.map = tex

      const tapScale = sizeForWord(echoIdx, echoNote.beat) * Math.max(0.1, 1 - delayScaleFalloff * tapNum)
      mesh.scale.set(tapScale * texAspect(tex), tapScale, 1)
      mesh.position.x = (pingPongEnabled ? (tapNum % 2 === 1 ? -1 : 1) * pingPongWidth * viewport.width * 0.5 : 0)
        + placeX(echoNote.beat)
      mesh.position.y = yOffsetAt(echoNote.beat) * viewport.height * heightAmount + placeY(echoNote.beat)
      mesh.position.z = -0.01 * tapNum
      setAnimatedOpacity(mesh.material as MeshBasicMaterial, Math.max(0.01, 1 - delayOpacityFalloff * tapNum) * textOpacity)
      mesh.visible = true
    }
    prewarmAhead(wordIdx)
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
  // Words carry per-lane colors now, so the track wears the word-note accent.
  identityColor: '#facc15',
  userInterfaceRenderer: 'textDisplay',
  params: PARAMS,
  // The rows ARE the track's style lanes (pitch = lane = look), so the
  // vocabulary is per-track: rename or restyle a lane and its row follows.
  midiRowsFor: (track) => [
    ...resolveStyleLanes(track.styleLanes).map((lane, i) => ({
      pitch: styleLanePitch(i),
      label: lane.name,
      color: lane.color,
      emphasized: i === 0,
      // The roll's gutter renders each lane in its own face - the row label
      // IS the style preview - and carries the index so the editor can open
      // the lane's style sidecar from the row.
      fontFamily: fontStack(lane.font).css,
      sizeScale: lane.size,
      laneIndex: i,
    })),
    { pitch: PITCH_BASS_POP, label: 'Bass pop (punch + shake)' },
    { pitch: PITCH_ZOOM_FLASH, label: 'Zoom flash (1 frame)' },
  ],
  component: TextDisplayVisual,
  // NOT fullFrame: the text lives in world space so movers (and the camera)
  // can act on it - it is deliberately not pinned to the viewport.
  defaultOnTop: true,
}
