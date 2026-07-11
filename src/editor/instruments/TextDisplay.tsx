import { useRef, useEffect, useState } from 'react'
import { useThree } from '@react-three/fiber'
import { Color, Group, Mesh, MeshBasicMaterial, PlaneGeometry, CanvasTexture, LinearFilter, DoubleSide, type Material } from 'three'
import { useInstrumentFrame, seededRand } from '../core/visual/instrumentFrame'
import { setAnimatedOpacity } from '../core/visual/animatedOpacity'
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

// System font stacks - no Google Fonts. Index maps to a stack via SelectParam options.
const FONT_STACKS = [
  '"Arial Black", Impact, sans-serif',
  'Georgia, "Times New Roman", serif',
  '"Courier New", monospace',
  'Arial, Helvetica, sans-serif',
]
const fontStack = (i: number) => FONT_STACKS[Math.max(0, Math.min(FONT_STACKS.length - 1, Math.round(i)))]

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
const TEXT_ALPHA_TEST = 0.001

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
  family: string,
  color: string,
  strokeColor: string,
): HTMLCanvasElement {
  const entry = typeof word === 'string' ? singleTextEntry(word) : word
  const key = `${entry.cacheKey}|${strokeWidth}|${family}|${color}|${strokeColor}`
  const cached = canvasCache.get(key)
  if (cached) return cached

  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1
  const canvas = document.createElement('canvas')
  canvas.width = TEXT_CANVAS_SIZE * dpr
  canvas.height = TEXT_CANVAS_SIZE * dpr
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.scale(dpr, dpr)

  let fontSize = TEXT_CANVAS_SIZE * 0.35
  const fontStr = (size: number) => `900 ${size}px ${family}`
  ctx.font = fontStr(fontSize)

  const maxWidth = TEXT_CANVAS_SIZE * 0.9
  const layoutText = entry.layoutText || entry.text
  const measured = ctx.measureText(layoutText)
  if (measured.width > maxWidth && measured.width > 0) {
    fontSize *= maxWidth / measured.width
    ctx.font = fontStr(fontSize)
  }

  ctx.textBaseline = 'middle'
  const cx = TEXT_CANVAS_SIZE / 2
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
  ctx.fillText(entry.text, drawX, cy)

  if (canvasCache.size >= CANVAS_CACHE_MAX) {
    const firstKey = canvasCache.keys().next().value
    if (firstKey !== undefined) canvasCache.delete(firstKey)
  }
  canvasCache.set(key, canvas)
  return canvas
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

const PARAMS: ParamDef[] = [
  { key: 'text', label: 'Text', type: 'string', default: 'HELLO', multiline: true },
  {
    key: 'font', label: 'Font', type: 'select', default: 0, options: [
      { value: 0, label: 'Impact / Sans' },
      { value: 1, label: 'Serif' },
      { value: 2, label: 'Monospace' },
      { value: 3, label: 'Sans-serif' },
    ],
  },
  { key: 'color', label: 'Color', type: 'color', default: '#ffffff' },
  { key: 'strokeColor', label: 'Stroke Color', type: 'color', default: '#000000' },
  { key: 'fontSize', label: 'Font Size', min: 0.1, max: 5, step: 0.1, default: 1 },
  { key: 'strokeWidth', label: 'Stroke Width', min: 0, max: 0.2, step: 0.01, default: 0.05 },
  { key: 'opacity', label: 'Opacity', min: 0, max: 1, step: 0.05, default: 1 },
  { key: 'releaseDuration', label: 'Release Fade', min: 0, max: 2, step: 0.05, default: 0.4 },
  { key: 'heightAmount', label: 'Height Amount', min: 0, max: 1, step: 0.05, default: 0.35 },
  { key: 'onsetBounce', label: 'Onset Bounce', min: 0, max: 0.5, step: 0.01, default: 0.08 },
  { key: 'delayTaps', label: 'Delay Taps', min: 0, max: MAX_DELAY_TAPS, step: 1, default: 0 },
  { key: 'delayTime', label: 'Delay Time', min: 0.05, max: 2, step: 0.05, default: 0.3 },
  { key: 'delayScaleFalloff', label: 'Delay Scale Falloff', min: 0, max: 0.5, step: 0.02, default: 0.15 },
  { key: 'delayOpacityFalloff', label: 'Delay Opacity Falloff', min: 0, max: 0.5, step: 0.02, default: 0.25 },
  { key: 'pingPongEnabled', label: 'Ping Pong Delay', type: 'boolean', default: 0 },
  { key: 'pingPongWidth', label: 'Ping Pong Width', min: 0.05, max: 1, step: 0.05, default: 0.3 },
  { key: 'flightEnabled', label: 'Flight Mode', type: 'boolean', default: 0 },
  { key: 'flightSpeed', label: 'Flight Speed', min: 2, max: 60, step: 1, default: 15 },
  { key: 'flightMaxDepth', label: 'Flight Max Depth', min: 10, max: 200, step: 5, default: 50 },
  { key: 'flightDrift', label: 'Flight Drift', min: 0, max: 3, step: 0.1, default: 0.3 },
  { key: 'flightTumble', label: 'Flight Tumble', min: 0, max: 5, step: 0.1, default: 0.5 },
  { key: 'flightSubdivRate', label: 'Flight Spawns/Beat', min: 1, max: 32, step: 1, default: 8 },
  { key: 'hue', label: 'Hue Shift', min: 0, max: 1, step: 0.01, default: 0 },
  { key: 'rainbowEnabled', label: 'Rainbow', type: 'boolean', default: 0 },
  { key: 'rainbowCycleLength', label: 'Rainbow Cycle Length', min: 2, max: 64, step: 1, default: 12 },
]
const _hueColor = new Color()

function TextDisplayVisual({ trackId }: { trackId: string }) {
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

  const { viewport } = useThree()
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
    }
  }, [])

  // Parent the echo meshes onto the group once ready.
  useEffect(() => {
    if (!ready || !groupRef.current) return
    const g = groupRef.current
    for (const mesh of echoMeshesRef.current) g.add(mesh)
    return () => { for (const mesh of echoMeshesRef.current) g.remove(mesh) }
  }, [ready])

  function acquireFlightSprite(group: Group): FlightPooled {
    for (const spr of flightPoolRef.current) {
      if (!spr.active) { spr.active = true; spr.mesh.visible = true; return spr }
    }
    const texture = new CanvasTexture(createTextCanvas('', 0.05, fontStack(0), '#ffffff', '#000000'))
    texture.minFilter = LinearFilter
    texture.magFilter = LinearFilter
    const mat = new MeshBasicMaterial({ map: texture, transparent: true, alphaTest: TEXT_ALPHA_TEST, opacity: 1, side: DoubleSide, depthWrite: false, toneMapped: false })
    const mesh = new Mesh(new PlaneGeometry(1, 1), mat)
    group.add(mesh)
    const entry: FlightPooled = { mesh, texture, mat, key: '', active: true }
    flightPoolRef.current.push(entry)
    return entry
  }

  useInstrumentFrame(trackId, (state) => {
    if (!textureRef.current || !meshRef.current || !groupRef.current) return

    const p = state.params
    const text = state.stringParams.text ?? 'HELLO'
    const family = fontStack(p.font ?? 0)
    const color = state.stringParams.color || '#ffffff'
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

    const baseScale = Math.min(viewport.width, viewport.height) * 0.6 * fontSize

    // Re-render main texture when the word or styling changes.
    const renderKey = `${currentEntry.cacheKey}|${strokeWidth}|${family}|${effectiveColor}|${strokeColor}`
    if (renderKey !== lastRenderKeyRef.current) {
      lastRenderKeyRef.current = renderKey
      textureRef.current.image = createTextCanvas(currentEntry, strokeWidth, family, effectiveColor, strokeColor)
      textureRef.current.needsUpdate = true
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
        const sprColor = shiftHex(rainbowEnabled ? hslToHex(((k % rainbowCycleLength) / rainbowCycleLength) * 360, 1, 0.55) : color)
        const seed = k * 13 + 7
        const vx = (seededRand(seed) - 0.5) * flightDrift
        const vy = (seededRand(seed + 1) - 0.5) * flightDrift * 0.6
        const tumbleX = (seededRand(seed + 2) - 0.5) * flightTumble
        const tumbleY = (seededRand(seed + 3) - 0.5) * flightTumble

        const spr = acquireFlightSprite(groupRef.current)
        const sprKey = `${sprEntry.cacheKey}|${strokeWidth}|${family}|${sprColor}|${strokeColor}`
        if (sprKey !== spr.key) {
          spr.key = sprKey
          spr.texture.image = createTextCanvas(sprEntry, strokeWidth, family, sprColor, strokeColor)
          spr.texture.needsUpdate = true
        }
        spr.mesh.position.set(
          vx * ageSec,
          yOffsetAt(spawnBeat) * viewport.height * heightAmount + vy * ageSec,
          -depth,
        )
        spr.mesh.rotation.set(tumbleX * ageSec, tumbleY * ageSec, 0)
        spr.mesh.scale.setScalar(baseScale)
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
    const scale = baseScale * onsetScale * bassPopScale
    meshRef.current.scale.set(scale, scale, 1)
    meshRef.current.position.x = shakeX
    meshRef.current.position.y = currentYOffset * viewport.height * heightAmount + shakeY

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
      const echoKey = `${echoEntry.cacheKey}|${effectiveColor}|${strokeColor}`
      if (echoKey !== echoLastWordsRef.current[tap]) {
        tex.image = createTextCanvas(echoEntry, strokeWidth, family, effectiveColor, strokeColor)
        tex.needsUpdate = true
        echoLastWordsRef.current[tap] = echoKey
      }

      const tapScale = baseScale * Math.max(0.1, 1 - delayScaleFalloff * tapNum)
      mesh.scale.set(tapScale, tapScale, 1)
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
      <mesh ref={meshRef}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial map={textureRef.current} transparent alphaTest={TEXT_ALPHA_TEST} depthWrite={false} />
      </mesh>
    </group>
  )
}

export const textDisplayInstrument: ObjectInstrumentDef = {
  id: 'textDisplay',
  name: 'Text Display',
  kind: 'object',
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
  fullFrame: true,
  defaultOnTop: true,
}
