// CSS pixels on either side of a boundary, independent of timeline zoom.
const LOOP_EDGE_RADIUS_PX = 7

type LoopHit = 'create' | 'move' | 'start' | 'end'

export function hitLoopRegion(
  x: number,
  region: { startBeat: number; endBeat: number; enabled: boolean } | null,
  pixelsPerBeat: number,
): LoopHit {
  if (!region?.enabled) return 'create'
  const start = region.startBeat * pixelsPerBeat
  const end = region.endBeat * pixelsPerBeat
  const startDistance = Math.abs(x - start)
  const endDistance = Math.abs(x - end)
  // Narrow loops can have overlapping targets. Choose the nearest boundary
  // instead of letting DOM paint order make one edge impossible to grab.
  if (Math.min(startDistance, endDistance) <= LOOP_EDGE_RADIUS_PX) {
    return startDistance <= endDistance ? 'start' : 'end'
  }
  return x >= start && x <= end ? 'move' : 'create'
}
