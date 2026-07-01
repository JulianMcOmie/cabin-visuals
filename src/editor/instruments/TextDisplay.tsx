import { useRef, useEffect, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Group, Mesh, MeshBasicMaterial, PlaneGeometry, CanvasTexture, LinearFilter, DoubleSide, type Material } from 'three'
import { getObjectState } from '../core/engine/VisualEngine'
import { useTimeStore } from '../store/TimeStore'
import type { ObjectInstrumentDef, ParamDef, PortDef } from './types'

// Ported from Excellent DAW. Displays text a word at a time, advancing on each MIDI note
// and filling the frame. Words are rendered to a canvas + CanvasTexture on screen-filling
// planes. Supports delay echoes, per-note height offset (pitch 60-72), flight mode (words
// zoom toward the camera), and rainbow hue cycling. Tyler's Google-font loader, palette,
// and seek handling are dropped; note-onsets are detected from the object's activeNotes.

// Pitch roles (kept from Tyler): a dedicated "next word" pitch advances the word, a bass
// "pop" pitch punches the current word, and a 60-72 band sets a vertical height offset.
const PITCH_BASS_POP = 47
const PITCH_NEXT_WORD = 48
const PITCH_HEIGHT_MIN = 60 // C4
const PITCH_HEIGHT_MAX = 72 // C5
const PITCH_HEIGHT_CENTER = 66 // F#4 = no offset
const MAX_DELAY_TAPS = 8

// System font stacks — no Google Fonts. Index maps to a stack via SelectParam options.
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

// Shared canvas cache keyed by (word, stroke, font, color, strokeColor).
const canvasCache = new Map<string, HTMLCanvasElement>()
const CANVAS_CACHE_MAX = 64

function createTextCanvas(
  word: string,
  strokeWidth: number,
  family: string,
  color: string,
  strokeColor: string,
): HTMLCanvasElement {
  const key = `${word}|${strokeWidth}|${family}|${color}|${strokeColor}`
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
  const measured = ctx.measureText(word)
  if (measured.width > maxWidth && measured.width > 0) {
    fontSize *= maxWidth / measured.width
    ctx.font = fontStr(fontSize)
  }

  ctx.textBaseline = 'middle'
  ctx.textAlign = 'center'
  const cx = TEXT_CANVAS_SIZE / 2
  const cy = TEXT_CANVAS_SIZE / 2

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
    ctx.strokeText(word, cx, cy)
  }
  ctx.fillStyle = color
  ctx.fillText(word, cx, cy)

  if (canvasCache.size >= CANVAS_CACHE_MAX) {
    const firstKey = canvasCache.keys().next().value
    if (firstKey !== undefined) canvasCache.delete(firstKey)
  }
  canvasCache.set(key, canvas)
  return canvas
}

// Parse text into words, treating !...! groups as single entries.
function parseWords(text: string): string[] {
  const result: string[] = []
  const parts = text.split('!')
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 0) {
      for (const w of parts[i].split(/\s+/)) if (w) result.push(w)
    } else {
      const grouped = parts[i].trim()
      if (grouped) result.push(grouped)
    }
  }
  return result
}

interface WordHistoryEntry {
  word: string
  triggerTime: number
  duration: number
  yOffset: number
}

interface FlightSprite {
  mesh: Mesh
  texture: CanvasTexture
  birthTime: number
  vx: number
  vy: number
  tumbleX: number
  tumbleY: number
  word: string
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
  { key: 'rainbowEnabled', label: 'Rainbow', type: 'boolean', default: 0 },
  { key: 'rainbowCycleLength', label: 'Rainbow Cycle Length', min: 2, max: 64, step: 1, default: 12 },
]
const PORTS: PortDef[] = [
  { key: 'energy', label: 'Energy', combine: 'add', default: 0 },
  { key: 'scale', label: 'Scale', combine: 'add', default: 0 },
  { key: 'hue', label: 'Hue', combine: 'add', default: 0 },
]

function TextDisplayVisual({ trackId }: { trackId: string }) {
  const groupRef = useRef<Group>(null)
  const meshRef = useRef<Mesh>(null)
  const textureRef = useRef<CanvasTexture | null>(null)

  // Note-onset detection: keys present in activeNotes that are new this frame.
  const prevKeys = useRef<Set<string>>(new Set())
  const wordIndexRef = useRef(0) // advances once per PITCH_NEXT_WORD onset

  // Timing (seconds, from performance.now()).
  const noteOnTimeRef = useRef(-1)
  const onsetTimeRef = useRef(-1)
  const bassPopTimeRef = useRef(-1)
  const releaseTimeRef = useRef(-1)
  const lastFrameTimeRef = useRef(0)
  const currentYOffsetRef = useRef(0)

  // Cache keys for the main texture so we only re-render the canvas when needed.
  const lastRenderKeyRef = useRef('')

  // Delay echoes — one pre-created mesh per tap slot.
  const wordHistoryRef = useRef<WordHistoryEntry[]>([])
  const echoMeshesRef = useRef<Mesh[]>([])
  const echoTexturesRef = useRef<CanvasTexture[]>([])
  const echoLastWordsRef = useRef<string[]>([])

  // Flight mode.
  const flightSpritesRef = useRef<FlightSprite[]>([])
  const flightLastSubdivRef = useRef(-1)

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
      const mat = new MeshBasicMaterial({ map: echoTex, transparent: true, depthWrite: false, opacity: 0 })
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
      for (const spr of flightSpritesRef.current) {
        spr.texture.dispose()
        ;(spr.mesh.material as Material).dispose()
        spr.mesh.geometry.dispose()
      }
      flightSpritesRef.current = []
    }
  }, [])

  // Parent the echo meshes onto the group once ready.
  useEffect(() => {
    if (!ready || !groupRef.current) return
    const g = groupRef.current
    for (const mesh of echoMeshesRef.current) g.add(mesh)
    return () => { for (const mesh of echoMeshesRef.current) g.remove(mesh) }
  }, [ready])

  useFrame((_, delta) => {
    const state = getObjectState(trackId)
    if (!state || !textureRef.current || !meshRef.current || !groupRef.current) return

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

    const words = parseWords(text)
    if (words.length === 0) { meshRef.current.visible = false; return }

    const currentBeat = useTimeStore.getState().currentBeat
    const now = performance.now() / 1000
    const dt = now - lastFrameTimeRef.current
    lastFrameTimeRef.current = now

    // --- Note-onset detection ---
    const keys = new Set(state.activeNotes.map((n) => `${n.pitch}:${n.beat}`))
    let nextWordOnset = false
    let bassPopOnset = false
    for (const n of state.activeNotes) {
      const k = `${n.pitch}:${n.beat}`
      if (prevKeys.current.has(k)) continue
      if (n.pitch === PITCH_NEXT_WORD) nextWordOnset = true
      else if (n.pitch === PITCH_BASS_POP) bassPopOnset = true
    }
    prevKeys.current = keys

    // Height offset from the latest held 60-72 note.
    let latestHeightPitch = -1
    for (const n of state.activeNotes) {
      if (n.pitch >= PITCH_HEIGHT_MIN && n.pitch <= PITCH_HEIGHT_MAX) {
        latestHeightPitch = Math.max(latestHeightPitch, n.pitch)
      }
    }
    if (latestHeightPitch >= 0) {
      currentYOffsetRef.current = (latestHeightPitch - PITCH_HEIGHT_CENTER) / (PITCH_HEIGHT_MAX - PITCH_HEIGHT_CENTER)
    }

    // Is the word note currently held?
    const isNoteHeld = state.activeNotes.some((n) => n.pitch === PITCH_NEXT_WORD)

    // Rainbow hue cycles on beat subdivisions.
    const rainbowSubdiv = Math.floor(currentBeat * flightSubdivRate)
    const rainbowHue = rainbowEnabled ? ((rainbowSubdiv % rainbowCycleLength) / rainbowCycleLength) * 360 : 0
    const effectiveColor = rainbowEnabled ? hslToHex(rainbowHue, 1, 0.55) : color

    // Advance the word on a new "next word" onset.
    if (nextWordOnset) {
      wordIndexRef.current++
      noteOnTimeRef.current = now
      onsetTimeRef.current = now
      releaseTimeRef.current = -1
    }
    const currentWord = words[(Math.max(1, wordIndexRef.current) - 1) % words.length] ?? words[0]

    if (nextWordOnset) {
      wordHistoryRef.current.push({ word: currentWord, triggerTime: now, duration: 0, yOffset: currentYOffsetRef.current })
    }

    if (bassPopOnset) bassPopTimeRef.current = now

    // Release tracking for fade-out.
    if (!isNoteHeld && releaseTimeRef.current < 0 && noteOnTimeRef.current >= 0) {
      releaseTimeRef.current = now
    }

    // Update duration of the latest history entry while held.
    const history = wordHistoryRef.current
    if (isNoteHeld && history.length > 0 && noteOnTimeRef.current >= 0) {
      history[history.length - 1].duration = now - noteOnTimeRef.current
    } else if (!isNoteHeld && noteOnTimeRef.current >= 0) {
      if (history.length > 0) history[history.length - 1].duration = now - noteOnTimeRef.current
      noteOnTimeRef.current = -1
    }

    // Prune expired history.
    const maxEchoLifetime = delayTaps * delayTime + 10
    wordHistoryRef.current = history.filter((e) => now - e.triggerTime < maxEchoLifetime)

    const baseScale = Math.min(viewport.width, viewport.height) * 0.6 * fontSize

    // Re-render main texture when the word or styling changes.
    const renderKey = `${currentWord}|${strokeWidth}|${family}|${effectiveColor}|${strokeColor}`
    if (renderKey !== lastRenderKeyRef.current) {
      lastRenderKeyRef.current = renderKey
      textureRef.current.image = createTextCanvas(currentWord, strokeWidth, family, effectiveColor, strokeColor)
      textureRef.current.needsUpdate = true
      // Invalidate echo caches so they re-render with new styling.
      echoLastWordsRef.current.fill('')
    }

    // --- Flight mode ---
    if (flightEnabled) {
      const flightSubdiv = Math.floor(currentBeat * flightSubdivRate)
      if (flightSubdiv !== flightLastSubdivRef.current) {
        flightLastSubdivRef.current = flightSubdiv
        if (isNoteHeld && flightSpritesRef.current.length < MAX_FLIGHT_SPRITES) {
          const tex = new CanvasTexture(createTextCanvas(currentWord, strokeWidth, family, effectiveColor, strokeColor))
          tex.minFilter = LinearFilter
          tex.magFilter = LinearFilter
          const mat = new MeshBasicMaterial({ map: tex, transparent: true, opacity: textOpacity, side: DoubleSide, depthWrite: false, toneMapped: false })
          const mesh = new Mesh(new PlaneGeometry(1, 1), mat)
          mesh.position.set(0, currentYOffsetRef.current * viewport.height * heightAmount, 0)
          mesh.scale.setScalar(baseScale)
          groupRef.current.add(mesh)

          const seed = flightSubdiv * 13 + 7
          const pseudoRand = (n: number) => { const x = Math.sin(n * 9301 + 49297) * 233280; return x - Math.floor(x) }
          flightSpritesRef.current.push({
            mesh, texture: tex, birthTime: now,
            vx: (pseudoRand(seed) - 0.5) * flightDrift,
            vy: (pseudoRand(seed + 1) - 0.5) * flightDrift * 0.6,
            tumbleX: (pseudoRand(seed + 2) - 0.5) * flightTumble,
            tumbleY: (pseudoRand(seed + 3) - 0.5) * flightTumble,
            word: currentWord,
          })
        }
      }

      const flightDt = Math.min(dt, 0.05)
      const toRemove: number[] = []
      for (let i = 0; i < flightSpritesRef.current.length; i++) {
        const spr = flightSpritesRef.current[i]
        const m = spr.mesh
        m.position.z -= flightSpeed * flightDt
        m.position.x += spr.vx * flightDt
        m.position.y += spr.vy * flightDt
        m.rotation.x += spr.tumbleX * flightDt
        m.rotation.y += spr.tumbleY * flightDt
        const depth = -m.position.z
        const fadeStart = flightMaxDepth * 0.7
        const mat = m.material as MeshBasicMaterial
        mat.opacity = depth > fadeStart
          ? textOpacity * Math.max(0, 1 - (depth - fadeStart) / (flightMaxDepth - fadeStart))
          : textOpacity
        if (depth > flightMaxDepth) toRemove.push(i)
      }
      for (let i = toRemove.length - 1; i >= 0; i--) {
        const idx = toRemove[i]
        const spr = flightSpritesRef.current[idx]
        groupRef.current.remove(spr.mesh)
        spr.texture.dispose()
        ;(spr.mesh.material as Material).dispose()
        spr.mesh.geometry.dispose()
        flightSpritesRef.current.splice(idx, 1)
      }
    } else if (flightSpritesRef.current.length > 0) {
      for (const spr of flightSpritesRef.current) {
        groupRef.current.remove(spr.mesh)
        spr.texture.dispose()
        ;(spr.mesh.material as Material).dispose()
        spr.mesh.geometry.dispose()
      }
      flightSpritesRef.current = []
    }

    // --- Main mesh ---
    let releaseOpacity = 1
    if (isNoteHeld) {
      releaseOpacity = 1
    } else if (releaseTimeRef.current >= 0) {
      const releaseAge = now - releaseTimeRef.current
      releaseOpacity = releaseDuration > 0 ? Math.max(0, 1 - releaseAge / releaseDuration) : 0
    } else if (wordIndexRef.current === 0) {
      releaseOpacity = 1 // show the first word before any note plays
    }
    meshRef.current.visible = releaseOpacity > 0

    const onsetDuration = 0.12
    const onsetAge = onsetTimeRef.current >= 0 ? now - onsetTimeRef.current : onsetDuration
    const onsetT = Math.min(onsetAge / onsetDuration, 1)
    const onsetScale = 1 + onsetBounce * (1 - onsetT)

    const bassPopDuration = 0.25
    const bassPopAge = bassPopTimeRef.current >= 0 ? now - bassPopTimeRef.current : bassPopDuration
    const bassPopT = Math.min(bassPopAge / bassPopDuration, 1)
    const bassPopDecay = 1 - bassPopT
    const bassPopScale = 1 + 0.25 * bassPopDecay * bassPopDecay
    const shakeFreq = 35
    const shakeAmount = 0.02 * bassPopDecay * bassPopDecay
    const shakeX = Math.sin(bassPopAge * shakeFreq * Math.PI * 2) * shakeAmount * viewport.width
    const shakeY = Math.cos(bassPopAge * shakeFreq * Math.PI * 2 * 0.7) * shakeAmount * viewport.height

    ;(meshRef.current.material as MeshBasicMaterial).opacity = textOpacity * releaseOpacity
    const scale = baseScale * onsetScale * bassPopScale
    meshRef.current.scale.set(scale, scale, 1)
    meshRef.current.position.x = shakeX
    meshRef.current.position.y = currentYOffsetRef.current * viewport.height * heightAmount + shakeY

    // --- Delay taps ---
    for (let tap = 0; tap < MAX_DELAY_TAPS; tap++) {
      const mesh = echoMeshesRef.current[tap]
      if (!mesh) continue
      if (tap >= delayTaps) { mesh.visible = false; continue }

      const tapNum = tap + 1
      const tapOffset = tapNum * delayTime

      let bestEntry: WordHistoryEntry | null = null
      let bestEchoAge = Infinity
      for (let h = history.length - 1; h >= 0; h--) {
        const echoAge = now - (history[h].triggerTime + tapOffset)
        if (echoAge >= 0 && echoAge < bestEchoAge) { bestEntry = history[h]; bestEchoAge = echoAge; break }
      }
      if (!bestEntry) { mesh.visible = false; continue }

      const echoDuration = bestEntry.duration > 0 ? bestEntry.duration : delayTime
      if (bestEchoAge > echoDuration) { mesh.visible = false; continue }

      const tex = echoTexturesRef.current[tap]
      const echoKey = `${bestEntry.word}|${effectiveColor}|${strokeColor}`
      if (echoKey !== echoLastWordsRef.current[tap]) {
        tex.image = createTextCanvas(bestEntry.word, strokeWidth, family, effectiveColor, strokeColor)
        tex.needsUpdate = true
        echoLastWordsRef.current[tap] = echoKey
      }

      const tapScale = baseScale * Math.max(0.1, 1 - delayScaleFalloff * tapNum)
      mesh.scale.set(tapScale, tapScale, 1)
      mesh.position.x = pingPongEnabled ? (tapNum % 2 === 1 ? -1 : 1) * pingPongWidth * viewport.width * 0.5 : 0
      mesh.position.y = bestEntry.yOffset * viewport.height * heightAmount
      mesh.position.z = -0.01 * tapNum
      ;(mesh.material as MeshBasicMaterial).opacity = Math.max(0.01, 1 - delayOpacityFalloff * tapNum) * textOpacity
      mesh.visible = true
    }
  })

  if (!ready) return null

  return (
    <group ref={groupRef}>
      <mesh ref={meshRef}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial map={textureRef.current} transparent depthWrite={false} />
      </mesh>
    </group>
  )
}

export const textDisplayInstrument: ObjectInstrumentDef = {
  id: 'textDisplay',
  name: 'Text Display',
  kind: 'object',
  params: PARAMS,
  ports: PORTS,
  component: TextDisplayVisual,
  fullFrame: true,
}
