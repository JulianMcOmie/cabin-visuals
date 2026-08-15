import { createContext, useContext, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Color, Matrix4 } from 'three'
import { getObjectState, getVisualCopies } from './VisualEngine'
import { applyColorShiftToColor } from './instrumentColor'
import { getBeatOverride } from './beatOverride'
import { composePostMoverScale, evaluatePostMoverScale } from './postMoverScale'
import { useTimeStore } from '../../store/TimeStore'
import type { ObjectState } from './types'
import type { VisualCopy } from '../visualCopies/types'
import type { EffectInstance } from '../../types'

/** The track's Scale effect instances, provided by InstancedObjectRenderer so
 *  composeCopyMatrix can lift them outside the copy transform exactly like the
 *  per-copy path does (postMoverScale.ts). Scale is the ONE effect the
 *  instanced path admits - anything else still falls back per copy. */
export const InstancedScaleContext = createContext<readonly EffectInstance[]>([])

/**
 * The instanced counterpart of useInstrumentFrame: ONE mount per track drives
 * every VisualCopy occurrence by writing per-instance buffers, instead of N
 * mounted components each composing its own scene-graph nodes. An instrument
 * opts in by declaring `instancedComponent` on its def (instruments/types.ts);
 * the component owns its InstancedMesh2 objects and this hook feeds it the
 * per-copy placement/fade/color that ObjectRenderer's useFrame + the
 * InstrumentCopyContext path used to deliver per occurrence.
 *
 * Deliberately NO signature skip, unlike useInstrumentFrame: copy transforms
 * are refreshed imperatively by computeAtBeat and are not identity-comparable
 * inputs, so a skip here would eat paused mover-knob drags (the exact class of
 * bug the "params do nothing until remount" war story documents). The work is
 * one loop over the copy pool per track per rendered frame - the same order of
 * work the old path did across N useFrames, minus the React/scene-graph tax.
 * RenderGovernor still gates how often frames render while paused.
 *
 * Purity holds: everything the callback can read is engine state that is
 * already a pure function of the beat. No clock, no delta.
 */
export interface InstancedCopyFrame {
  state: ObjectState
  copies: readonly VisualCopy[]
  /** `world × scaleEffect × copyTransform × meshScale` for copy i - the exact
   *  matrix the per-copy path's placement group wears (Scale effects arrive
   *  through InstancedScaleContext; every other effect falls back per copy). */
  composeCopyMatrix(i: number, out: Matrix4): Matrix4
  /** `state.opacity × copy.opacity`, 0 while blacked out. Instances at ≤0.001
   *  must be hidden, not faded - the ghost-wall depth artifact. */
  copyFade(i: number): number
  /** The copy's colorShift applied to a '#rrggbb' source, written into out.
   *  Same math as the string-param path (applyColorShiftToColor). */
  copyColor(i: number, sourceHex: string, out: Color): Color
}

const _scale = new Matrix4()

export function useInstancedCopyFrame(
  trackId: string,
  cb: (frame: InstancedCopyFrame) => void,
): void {
  const frameRef = useRef<InstancedCopyFrame | null>(null)
  const scratchTint = useRef(new Color()).current
  const scaleInstances = useContext(InstancedScaleContext)
  const effectScaleRef = useRef(1)
  useFrame(() => {
    const state = getObjectState(trackId)
    if (!state) return
    const copies = getVisualCopies(trackId)
    // Same beat source as ObjectRenderer's scale evaluation: the REAL playhead
    // (or export override), not the object's warped beat.
    effectScaleRef.current = scaleInstances.length === 0 ? 1 : evaluatePostMoverScale(
      scaleInstances,
      state.effectOverrides,
      getBeatOverride() ?? useTimeStore.getState().currentBeat,
    )
    let frame = frameRef.current
    if (!frame) {
      frame = {
        state,
        copies,
        composeCopyMatrix(i, out) {
          const f = frameRef.current as InstancedCopyFrame
          composePostMoverScale(f.state.world, f.copies[i]?.transform, effectScaleRef.current, out)
          const s = f.state.meshScale
          if (s !== 1) out.multiply(_scale.makeScale(s, s, s))
          return out
        },
        copyFade(i) {
          const f = frameRef.current as InstancedCopyFrame
          if (f.state.blackedOut) return 0
          return f.state.opacity * (f.copies[i]?.opacity ?? 1)
        },
        copyColor(i, sourceHex, out) {
          const f = frameRef.current as InstancedCopyFrame
          out.set(sourceHex)
          const shift = f.copies[i]?.colorShift
          if (shift) applyColorShiftToColor(out, shift, scratchTint)
          return out
        },
      }
      frameRef.current = frame
    }
    frame.state = state
    frame.copies = copies
    cb(frame)
  })
}
