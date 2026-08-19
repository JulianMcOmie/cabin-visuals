import type { ObjectInstrumentDef, ParamDef } from './types'
import { lazyInstrument } from './lazyInstrument'

// Ported from Excellent DAW. A 3D warp starfield around the camera: parallax star drift
// with directional warp/drift, barrel roll, tumble, pulse burst, streak, and per-pitch
// background themes - all driven by notes on the object's own lane. Every frame is a
// pure function of the current beat (the pause invariant): drift/warp are per-note
// first-order velocity responses integrated in closed form, roll/tumble angles and the
// pulse/streak/background envelopes are closed-form in note age, so a static playhead
// is a static frame and scrub == playback. The Points shaders are copied verbatim.
//
// The visual itself lives in ./StarsVisual (lazy: fetched when a project mounts
// a starfield); this file is the def - params, rows, and nothing heavy.

export const MAX_STARS = 3000

// MIDI pitch mappings
export const PITCH_WARP_FWD = 48
export const PITCH_WARP_BWD = 49
export const PITCH_DRIFT_RIGHT = 50
export const PITCH_DRIFT_LEFT = 51
export const PITCH_DRIFT_UP = 52
export const PITCH_DRIFT_DOWN = 53
export const PITCH_BARREL_CW = 54
export const PITCH_BARREL_CCW = 55
export const PITCH_TUMBLE = 56
export const PITCH_PULSE = 57
export const PITCH_BRAKE = 58
export const PITCH_STREAK = 59

// Background theme pitches - one per theme
export const PITCH_BG_VOID = 60
export const PITCH_BG_DEEP_SPACE = 61
export const PITCH_BG_NEBULA = 62
export const PITCH_BG_CRIMSON = 63
export const PITCH_BG_OCEAN = 64
export const PITCH_BG_FOREST = 65
export const PITCH_BG_AMBER = 66
export const PITCH_BG_MIDNIGHT = 67

export const BG_THEMES: Record<number, string> = {
  [PITCH_BG_VOID]: '#0a0a0f',
  [PITCH_BG_DEEP_SPACE]: '#05051a',
  [PITCH_BG_NEBULA]: '#1a0a2e',
  [PITCH_BG_CRIMSON]: '#1a0505',
  [PITCH_BG_OCEAN]: '#051a1a',
  [PITCH_BG_FOREST]: '#0a1a05',
  [PITCH_BG_AMBER]: '#1a1005',
  [PITCH_BG_MIDNIGHT]: '#0a0a1f',
}

export const DEFAULTS = {
  starCount: 1500,
  dotSize: 2,
  speed: 1,
  spread: 6,
  depth: 15,
  drift: 0.1,
  tint: 220,
  bgColor: '#0a0a0f',
  ground: 0,
  groundY: -3,
  groundColor: '#4a3a8a',
}

const PARAMS: ParamDef[] = [
  { key: 'starCount', label: 'Stars', min: 200, max: MAX_STARS, step: 100, default: DEFAULTS.starCount },
  { key: 'dotSize', label: 'Dot Size', min: 0, max: 6, step: 0.5, default: DEFAULTS.dotSize },
  { key: 'speed', label: 'Speed', min: 0, max: 20, step: 0.1, default: DEFAULTS.speed },
  { key: 'spread', label: 'Spread', min: 2, max: 12, step: 0.5, default: DEFAULTS.spread },
  { key: 'depth', label: 'Depth', min: 5, max: 30, step: 1, default: DEFAULTS.depth },
  { key: 'drift', label: 'Idle Drift', min: 0, max: 1, step: 0.05, default: DEFAULTS.drift },
  { key: 'tint', label: 'Tint Hue', min: 0, max: 360, step: 1, default: DEFAULTS.tint },
  { key: 'bgColor', label: 'Background Color', type: 'color', default: DEFAULTS.bgColor },
  { key: 'ground', label: 'Ground Plane', type: 'boolean', default: DEFAULTS.ground },
  { key: 'groundY', label: 'Ground Height', min: -50, max: 50, step: 0.5, default: DEFAULTS.groundY, showIf: 'ground' },
  { key: 'groundColor', label: 'Ground Color', type: 'color', default: DEFAULTS.groundColor, showIf: 'ground' },
]
export const starsInstrument: ObjectInstrumentDef = {
  id: 'stars',
  name: 'Stars',
  kind: 'object',
  identityColor: { param: 'groundColor' },
  userInterfaceRenderer: 'stars',
  params: PARAMS,
  midiRows: [
    { pitch: PITCH_WARP_FWD, label: 'Warp forward (hold)', emphasized: true },
    { pitch: PITCH_WARP_BWD, label: 'Warp backward (hold)' },
    { pitch: PITCH_PULSE, label: 'Radial pulse burst', emphasized: true },
    { pitch: PITCH_TUMBLE, label: 'Tumble spin (hold)' },
    { pitch: PITCH_STREAK, label: 'Streak trails on/off' },
    { pitch: PITCH_BRAKE, label: 'Brake · slow all motion (hold)' },
    { pitch: PITCH_DRIFT_RIGHT, label: 'Drift right (hold)' },
    { pitch: PITCH_DRIFT_LEFT, label: 'Drift left (hold)' },
    { pitch: PITCH_DRIFT_UP, label: 'Drift up (hold)' },
    { pitch: PITCH_DRIFT_DOWN, label: 'Drift down (hold)' },
    { pitch: PITCH_BARREL_CW, label: 'Barrel roll clockwise (hold)' },
    { pitch: PITCH_BARREL_CCW, label: 'Barrel roll counter-clockwise (hold)' },
    { pitch: PITCH_BG_VOID, label: 'Background · Void (hold)', color: '#0a0a0f' },
    { pitch: PITCH_BG_DEEP_SPACE, label: 'Background · Deep Space (hold)', color: '#05051a' },
    { pitch: PITCH_BG_NEBULA, label: 'Background · Nebula (hold)', color: '#1a0a2e' },
    { pitch: PITCH_BG_CRIMSON, label: 'Background · Crimson (hold)', color: '#1a0505' },
    { pitch: PITCH_BG_OCEAN, label: 'Background · Ocean (hold)', color: '#051a1a' },
    { pitch: PITCH_BG_FOREST, label: 'Background · Forest (hold)', color: '#0a1a05' },
    { pitch: PITCH_BG_AMBER, label: 'Background · Amber (hold)', color: '#1a1005' },
    { pitch: PITCH_BG_MIDNIGHT, label: 'Background · Midnight (hold)', color: '#0a0a1f' },
  ],
  component: lazyInstrument(() => import('./StarsVisual').then((m) => m.StarsVisual)),
}
