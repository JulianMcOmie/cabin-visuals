import { getInstrument } from '../../instruments'

/** Renders one object's visual, resolved from the instrument registry by id. The
 *  component pulls its per-frame state by trackId from the engine. */
export function ObjectRenderer({ trackId, instrumentId }: { trackId: string; instrumentId: string }) {
  const def = getInstrument(instrumentId)
  if (!def) return null
  const Component = def.component
  return <Component trackId={trackId} />
}
