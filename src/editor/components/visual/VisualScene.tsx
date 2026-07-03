import { useSyncExternalStore } from 'react'
import { subscribeObjects, getObjectList } from '../../core/visual/VisualEngine'
import { ObjectRenderer } from './ObjectRenderer'

/**
 * One <ObjectRenderer> per resolved object. Re-renders only when the object list
 * changes (on resolve), never per frame — per-frame values are pulled imperatively
 * inside each renderer. getObjectList returns a stable reference between resolves,
 * so useSyncExternalStore doesn't loop.
 */
export function VisualScene() {
  const objects = useSyncExternalStore(subscribeObjects, getObjectList, getObjectList)
  return (
    <>
      {objects.map((o) => (
        <ObjectRenderer key={o.trackId} trackId={o.trackId} instrumentId={o.instrumentId} />
      ))}
    </>
  )
}
