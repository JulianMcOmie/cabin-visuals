// The pure half of Shift-hover picking in the visualizer (see hoverTargets.ts
// for the registry and CanvasHoverPicker for the pointer plumbing). Kept free
// of three/React so the layer remap and the hit ranking are unit-testable.

/** The slice of a CompositionLayer the picker needs. */
export interface PickLayer {
  sceneId: string
  /** Normalized viewport in final-frame coordinates, y up from the bottom. */
  viewport: { x: number; y: number; width: number; height: number }
}

/** A composited scene under the pointer plus the pointer expressed in that
 *  scene's own camera NDC. Layers are stacked in array order (last on top),
 *  so candidates come back TOPMOST FIRST - the caller raycasts each in turn
 *  and takes the first that actually hits something. */
export interface LayerCandidate {
  sceneId: string
  ndcX: number
  ndcY: number
}

/**
 * Which composited layers sit under canvas point (nx, ny) (both 0..1, ny up
 * from the bottom), and where the pointer lands in each layer's own frame.
 * A layer's scene renders at full canvas aspect and is squashed into its
 * viewport rect by the compositor, so the remap is the plain rect-local
 * fraction - exactly the mapping applyCompositorLayer's quad performs.
 * Partitioned (Cut) layers report a full-frame viewport, so all of them
 * qualify and the topmost wins; the mask itself is not evaluated (v1).
 */
export function layersUnderPoint(layers: readonly PickLayer[], nx: number, ny: number): LayerCandidate[] {
  const out: LayerCandidate[] = []
  for (let i = layers.length - 1; i >= 0; i--) {
    const { sceneId, viewport: vp } = layers[i]
    if (vp.width <= 0 || vp.height <= 0) continue
    if (nx < vp.x || nx > vp.x + vp.width || ny < vp.y || ny > vp.y + vp.height) continue
    const u = (nx - vp.x) / vp.width
    const v = (ny - vp.y) / vp.height
    out.push({ sceneId, ndcX: u * 2 - 1, ndcY: v * 2 - 1 })
  }
  return out
}

/** Which render pass a hit's root lives in. Front and invert passes are
 *  depth-cleared and drawn OVER the base pass, so a hit there wins outright
 *  regardless of distance. */
export type HitPass = 'base' | 'front' | 'invert'

export interface RankedHit {
  trackId: string
  distance: number
  pass: HitPass
  /** A viewport-filling plane (Text overlay, Video, Film Stock...): covers every
   *  pixel, so it only wins when no real object is under the pointer. */
  fullFrame: boolean
}

const PASS_RANK: Record<HitPass, number> = { invert: 0, front: 1, base: 2 }

/** The hit the pointer "means": real objects before full-frame planes, the
 *  over-drawn passes before the base pass, nearest within a pass. Null when
 *  nothing was hit. */
export function bestHit(hits: readonly RankedHit[]): RankedHit | null {
  let best: RankedHit | null = null
  for (const hit of hits) {
    if (!best) { best = hit; continue }
    if (hit.fullFrame !== best.fullFrame) {
      if (!hit.fullFrame) best = hit
      continue
    }
    const rank = PASS_RANK[hit.pass] - PASS_RANK[best.pass]
    if (rank < 0 || (rank === 0 && hit.distance < best.distance)) best = hit
  }
  return best
}
