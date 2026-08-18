// The one list of frame shapes the product knows about. Two surfaces read it:
// the export dialog (what you RELEASE in) and the editor's preview pin (what
// you COMPOSE against) - they must agree, or pinning the viewport stops
// previewing the export. React-free so the store, the export island and the
// tests can all import it.

/** Frame shape, written the way the UI spells it (width:height). */
export type AspectRatioId = '16:9' | '2:1' | '4:3' | '1:1' | '9:16' | '4:5'

/** Widest → narrowest. This IS the picker order on both surfaces. */
export const ASPECT_RATIO_IDS: readonly AspectRatioId[] = ['16:9', '2:1', '4:3', '1:1', '9:16', '4:5']

/** width / height. Landscape > 1, portrait < 1. */
const RATIOS: Record<AspectRatioId, number> = {
  '16:9': 16 / 9,
  '2:1': 2,
  '4:3': 4 / 3,
  '1:1': 1,
  '9:16': 9 / 16,
  '4:5': 4 / 5,
}

export function aspectRatioValue(id: AspectRatioId): number {
  return RATIOS[id]
}

/** Pixel dimensions for an aspect at a tier, where the tier names its SHORT
 *  edge (1080p = 1080 tall in landscape, 1080 wide in portrait). So a 2:1
 *  "1080p" is 2160×1080 - the way people say it - rather than a 1920-wide
 *  frame with the height cropped away. Both axes land even: H.264 chroma
 *  subsampling needs it, and odd sizes get silently padded by encoders. */
export function frameSizeFor(id: AspectRatioId, shortEdge: number): { width: number; height: number } {
  const ratio = RATIOS[id]
  const even = (n: number) => Math.round(n / 2) * 2
  return ratio >= 1
    ? { width: even(shortEdge * ratio), height: even(shortEdge) }
    : { width: even(shortEdge), height: even(shortEdge / ratio) }
}
