// The canonical track transform: engine-owned params every OBJECT track carries,
// edited by the track strip / transform panel (not by instrument UIs). They live
// in track.params under reserved keys so the existing automation-lane and
// envelope machinery targets them exactly like instrument params, but their
// defs are declared HERE - instruments neither declare nor read them. The
// engine composes them into the world matrix as the parent of the instrument's
// own localTransform, so position/rotation/size all inherit down the track
// hierarchy (size is a "group fader": scaling a parent scales its subtree and
// its movers' layout - unlike instrument mesh scale, which stays private).

import type { NumberParamDef, ParamDef } from '../instruments/types'

export const TF_X = 'tfX'
export const TF_Y = 'tfY'
export const TF_Z = 'tfZ'
export const TF_ROT_X = 'tfRotX'
export const TF_ROT_Y = 'tfRotY'
export const TF_ROT_Z = 'tfRotZ'
export const TF_SIZE = 'tfSize'
export const TF_OPACITY = 'tfOpacity'

/** Rotation params are stored in DEGREES (snappable at 45s); the engine converts. */
export const TRANSFORM_PARAM_DEFS: NumberParamDef[] = [
  { key: TF_X, label: 'X', min: -10, max: 10, step: 0.01, default: 0 },
  { key: TF_Y, label: 'Y', min: -10, max: 10, step: 0.01, default: 0 },
  { key: TF_Z, label: 'Z', min: -10, max: 10, step: 0.01, default: 0 },
  { key: TF_ROT_X, label: 'Rotate X', min: -180, max: 180, step: 1, default: 0 },
  { key: TF_ROT_Y, label: 'Rotate Y', min: -180, max: 180, step: 1, default: 0 },
  { key: TF_ROT_Z, label: 'Rotate Z', min: -180, max: 180, step: 1, default: 0 },
  { key: TF_SIZE, label: 'Size', min: 0.05, max: 4, step: 0.01, default: 1 },
  { key: TF_OPACITY, label: 'Opacity', min: 0, max: 1, step: 0.01, default: 1 },
]

const DEFAULTS: Record<string, number> = Object.fromEntries(
  TRANSFORM_PARAM_DEFS.map((p) => [p.key, p.default]),
)

export function transformDefault(key: string): number {
  return DEFAULTS[key] ?? 0
}

/** An object track's automatable param list: the canonical transform params
 *  first, then the instrument's own. Used everywhere an automation lane resolves
 *  or offers a target, so transform is automatable exactly like any param. */
export function withTransformParams(params: ParamDef[]): ParamDef[] {
  return [...TRANSFORM_PARAM_DEFS, ...params]
}

/** The SPATIAL canonical params (everything but Opacity): what a SPLITTER track
 *  offers its own automation lanes. A lane on one of these moves the splitter's
 *  copies in the splitter's reference frame, exactly like a mover child of the
 *  splitter (resolve.ts's splitter weave) - where opacity isn't a transform, so
 *  it stays an object-track affordance. */
export const SPATIAL_TRANSFORM_PARAM_DEFS: NumberParamDef[] = TRANSFORM_PARAM_DEFS.filter(
  (p) => p.key !== TF_OPACITY,
)

/** A splitter track's automatable param list: the spatial transform params
 *  first, then the definition's own - the splitter counterpart of
 *  withTransformParams, shared by the same lane/target surfaces. */
export function withSpatialTransformParams(params: ParamDef[]): ParamDef[] {
  return [...SPATIAL_TRANSFORM_PARAM_DEFS, ...params]
}

const DEG = Math.PI / 180

/** True when every canonical key is at its identity default (the common case -
 *  lets the engine skip the extra matrix compose per object per frame). */
export function isIdentityTransform(params: Record<string, number>): boolean {
  return (
    !(params[TF_X] ?? 0) &&
    !(params[TF_Y] ?? 0) &&
    !(params[TF_Z] ?? 0) &&
    !(params[TF_ROT_X] ?? 0) &&
    !(params[TF_ROT_Y] ?? 0) &&
    !(params[TF_ROT_Z] ?? 0) &&
    (params[TF_SIZE] ?? 1) === 1
  )
}

export interface TrackTransform {
  position: [number, number, number]
  /** XYZ Euler, radians (converted from the stored degrees). */
  rotation: [number, number, number]
  scale: number
}

const _out: TrackTransform = { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 }

/** Read the canonical keys out of a params record. Returns a REUSED scratch
 *  object - consume it before the next call (engine hot path, no allocation). */
export function readTrackTransform(params: Record<string, number>): TrackTransform {
  _out.position[0] = params[TF_X] ?? 0
  _out.position[1] = params[TF_Y] ?? 0
  _out.position[2] = params[TF_Z] ?? 0
  _out.rotation[0] = (params[TF_ROT_X] ?? 0) * DEG
  _out.rotation[1] = (params[TF_ROT_Y] ?? 0) * DEG
  _out.rotation[2] = (params[TF_ROT_Z] ?? 0) * DEG
  _out.scale = params[TF_SIZE] ?? 1
  return _out
}

export function trackOpacity(params: Record<string, number>): number {
  const v = params[TF_OPACITY]
  return v === undefined ? 1 : Math.max(0, Math.min(1, v))
}
