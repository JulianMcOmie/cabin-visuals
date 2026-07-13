import { useRef } from 'react'
import { useThree } from '@react-three/fiber'
import { PerspectiveCamera, Vector3 } from 'three'
import { useInstrumentFrame } from '../core/visual/instrumentFrame'
import type { ObjectInstrumentDef, ParamDef } from './types'

// Ported from Excellent DAW's `cameraControl`. This instrument renders NO mesh - it
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
// fov 55), so nothing else writes the camera each frame - this instrument owns it while
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
// The old cap on concurrent hits (kept so dense passages don't stack unbounded punch).
const MAX_HITS = 8

function CameraControlVisual({ trackId }: { trackId: string }) {
  const { camera } = useThree()
  const lookTarget = useRef(new Vector3(0, 0, 0))

  useInstrumentFrame(trackId, (state) => {
    const p = state.params

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

    // Energy (the note-pulse) adds a subtle dolly-in; the old scale/hue ports are retired.
    const energy = state.energy
    const scalePort = 0
    const huePort = 0

    // Accumulate the decaying impulse purely from the playhead: a note "hits" while
    // its beat-age (in seconds) is inside the punch window, so paused = static frame
    // and scrub == playback. Notes are sorted by beat - walk backwards from the
    // playhead and stop past the window (or after the most recent MAX_HITS, matching
    // the old cap).
    let punch = 0
    let shakeX = 0
    let shakeY = 0
    if (punchAmount > 0 || shakeAmount > 0) {
      const notes = state.notes
      let hits = 0
      for (let i = notes.length - 1; i >= 0; i--) {
        const n = notes[i]
        const ageSec = (state.beat - n.beat) * state.secPerBeat
        if (ageSec < 0) continue // not struck yet
        if (ageSec > punchDecay) break // sorted: everything earlier is older still
        const velocity = clamp(n.velocity <= 1 ? n.velocity : n.velocity / 127, 0.05, 1)
        const env = easeOutDecay(ageSec / punchDecay) * velocity
        punch += env
        // Deterministic per-hit shake direction from pitch, oscillating on the hit's
        // beat-age (anchored at onset), decaying with the envelope.
        shakeX += Math.sin(n.pitch * 1.7 + ageSec * 12) * env
        shakeY += Math.cos(n.pitch * 2.3 + ageSec * 9) * env
        if (++hits >= MAX_HITS) break
      }
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
  userInterfaceRenderer: 'parameters',
  params: PARAMS,
  midiRows: [
    { pitch: 76, label: 'Camera punch · max', emphasized: true },
    { pitch: 68, label: 'Camera punch · strong' },
    { pitch: 60, label: 'Camera punch · medium' },
    { pitch: 52, label: 'Camera punch · soft' },
    { pitch: 44, label: 'Camera punch · gentle' },
    { pitch: 38, label: 'Camera punch · snare accent' },
    { pitch: 36, label: 'Camera punch · kick accent' },
  ],
  component: CameraControlVisual,
}
