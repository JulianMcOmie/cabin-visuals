import type { FC } from 'react'
import { Cube } from '../../instruments/Cube'

// Maps an instrument id to its visual component. Commit 2 moves this into the
// instrument registry / def; for the skeleton a tiny map keeps it concrete.
const OBJECT_COMPONENTS: Record<string, FC<{ trackId: string }>> = {
  cube: Cube,
}

/** Renders one object's visual; the component pulls its per-frame state by trackId. */
export function ObjectRenderer({ trackId, instrumentId }: { trackId: string; instrumentId: string }) {
  const Component = OBJECT_COMPONENTS[instrumentId]
  return Component ? <Component trackId={trackId} /> : null
}
