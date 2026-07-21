import { useRef } from 'react'
import { useInstrumentFrame, seededRand, beatInBlock } from '../core/visual/instrumentFrame'
import { useFullFrameCanvas, commitCanvasFrame } from '../core/visual/fullFrameCanvas'
import { FORCE_TRANSPARENT_KEY } from '../core/visual/animatedOpacity'
import type { ObjectInstrumentDef, ParamDef } from './types'

// SILENT FILM - the "degraded film stock" pair for the Silent Film lyric
// template (docs/lyric-template-silent-film.md). Two instruments share this
// file because the aesthetic needs both sides of the text:
//
//   Film Stock  - the projected-stock BACKGROUND: tinted charcoal base, faint
//                 graph grid, coarse animated grain, dust/hairs, a wandering
//                 full-height scratch, luminance flicker and vignette. Lives in
//                 the base scene like any background instrument.
//   Film Grain  - the degradation OVERLAY: the same grain/dust/vignette drawn
//                 on a transparent plane that composites OVER everything
//                 (defaultOnTop + a high renderOrder), so text and background
//                 degrade together - that shared wear is what welds the frame
//                 into one piece of film.
//
// Ambient with zero notes (gated by beatInBlock). Barrel warp from the
// reference is deliberately out of scope here - it needs a post pass, not a
// scene plane.

// Film runs at 24fps and so does this: EVERY animated value derives from a
// beat-time frame index quantized to FILM_FPS, which makes each layer a step
// function of the beat rather than a continuous one. Two payoffs, and the
// second is why the template is affordable at all: the wear reads as projected
// rather than digitally smooth, and a frame whose index and params have not
// moved is skipped outright - no canvas rasterization, no texture upload. At
// 60fps playback that drops well over half the repaints. (Scrub == playback is
// unaffected: a quantized function of the beat is still a function of it.)
const FILM_FPS = 24

// Canvas height, deliberately half the usual full-frame budget: everything
// here is coarse (grain, dust, a soft vignette) and the GPU upscales it to the
// viewport anyway, so this costs a QUARTER of the pixels - to rasterize and to
// upload - for no visible difference. Absolute pixel sizes below are written
// against REFERENCE_H and scaled by `h / REFERENCE_H`, so the look is
// identical at whatever height this is set to.
const CANVAS_H = 512
const REFERENCE_H = 1024

const GRAIN_TILE = 256
const GRAIN_TILE_COUNT = 8

// Seeded speckle tiles (mostly transparent, ~5% dark / ~2.5% bright pixels),
// generated once and shared by every instance of both instruments. Drawn
// scaled+offset per frame; source-over alpha works on the opaque background
// canvas and the transparent overlay canvas alike.
let grainTiles: HTMLCanvasElement[] | null = null
function getGrainTiles(): HTMLCanvasElement[] {
  if (grainTiles) return grainTiles
  const tiles: HTMLCanvasElement[] = []
  for (let t = 0; t < GRAIN_TILE_COUNT; t++) {
    const canvas = document.createElement('canvas')
    canvas.width = GRAIN_TILE
    canvas.height = GRAIN_TILE
    const ctx = canvas.getContext('2d')!
    const img = ctx.createImageData(GRAIN_TILE, GRAIN_TILE)
    const d = img.data
    // Sparse and faint on purpose: the canvas minifies onto the viewport
    // without mipmaps, which undersamples dense noise into a bright snowstorm.
    for (let i = 0; i < GRAIN_TILE * GRAIN_TILE; i++) {
      const r = seededRand(t * 65536 + i)
      if (r < 0.05) {
        d[i * 4 + 3] = Math.round((1 - r / 0.05) * 70) // black speck
      } else if (r > 0.975) {
        d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = 255
        d[i * 4 + 3] = Math.round(((r - 0.975) / 0.025) * 55) // bright speck
      }
    }
    ctx.putImageData(img, 0, 0)
    tiles.push(canvas)
  }
  grainTiles = tiles
  return tiles
}

/** Tile the current grain frame across the canvas. The tile is scaled to the
 *  canvas height so a speck covers the same screen area at any resolution. */
function drawGrain(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  elapsed: number,
  amount: number,
  size: number,
) {
  if (amount <= 0) return
  const tiles = getGrainTiles()
  const frame = Math.floor(elapsed * FILM_FPS)
  const tile = tiles[((frame % GRAIN_TILE_COUNT) + GRAIN_TILE_COUNT) % GRAIN_TILE_COUNT]
  const step = Math.max(32, GRAIN_TILE * Math.max(1, Math.round(size)) * (h / REFERENCE_H))
  const ox = Math.floor(seededRand(frame * 131 + 7) * step)
  const oy = Math.floor(seededRand(frame * 137 + 11) * step)
  const smoothing = ctx.imageSmoothingEnabled
  ctx.imageSmoothingEnabled = false // chunky film grain, not a soft blur
  ctx.globalAlpha = amount
  for (let y = -oy; y < h; y += step) {
    for (let x = -ox; x < w; x += step) ctx.drawImage(tile, x, y, step, step)
  }
  ctx.globalAlpha = 1
  ctx.imageSmoothingEnabled = smoothing
}

/** Dust specks + the occasional drifting hair, re-rolled at 12 beat-time fps.
 *  `extra` adds burst specks (note-driven); `seedSalt` decorrelates the two
 *  instruments so background and overlay dust never twin. */
function drawDust(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  elapsed: number,
  amount: number,
  seedSalt: number,
  extra = 0,
) {
  if (amount <= 0 && extra <= 0) return
  const px = h / REFERENCE_H
  const frame = Math.floor(elapsed * 12)
  const count = Math.round(amount * 26) + extra
  ctx.fillStyle = '#ffffff'
  for (let i = 0; i < count; i++) {
    const s = frame * 8117 + i * 271 + seedSalt
    if (seededRand(s) < 0.35) continue // not every slot lands every frame
    const x = seededRand(s + 1) * w
    const y = seededRand(s + 2) * h
    // Floored so a speck never shrinks below a visible sub-pixel smudge.
    const radius = Math.max(0.6, (0.6 + seededRand(s + 3) * 2.2) * px)
    ctx.globalAlpha = 0.12 + seededRand(s + 4) * 0.5
    ctx.beginPath()
    ctx.arc(x, y, radius, 0, Math.PI * 2)
    ctx.fill()
  }
  if (amount > 0) {
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 1
    for (let i = 0; i < 2; i++) {
      const s = frame * 6421 + i * 947 + seedSalt + 13
      if (seededRand(s) < 0.72) continue
      const x = seededRand(s + 1) * w
      const y = seededRand(s + 2) * h
      const len = (30 + seededRand(s + 3) * 90) * px
      const angle = seededRand(s + 4) * Math.PI * 2
      const bend = (seededRand(s + 5) - 0.5) * 60 * px
      ctx.globalAlpha = 0.1 + seededRand(s + 6) * 0.2
      ctx.beginPath()
      ctx.moveTo(x, y)
      ctx.quadraticCurveTo(
        x + Math.cos(angle + Math.PI / 2) * bend,
        y + Math.sin(angle + Math.PI / 2) * bend,
        x + Math.cos(angle) * len,
        y + Math.sin(angle) * len,
      )
      ctx.stroke()
    }
  }
  ctx.globalAlpha = 1
}

/** Global luminance wobble: a low-alpha black or white wash re-rolled at 18
 *  beat-time fps. `boost` (note-driven) multiplies the amplitude. */
function drawFlicker(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  elapsed: number,
  amount: number,
  boost = 1,
) {
  if (amount <= 0) return
  const f = (seededRand(Math.floor(elapsed * 18) * 31 + 5) - 0.5) * 2 * amount * boost
  ctx.fillStyle = f < 0 ? '#000000' : '#ffffff'
  ctx.globalAlpha = Math.min(0.5, Math.abs(f) * (f < 0 ? 0.09 : 0.06))
  ctx.fillRect(0, 0, w, h)
  ctx.globalAlpha = 1
}

// A full-canvas radial-gradient rasterization is the single most expensive op
// in these instruments, and it is identical every frame - bake it once per
// (size, amount) and blit the result instead. Both instruments in this file
// use the same gradient, so they share the cache.
const vignetteCache = new Map<string, HTMLCanvasElement>()

/** Strong radial vignette - the projected frame's hot center / dark corners. */
function drawVignette(ctx: CanvasRenderingContext2D, w: number, h: number, amount: number) {
  if (amount <= 0) return
  const key = `${w}x${h}|${amount.toFixed(3)}`
  let baked = vignetteCache.get(key)
  if (!baked) {
    baked = document.createElement('canvas')
    baked.width = w
    baked.height = h
    const bctx = baked.getContext('2d')!
    const cx = w / 2
    const cy = h / 2
    const gradient = bctx.createRadialGradient(cx, cy, h * 0.3, cx, cy, Math.hypot(cx, cy))
    gradient.addColorStop(0, 'rgba(0,0,0,0)')
    gradient.addColorStop(0.6, `rgba(0,0,0,${(amount * 0.35).toFixed(4)})`)
    gradient.addColorStop(1, `rgba(0,0,0,${Math.min(1, amount * 0.95).toFixed(4)})`)
    bctx.fillStyle = gradient
    bctx.fillRect(0, 0, w, h)
    // Bounded: a slider drag mints one per step until it settles.
    if (vignetteCache.size >= 12) {
      const oldest = vignetteCache.keys().next().value
      if (oldest !== undefined) vignetteCache.delete(oldest)
    }
    vignetteCache.set(key, baked)
  }
  ctx.drawImage(baked, 0, 0)
}

// ---------------------------------------------------------------------------
// Film Stock - the background.
// ---------------------------------------------------------------------------

const STOCK_PARAMS: ParamDef[] = [
  { key: 'baseColor', label: 'Stock Color', type: 'color', default: '#1a171b' },
  { key: 'grain', label: 'Grain', min: 0, max: 1, step: 0.05, default: 0.55 },
  { key: 'grainSize', label: 'Grain Size', min: 1, max: 4, step: 1, default: 2 },
  { key: 'dust', label: 'Dust', min: 0, max: 1, step: 0.05, default: 0.5 },
  { key: 'scratch', label: 'Wandering Scratch', min: 0, max: 1, step: 0.05, default: 0.5 },
  { key: 'grid', label: 'Graph Grid', min: 0, max: 1, step: 0.05, default: 0.25 },
  { key: 'flicker', label: 'Flicker', min: 0, max: 1, step: 0.05, default: 0.35 },
  { key: 'vignette', label: 'Vignette', min: 0, max: 1, step: 0.05, default: 0.65 },
  { key: 'flashColor', label: 'Burn Flash Color', type: 'color', default: '#ffe3b8' },
  { key: 'flashDur', label: 'Flash Fade (s)', min: 0.1, max: 2, step: 0.05, default: 0.5 },
]

function FilmStockVisual({ trackId }: { trackId: string }) {
  const { viewport, meshRef, canvasRef, textureRef, unchanged, invalidate } = useFullFrameCanvas(CANVAS_H)
  const gridRef = useRef<HTMLCanvasElement | null>(null)

  useInstrumentFrame(trackId, (state) => {
    const canvas = canvasRef.current
    const texture = textureRef.current
    const mesh = meshRef.current
    if (!canvas || !texture || !mesh) return false
    const ctx = canvas.getContext('2d')
    if (!ctx) return false

    // No block at this beat = nothing on screen (blocks are the on-region).
    const inBlock = beatInBlock(state)
    mesh.visible = inBlock
    if (!inBlock) { invalidate(); return }

    const p = state.params
    const sp = state.stringParams
    const w = canvas.width
    const h = canvas.height
    const px = h / REFERENCE_H
    // Quantized film time - every value below derives from this, never from
    // the raw beat, which is what makes the skip below sound.
    const filmFrame = Math.floor(state.beat * state.secPerBeat * FILM_FPS)
    const elapsed = filmFrame / FILM_FPS

    if (unchanged(
      `${filmFrame}|${w}|${h}|${sp.baseColor}|${sp.flashColor}|${p.grain}|${p.grainSize}`
      + `|${p.dust}|${p.scratch}|${p.grid}|${p.flicker}|${p.vignette}|${p.flashDur}`,
      state.notes,
    )) return

    const flashDur = p.flashDur ?? 0.5
    const secPerBeat = state.secPerBeat

    // 1. Stock base.
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1
    ctx.fillStyle = sp.baseColor ?? '#1a171b'
    ctx.fillRect(0, 0, w, h)

    // 2. Faint graph grid (prerendered once per canvas size).
    const gridAmount = p.grid ?? 0.25
    if (gridAmount > 0) {
      let grid = gridRef.current
      if (!grid || grid.width !== w || grid.height !== h) {
        grid = document.createElement('canvas')
        grid.width = w
        grid.height = h
        const gctx = grid.getContext('2d')!
        gctx.strokeStyle = '#ffffff'
        gctx.lineWidth = 1
        gctx.beginPath()
        const spacing = Math.max(6, 26 * px)
        for (let x = 0.5; x < w; x += spacing) { gctx.moveTo(x, 0); gctx.lineTo(x, h) }
        for (let y = 0.5; y < h; y += spacing) { gctx.moveTo(0, y); gctx.lineTo(w, y) }
        gctx.stroke()
        gridRef.current = grid
      }
      ctx.globalAlpha = gridAmount * 0.07
      ctx.drawImage(grid, 0, 0)
      ctx.globalAlpha = 1
    }

    // 3. Burn flashes (notes below the scratch row): a warm bloom off-center,
    //    fading over flashDur, intensity from velocity.
    for (const n of state.notes) {
      if (n.pitch >= 64) continue
      const age = elapsed - n.beat * secPerBeat
      if (age < 0 || age >= flashDur) continue
      const velN = n.velocity <= 1 ? n.velocity : n.velocity / 127
      const k = 1 - age / flashDur
      const fx = (0.3 + seededRand(n.beat * 13 + n.pitch) * 0.4) * w
      const fy = (0.3 + seededRand(n.beat * 17 + n.pitch) * 0.4) * h
      const flash = ctx.createRadialGradient(fx, fy, 0, fx, fy, h * 0.7)
      flash.addColorStop(0, sp.flashColor ?? '#ffe3b8')
      flash.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.globalCompositeOperation = 'lighter'
      ctx.globalAlpha = k * k * velN * 0.55
      ctx.fillStyle = flash
      ctx.fillRect(0, 0, w, h)
      ctx.globalCompositeOperation = 'source-over'
      ctx.globalAlpha = 1
    }

    // 4. Coarse grain.
    drawGrain(ctx, w, h, elapsed, (p.grain ?? 0.55) * 0.55, p.grainSize ?? 2)

    // 5. Dust + hairs.
    drawDust(ctx, w, h, elapsed, p.dust ?? 0.5, 0)

    // 6. Wandering full-height scratch: present in seeded ~2.5s windows,
    //    x jitters within the window. Scratch-row notes (pitch >= 64) force
    //    a denser streak burst for 0.4s.
    const scratchAmount = p.scratch ?? 0.5
    const windowIndex = Math.floor(elapsed * 0.4)
    if (scratchAmount > 0 && seededRand(windowIndex * 7919 + 3) < scratchAmount * 0.6) {
      const baseX = seededRand(windowIndex * 4271 + 9) * w
      const x = baseX + (seededRand(filmFrame * 53 + 1) - 0.5) * 8 * px
      ctx.globalAlpha = 0.08 + seededRand(windowIndex * 31 + 2) * 0.1
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(x, 0, Math.max(1, 1.5 * px), h)
      ctx.globalAlpha = 1
    }
    for (const n of state.notes) {
      if (n.pitch < 64) continue
      const age = elapsed - n.beat * secPerBeat
      if (age < 0 || age >= 0.4) continue
      const k = 1 - age / 0.4
      for (let i = 0; i < 3; i++) {
        const s = n.beat * 977 + n.pitch * 31 + i * 211
        const x = seededRand(s) * w + (seededRand(filmFrame + s) - 0.5) * 14 * px
        ctx.globalAlpha = k * (0.1 + seededRand(s + 1) * 0.18)
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(x, 0, Math.max(1, (1 + seededRand(s + 2)) * px), h)
      }
      ctx.globalAlpha = 1
    }

    // 7. Flicker + vignette close the frame.
    drawFlicker(ctx, w, h, elapsed, p.flicker ?? 0.35)
    drawVignette(ctx, w, h, p.vignette ?? 0.65)

    commitCanvasFrame(mesh, texture)
  })

  return (
    <mesh ref={meshRef} renderOrder={-9999}>
      <planeGeometry args={[viewport.width * 1.02, viewport.height * 1.02]} />
      <meshBasicMaterial transparent opacity={1} depthWrite={false} />
    </mesh>
  )
}

export const filmStockInstrument: ObjectInstrumentDef = {
  id: 'filmStock',
  name: 'Film Stock',
  kind: 'object',
  userInterfaceRenderer: 'parameters',
  params: STOCK_PARAMS,
  midiRows: [
    { pitch: 64, label: 'Scratch streak', color: '#cccccc', emphasized: true },
    { pitch: 60, label: 'Burn flash', color: '#f0b41c' },
  ],
  component: FilmStockVisual,
  fullFrame: true,
}

// ---------------------------------------------------------------------------
// Film Grain - the on-top degradation overlay.
// ---------------------------------------------------------------------------

const GRAIN_PARAMS: ParamDef[] = [
  { key: 'grain', label: 'Grain', min: 0, max: 1, step: 0.05, default: 0.35 },
  { key: 'grainSize', label: 'Grain Size', min: 1, max: 4, step: 1, default: 2 },
  { key: 'dust', label: 'Dust', min: 0, max: 1, step: 0.05, default: 0.3 },
  { key: 'flicker', label: 'Flicker', min: 0, max: 1, step: 0.05, default: 0.35 },
  { key: 'vignette', label: 'Vignette', min: 0, max: 1, step: 0.05, default: 0.55 },
]

function FilmGrainVisual({ trackId }: { trackId: string }) {
  const { viewport, meshRef, canvasRef, textureRef, unchanged, invalidate } = useFullFrameCanvas(CANVAS_H)

  useInstrumentFrame(trackId, (state) => {
    const canvas = canvasRef.current
    const texture = textureRef.current
    const mesh = meshRef.current
    if (!canvas || !texture || !mesh) return false
    const ctx = canvas.getContext('2d')
    if (!ctx) return false

    const inBlock = beatInBlock(state)
    mesh.visible = inBlock
    if (!inBlock) { invalidate(); return }

    const p = state.params
    const w = canvas.width
    const h = canvas.height
    const filmFrame = Math.floor(state.beat * state.secPerBeat * FILM_FPS)
    const elapsed = filmFrame / FILM_FPS

    if (unchanged(
      `${filmFrame}|${w}|${h}|${p.grain}|${p.grainSize}|${p.dust}|${p.flicker}|${p.vignette}`,
      state.notes,
    )) return

    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1
    ctx.clearRect(0, 0, w, h)

    // Note vocabulary: dust bursts (pitch < 62) add a fading cloud of specks;
    // flicker pops (pitch >= 62) slam the wobble amplitude for a beat-blink.
    let burst = 0
    let flickerBoost = 1
    for (const n of state.notes) {
      const age = elapsed - n.beat * state.secPerBeat
      if (age < 0) continue
      const velN = n.velocity <= 1 ? n.velocity : n.velocity / 127
      if (n.pitch < 62) {
        if (age < 0.35) burst += Math.round((1 - age / 0.35) * velN * 30)
      } else if (age < 0.15) {
        flickerBoost = Math.max(flickerBoost, 1 + (1 - age / 0.15) * velN * 4)
      }
    }

    drawGrain(ctx, w, h, elapsed, (p.grain ?? 0.35) * 0.45, p.grainSize ?? 2)
    drawDust(ctx, w, h, elapsed, p.dust ?? 0.3, 17, burst)
    drawFlicker(ctx, w, h, elapsed, p.flicker ?? 0.35, flickerBoost)
    drawVignette(ctx, w, h, p.vignette ?? 0.55)

    commitCanvasFrame(mesh, texture)
  })

  // High renderOrder + no depth test: this plane composites after everything
  // else in its (front) scene - including on-top text - which is the point.
  // FORCE_TRANSPARENT: the canvas is mostly zero-alpha, and the opacity wrapper
  // would otherwise flip `transparent` off at opacity 1 - an opaque draw of
  // premultiplied zero-alpha texels renders as garbage white.
  return (
    <mesh ref={meshRef} renderOrder={9999}>
      <planeGeometry args={[viewport.width * 1.02, viewport.height * 1.02]} />
      <meshBasicMaterial transparent opacity={1} depthWrite={false} depthTest={false} userData={{ [FORCE_TRANSPARENT_KEY]: true }} />
    </mesh>
  )
}

export const filmGrainInstrument: ObjectInstrumentDef = {
  id: 'filmGrain',
  name: 'Film Grain',
  kind: 'object',
  userInterfaceRenderer: 'parameters',
  params: GRAIN_PARAMS,
  midiRows: [
    { pitch: 62, label: 'Flicker pop', color: '#ffffff', emphasized: true },
    { pitch: 60, label: 'Dust burst', color: '#e8e4da' },
  ],
  component: FilmGrainVisual,
  fullFrame: true,
  defaultOnTop: true,
}
