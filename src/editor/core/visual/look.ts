// The frame's LOOK: the final grade and bloom, overridable per frame from code.
// Code instruments return a look (spec.look) while their scene is on screen;
// a code composition sets one for the frame (ctx.look) and wins. VisualScene
// applies the merged result to the bloom and the final grade shader - with
// nothing set, every value is the grade's literal default, so the output is
// unchanged.

export interface Look {
  /** Bloom added in the final pass (default 0.9). */
  bloom?: number
  /** Luminance above which things bloom (default 1.15 - HDR only). */
  bloomThreshold?: number
  /** Mip-blur spread 0..1 (default 0.72). */
  bloomRadius?: number
  /** Linear exposure multiply before tone mapping (default 1). */
  exposure?: number
  /** Saturation (default 1.08). */
  saturation?: number
  /** Contrast about mid-grey (default 1.045). */
  contrast?: number
  /** Vignette floor: corner brightness 0..1 (default 0.82; 1 = none). */
  vignette?: number
  /** Film grain amount (default 0.014). */
  grain?: number
  /** Chromatic aberration in pixels at the frame edge (default 0). */
  aberration?: number
  /** Multiply tint (linear RGB, default [1, 1, 1]). */
  tint?: [number, number, number]
  /** Fade to this colour, 0..1 (default 0) - the cheapest dip-to-black/white. */
  fade?: number
  fadeColor?: [number, number, number]
}

export const DEFAULT_LOOK: Required<Look> = {
  bloom: 0.9, bloomThreshold: 1.15, bloomRadius: 0.72, exposure: 1, saturation: 1.08, contrast: 1.045,
  vignette: 0.82, grain: 0.014, aberration: 0, tint: [1, 1, 1], fade: 0, fadeColor: [0, 0, 0],
}

const trackLooks = new Map<string, Look>()
let compositionLook: Look | null = null

/** A code instrument's look while its track is on screen (null clears it). */
export function setTrackLook(trackId: string, look: Look | null) {
  if (look) trackLooks.set(trackId, look)
  else trackLooks.delete(trackId)
}

/** The composition's look for this frame (reset at the start of every resolve). */
export function setCompositionLook(look: Look | null) {
  compositionLook = look
}

export function beginFrameLooks() {
  compositionLook = null
}

/** Track looks of tracks on screen, then the composition's on top. */
export function resolveLook(isActive: (trackId: string) => boolean): Required<Look> {
  if (!trackLooks.size && !compositionLook) return DEFAULT_LOOK
  const out: Required<Look> = { ...DEFAULT_LOOK }
  for (const [trackId, look] of trackLooks) if (isActive(trackId)) Object.assign(out, strip(look))
  if (compositionLook) Object.assign(out, strip(compositionLook))
  return out
}

function strip(l: Look): Look {
  const o: Look = {}
  for (const k in l) {
    const v = l[k as keyof Look]
    if (v !== undefined) (o as Record<string, unknown>)[k] = v
  }
  return o
}
