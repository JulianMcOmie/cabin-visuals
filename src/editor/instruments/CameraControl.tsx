import { useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { PerspectiveCamera, Vector3 } from 'three'
import { getObjectState } from '../core/engine/VisualEngine'
import { useTimeStore } from '../store/TimeStore'
import type { ObjectInstrumentDef, ParamDef, PortDef } from './types'

// Ported from Excellent DAW's `cameraControl`. This instrument renders NO mesh — it
// drives the scene camera (position / rotation / fov) each frame from its params.
// Tyler's core is a static param→camera write (posX/Y/Z, rotX/Y/Z deg, fov); add
// automation tracks to animate those params over time, exactly as his description says.
//
// Extension for our engine: notes give the camera a life. Each note onset fires a
// velocity-scaled "punch" impulse (a brief dolly-in + rotational shake) that decays
// with a smooth ease, so the camera reacts to the music. `energy`/`scale`/`hue` ports
// and a look-mode select round it out.
//
// NOTE: our scene has no OrbitControls (Canvas uses a default camera at [0,1.2,5],
// fov 55), so nothing else writes the camera each frame — this instrument owns it while
// active. It's opt-in; if a user later adds orbit controls the two would conflict, which
// is acceptable. Guarded against a non-perspective camera so it never crashes.

const DEG = Math.PI / 180
const DEFAULTS = { posX: 0, posY: 1.2, posZ: 5, rotX: 0, rotY: 0, rotZ: 0, fov: 55 }

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))
// Smooth exponential-ish decay used for the note punch envelope (Tyler-style easing).
const easeOutDecay = (t: number) => Math.pow(1 - clamp(t, 0, 1), 2)

const PARAMS: ParamDef[] = [
  { key: 'posX', label: 'Position X', min: -50, max: 50, step: 0.5, default: DEFAULTS.posX },
  { key: 'posY', label: 'Position Y', min: -50, max: 50, step: 0.5, default: DEFAULTS.posY },
  { key: 'posZ', label: 'Position Z', min: -50, max: 50, step: 0.5, default: DEFAULTS.posZ },
  { key: 'rotX', label: 'Rotation X', min: -180, max: 180, step: 5, default: DEFAULTS.rotX },
  { key: 'rotY', label: 'Rotation Y', min: -180, max: 180, step: 5, default: DEFAULTS.rotY },
  { key: 'rotZ', label: 'Rotation Z', min: -180, max: 180, step: 5, default: DEFAULTS.rotZ },
  { key: 'fov', label: 'Field of View', min: 10, max: 120, step: 5, default: DEFAULTS.fov },
  {
    key: 'lookMode', type: 'select', label: 'Aim', default: 0,
    options: [
      { value: 0, label: 'Free (use rotation)' },
      { value: 1, label: 'Look at origin' },
    ],
  },
  { key: 'punchAmount', label: 'Note Punch', min: 0, max: 4, step: 0.05, default: 0 },
  { key: 'punchDecay', label: 'Punch Decay (s)', min: 0.05, max: 3, step: 0.05, default: 0.5 },
  { key: 'shakeAmount', label: 'Note Shake (deg)', min: 0, max: 20, step: 0.25, default: 0 },
]
const PORTS: PortDef[] = [
  { key: 'energy', label: 'Energy', combine: 'add', default: 0 },
  { key: 'scale', label: 'Scale', combine: 'add', default: 0 },
  { key: 'hue', label: 'Hue', combine: 'add', default: 0 },
]

interface CamHit { time: number; velocity: number; pitch: number }

function CameraControlVisual({ trackId }: { trackId: string }) {
  const { camera } = useThree()
  const prevKeys = useRef<Set<string>>(new Set())
  const hitsRef = useRef<CamHit[]>([])
  const lookTarget = useRef(new Vector3(0, 0, 0))

  useFrame(() => {
    const state = getObjectState(trackId)
    if (!state) return
    const p = state.params
    const ports = state.portValues

    const posX = p.posX ?? DEFAULTS.posX
    const posY = p.posY ?? DEFAULTS.posY
    const posZ = p.posZ ?? DEFAULTS.posZ
    const rotX = p.rotX ?? DEFAULTS.rotX
    const rotY = p.rotY ?? DEFAULTS.rotY
    const rotZ = p.rotZ ?? DEFAULTS.rotZ
    const fov = p.fov ?? DEFAULTS.fov
    const lookAtOrigin = (p.lookMode ?? 0) >= 0.5
    const punchAmount = p.punchAmount ?? 0
    const punchDecay = Math.max(0.05, p.punchDecay ?? 0.5)
    const shakeAmount = p.shakeAmount ?? 0

    // Ports: energy adds a subtle dolly-in, scale nudges fov, hue is a slow orbital drift.
    const energy = ports.energy ?? 0
    const scalePort = ports.scale ?? 0
    const huePort = ports.hue ?? 0

    const now = performance.now() / 1000

    // Register a punch on each new note onset (`${pitch}:${beat}` over activeNotes).
    const keys = new Set(state.activeNotes.map((n) => `${n.pitch}:${n.beat}`))
    if (punchAmount > 0 || shakeAmount > 0) {
      for (const n of state.activeNotes) {
        const key = `${n.pitch}:${n.beat}`
        if (prevKeys.current.has(key)) continue
        const velocity = clamp(n.velocity <= 1 ? n.velocity : n.velocity / 127, 0.05, 1)
        hitsRef.current.push({ time: now, velocity, pitch: n.pitch })
      }
    }
    prevKeys.current = keys
    hitsRef.current = hitsRef.current.filter((h) => now - h.time <= punchDecay).slice(-8)

    // Accumulate the decaying impulse across live hits.
    let punch = 0
    let shakeX = 0
    let shakeY = 0
    for (const h of hitsRef.current) {
      const env = easeOutDecay((now - h.time) / punchDecay) * h.velocity
      punch += env
      // Deterministic per-hit shake direction from pitch, decaying with the envelope.
      shakeX += Math.sin(h.pitch * 1.7 + now * 12) * env
      shakeY += Math.cos(h.pitch * 2.3 + now * 9) * env
    }

    // Slow hue-driven orbital drift + energy dolly.
    const drift = huePort * Math.PI * 2
    const orbitR = 0
    const dolly = energy * 1.5 + punch * punchAmount
    const px = posX + Math.sin(drift) * orbitR
    const pz = posZ - dolly + Math.cos(drift) * orbitR
    camera.position.set(px, posY, pz)

    if (lookAtOrigin) {
      camera.lookAt(lookTarget.current)
    } else {
      camera.rotation.set(rotX * DEG, rotY * DEG, rotZ * DEG)
    }
    // Additive note shake on top of the aim.
    camera.rotation.x += shakeX * shakeAmount * DEG
    camera.rotation.y += shakeY * shakeAmount * DEG

    if (camera instanceof PerspectiveCamera) {
      const targetFov = clamp(fov + scalePort * 20, 1, 179)
      if (camera.fov !== targetFov) {
        camera.fov = targetFov
        camera.updateProjectionMatrix()
      }
    }
  })

  return null
}

export const cameraControlInstrument: ObjectInstrumentDef = {
  id: 'cameraControl',
  name: 'Camera',
  kind: 'object',
  params: PARAMS,
  ports: PORTS,
  component: CameraControlVisual,
}
