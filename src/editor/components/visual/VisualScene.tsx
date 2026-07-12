import { useSyncExternalStore } from 'react'
import { Hud } from '@react-three/drei'
import { subscribeObjects, getObjectList } from '../../core/visual/VisualEngine'
import { useProjectStore } from '../../store/ProjectStore'
import { getInstrument } from '../../instruments'
import { ObjectRenderer } from './ObjectRenderer'

/**
 * One <ObjectRenderer> per resolved object. Re-renders only when the object list
 * changes (on resolve) or a track's "In front" flag flips, never per frame -
 * per-frame values are pulled imperatively inside each renderer. getObjectList
 * returns a stable reference between resolves, so useSyncExternalStore doesn't loop.
 *
 * "In front" tracks render in a SECOND PASS (drei's Hud: same camera, depth
 * buffer cleared, drawn after the whole main scene) - a hard guarantee that
 * they sit on top of everything, including shader-effect overlays, instead of
 * competing on renderOrder/material sort minutiae. Within the front pass the
 * objects depth-test among themselves like a normal scene.
 */
export function VisualScene() {
  // One entry per VisualCopy occurrence (structural: changes on resolve only).
  const objects = useSyncExternalStore(subscribeObjects, getObjectList, getObjectList)
  // One char per occurrence: '1' = in front. A string so the zustand selector is
  // reference-stable and this only re-renders when a flag actually flips. The
  // flag is per TRACK, so it applies to every one of the track's occurrences.
  const onTopKey = useProjectStore((s) =>
    objects
      .map((o) => ((s.tracks[o.trackId]?.onTop ?? getInstrument(o.instrumentId)?.defaultOnTop ?? false) ? '1' : '0'))
      .join(''),
  )

  const scene = objects.filter((_, i) => onTopKey[i] !== '1')
  const front = objects.filter((_, i) => onTopKey[i] === '1')

  return (
    <>
      {scene.map((o) => (
        <ObjectRenderer
          key={`${o.trackId}:${o.visualCopyIndex}`}
          trackId={o.trackId}
          instrumentId={o.instrumentId}
          visualCopyIndex={o.visualCopyIndex}
        />
      ))}
      {front.length > 0 && (
        <Hud renderPriority={1}>
          {/* The Hud portal is its own scene - it inherits the main camera but
              not the lights, so the canvas light rig (App.tsx) is mirrored here. */}
          <ambientLight intensity={0.5} />
          <directionalLight position={[4, 6, 4]} intensity={1.4} />
          <pointLight position={[-4, -2, 3]} color="#818cf8" intensity={3} />
          <pointLight position={[3, 3, -4]} color="#f0abfc" intensity={1.5} />
          {front.map((o) => (
            <ObjectRenderer
              key={`${o.trackId}:${o.visualCopyIndex}`}
              trackId={o.trackId}
              instrumentId={o.instrumentId}
              visualCopyIndex={o.visualCopyIndex}
            />
          ))}
        </Hud>
      )}
    </>
  )
}
