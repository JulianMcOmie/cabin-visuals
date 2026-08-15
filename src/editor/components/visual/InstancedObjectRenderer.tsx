import { Fragment } from 'react'
import { getInstrument } from '../../instruments'
import { isFullFrameTrack } from '../../instruments/types'
import { useProjectStore } from '../../store/ProjectStore'
import type { ObjectListEntry } from '../../core/visual/VisualEngine'
import { ObjectRenderer } from './ObjectRenderer'

/**
 * One mount per TRACK for instruments that declare `instancedComponent`:
 * the component draws every VisualCopy occurrence itself through
 * useInstancedCopyFrame, so a 400-copy splitter is one draw call and one
 * React subtree instead of 400 of each.
 *
 * The per-copy path stays the source of truth for everything it alone can do,
 * and this component's ONLY job besides mounting the instanced component is
 * deciding when the track still needs it. Fallback triggers (each carries
 * per-occurrence machinery the instanced path does not reproduce):
 * - ANY effect instance on the track or a group ancestor - transform effects
 *   wrap per-copy groups, material effects patch per-mesh materials, shader
 *   effects render each occurrence offscreen, and even a disabled instance
 *   can be switched on by an `enabled` automation lane, so presence alone
 *   falls back (conservative on purpose; the Scale effect could be composed
 *   later if profiling says it matters).
 * - A routed crop mask (maskSourceIds) - needs the occurrence's pixels
 *   isolated in the ShaderWrapper path.
 * - Full-frame mode - screen-anchored planes never instanced.
 * The decision is structural (store subscriptions), never per frame, so
 * flipping an effect on remounts the track's copies once, like any resolve.
 */
export function InstancedObjectRenderer({
  sceneId,
  trackId,
  instrumentId,
  entries,
  keySuffix,
}: {
  sceneId: string
  trackId: string
  instrumentId: string
  /** This track's contiguous slice of the object list (one entry per copy). */
  entries: readonly ObjectListEntry[]
  /** The pass the entries render in ('' base / ':front' / ':invert') - keeps
   *  fallback keys byte-identical to the ungrouped mounts. */
  keySuffix: string
}) {
  const def = getInstrument(instrumentId)
  const hasEffects = useProjectStore((s) => {
    const tracks = s.scenes[sceneId]?.tracks
    if ((tracks?.[trackId]?.effects?.length ?? 0) > 0) return true
    for (let cur = tracks?.[trackId]?.parentId; cur != null; cur = tracks?.[cur]?.parentId) {
      const t = tracks?.[cur]
      if (t?.type === 'group' && t.effects?.length) return true
    }
    return false
  })
  const modeParams = useProjectStore((s) => def?.fullFrameParam
    ? s.scenes[sceneId]?.tracks[trackId]?.params
    : undefined)
  if (!def) return null
  const Instanced = def.instancedComponent
  const masked = entries.some((o) => o.maskSourceIds.length > 0)
  if (!Instanced || hasEffects || masked || isFullFrameTrack(def, modeParams)) {
    return (
      <Fragment>
        {entries.map((o) => (
          <ObjectRenderer
            key={`${o.trackId}:${o.visualCopyIndex}${keySuffix}`}
            sceneId={o.sceneId}
            trackId={o.trackId}
            instrumentId={o.instrumentId}
            visualCopyIndex={o.visualCopyIndex}
            maskSourceIds={o.maskSourceIds}
          />
        ))}
      </Fragment>
    )
  }
  return <Instanced trackId={trackId} />
}
