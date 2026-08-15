import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Color, Matrix4 } from 'three'
import { getObjectState, getVisualCopies } from './VisualEngine'
import { applyColorShiftToColor } from './instrumentColor'
import type { ObjectState } from './types'
import type { VisualCopy } from '../visualCopies/types'

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
  /** `world × copyTransform × meshScale` for copy i - the exact matrix the
   *  per-copy path's placement group wears (postMoverScale absent by
   *  construction: tracks with effects fall back to the per-copy path). */
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
  useFrame(() => {
    const state = getObjectState(trackId)
    if (!state) return
    const copies = getVisualCopies(trackId)
    let frame = frameRef.current
    if (!frame) {
      frame = {
        state,
        copies,
        composeCopyMatrix(i, out) {
          const f = frameRef.current as InstancedCopyFrame
          out.copy(f.state.world)
          const copy = f.copies[i]
          if (copy) out.multiply(copy.transform)
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
