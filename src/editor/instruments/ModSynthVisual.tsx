import { useContext, useEffect, useMemo, useRef } from 'react'
import {
  AdditiveBlending, BoxGeometry, Color, InstancedBufferAttribute, InstancedMesh,
  MeshBasicMaterial, Object3D,
} from 'three'
import { useInstrumentFrame } from '../core/visual/instrumentFrame'
import { InstrumentCopyContext } from '../core/visual/instrumentColor'
import { applyColorShiftToColor } from '../core/visual/colorShift'
import { getVisualCopy } from '../core/visual/VisualEngine'
import { rotateHueOklabLinearRgb } from '../utils/oklch'
import { MOD_SYNTH_DEFAULT_COLOR } from './ModSynth'
import {
  DEFAULT_SYNTH_MODS, MAX_SYNTH_VOICES, computeSynthVoice, synthVoiceSpanBeats,
  type SynthVoiceChannels,
} from './modSynthCore'

// The Mod Synth's mesh pool - ParticleBurst's recipe: ONE InstancedMesh sized
// for the voice budget, voices derived from the note stream each frame (pure
// function of state.beat, so pause/scrub/export agree), fades encoded into the
// instance COLOR under additive blending (instanceColor is RGB-only - see the
// per-instance-opacity note in this directory's CLAUDE.md).

const MIN_SOUNDING = 1 / 32

const _voice: SynthVoiceChannels = { size: 0, posX: 0, posY: 0, posZ: 0, alpha: 0, hue: 0, rotZ: 0 }

export function ModSynthVisual({ trackId }: { trackId: string }) {
  const meshRef = useRef<InstancedMesh>(null)
  const copyContext = useContext(InstrumentCopyContext)
  const dummy = useMemo(() => new Object3D(), [])
  const baseColor = useMemo(() => new Color(), [])
  const voiceColor = useMemo(() => new Color(), [])
  const scratchTint = useMemo(() => new Color(), [])

  const geometry = useMemo(() => {
    const g = new BoxGeometry(1, 1, 1)
    g.setAttribute('color', new InstancedBufferAttribute(new Float32Array(MAX_SYNTH_VOICES * 3), 3))
    return g
  }, [])
  const material = useMemo(() => new MeshBasicMaterial({
    vertexColors: true, toneMapped: false, transparent: true,
    blending: AdditiveBlending, depthWrite: false,
  }), [])
  useEffect(() => () => { geometry.dispose(); material.dispose() }, [geometry, material])

  useInstrumentFrame(trackId, (state) => {
    const mesh = meshRef.current
    if (!mesh) return false

    const mods = state.synthMods ?? DEFAULT_SYNTH_MODS
    baseColor.set(state.stringParams.color || MOD_SYNTH_DEFAULT_COLOR)
    // Per-copy colorizer/mover shifts land on the base, exactly as they would
    // on a declared color param.
    const vc = copyContext ? getVisualCopy(trackId, copyContext.visualCopyIndex) : undefined
    if (vc) applyColorShiftToColor(baseColor, vc.colorShift, scratchTint)
    // Visibility/mover fades scale the emitted color (LaserLine's rule: under
    // additive blending + bloom, alpha alone snaps - energy must fall too).
    const fade = Math.max(0, Math.min(1, state.opacity * (vc?.opacity ?? 1)))
    if (fade <= 0.001) { mesh.count = 0; return }

    const colorAttr = mesh.geometry.getAttribute('color') as InstancedBufferAttribute
    const colors = colorAttr.array as Float32Array
    let cursor = 0
    const notes = state.notes
    // Walk newest-first so when the pool fills it is the OLDEST voices - the
    // ones about to die - that drop, never the newborn.
    for (let i = notes.length - 1; i >= 0 && cursor < MAX_SYNTH_VOICES; i--) {
      const n = notes[i]
      if (n.beat > state.beat) continue
      const age = state.beat - n.beat
      const dur = n.durationBeats || MIN_SOUNDING
      if (age >= synthVoiceSpanBeats(mods, dur)) continue
      computeSynthVoice(mods, age, dur, n.velocity, n.pitch, _voice)
      const alpha = _voice.alpha * fade
      const scale = _voice.size
      if (alpha < 0.004 || scale < 0.001) continue

      dummy.position.set(_voice.posX, _voice.posY, _voice.posZ)
      dummy.rotation.set(0, 0, _voice.rotZ * Math.PI * 2)
      dummy.scale.setScalar(scale)
      dummy.updateMatrix()
      mesh.setMatrixAt(cursor, dummy.matrix)

      voiceColor.copy(baseColor)
      if (_voice.hue) rotateHueOklabLinearRgb(voiceColor, _voice.hue)
      colors[cursor * 3] = voiceColor.r * alpha
      colors[cursor * 3 + 1] = voiceColor.g * alpha
      colors[cursor * 3 + 2] = voiceColor.b * alpha
      cursor++
    }

    mesh.count = cursor
    mesh.instanceMatrix.needsUpdate = true
    colorAttr.needsUpdate = true
  })

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, MAX_SYNTH_VOICES]}
      frustumCulled={false}
    />
  )
}
