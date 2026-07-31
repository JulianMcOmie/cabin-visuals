// The pure half of Flash Wall (see FlashWall.tsx): a screen-filling rectangle
// carved into zones, where every note flashes its zone through an ADSR
// envelope. Split out with type-only imports so the colocated test can import
// it without dragging the component's instrumentFrame → VisualEngine →
// instruments/index cycle in (the "Cannot access X before initialization"
// trap this directory's guide documents).

import type { ResolvedNote } from '../core/visual/types'

/** Uniform-array size in the shader; the zones param is capped here. */
export const FLASH_WALL_MAX_ZONES = 12

/** Zone 1's pitch; rows walk upward from here. Frozen: projects store pitches. */
export const FLASH_WALL_BASE_PITCH = 60

export const DEFAULT_FLASH_WALL_COLOR = '#8de1ff'

/** All times in seconds - a flash is a percussive gesture, so its envelope
 *  should not stretch when the tempo changes. Callers convert note ages from
 *  beats via secPerBeat, which keeps every value a pure function of the beat. */
export interface FlashWallEnvelope {
  attackSec: number
  decaySec: number
  /** Level held while the note is held, 0..1. */
  sustain: number
  releaseSec: number
}

/**
 * Gate value `t` seconds into a HELD note: linear attack to 1, quadratic
 * ease-out decay to the sustain level, then flat. A zero attack is an
 * instantaneous 1 - the percussive default.
 */
export function flashGate(env: FlashWallEnvelope, t: number): number {
  if (t < 0) return 0
  if (t < env.attackSec) return t / env.attackSec
  const d = t - env.attackSec
  if (d < env.decaySec) {
    const u = d / env.decaySec
    return 1 - (1 - env.sustain) * u * (2 - u)
  }
  return env.sustain
}

/**
 * The full envelope `t` seconds after the note's onset, for a note held
 * `heldSec`: the gate while held, then a quadratic ease-out release from
 * wherever the gate had reached when the note ended. Pure in (env, t, heldSec),
 * so scrub == playback == export.
 */
export function flashEnvelopeAt(env: FlashWallEnvelope, t: number, heldSec: number): number {
  if (t < 0) return 0
  if (t <= heldSec) return flashGate(env, t)
  const rel = t - heldSec
  if (env.releaseSec <= 0 || rel >= env.releaseSec) return 0
  const u = 1 - rel / env.releaseSec
  return flashGate(env, heldSec) * u * u
}

/** Which zone a pitch lights: semitones above the base pitch, wrapped, so any
 *  pitch always lands somewhere and shrinking the zone count never mutes rows. */
export function zoneOfPitch(pitch: number, zones: number): number {
  if (zones <= 0) return 0
  return (((pitch - FLASH_WALL_BASE_PITCH) % zones) + zones) % zones
}

/** Layout param values (a select, so these are frozen once shipped). */
export const FLASH_WALL_LAYOUT = { columns: 0, rows: 1, grid: 2 } as const

/** How the zones tile the rectangle. Grid packs near-square: cells beyond the
 *  zone count (e.g. 7 zones in a 3x3) render as idle filler, not duplicates. */
export function flashWallGrid(zones: number, layout: number): { cols: number; rows: number } {
  const n = Math.max(1, Math.min(FLASH_WALL_MAX_ZONES, Math.round(zones)))
  if (layout === FLASH_WALL_LAYOUT.rows) return { cols: 1, rows: n }
  if (layout === FLASH_WALL_LAYOUT.grid) {
    const cols = Math.ceil(Math.sqrt(n))
    return { cols, rows: Math.ceil(n / cols) }
  }
  return { cols: n, rows: 1 }
}

/**
 * Per-zone flash levels at `beat`, written into the caller's arrays (no
 * per-frame allocation). Overlapping notes on one zone combine by MAX - a
 * flash is a level, not an energy sum, and max keeps a roll from clipping
 * white. Velocity scales the peak (a soft floor keeps quiet notes visible).
 * `outPitches[z]` is the pitch of the zone's strongest contributor (-1 while
 * dark) - what the Pitch color mode paints the zone with.
 */
export function resolveZoneFlashes(
  notes: readonly ResolvedNote[],
  beat: number,
  secPerBeat: number,
  zones: number,
  env: FlashWallEnvelope,
  outLevels: number[],
  outPitches: number[],
): void {
  for (let i = 0; i < zones; i++) {
    outLevels[i] = 0
    outPitches[i] = -1
  }
  for (const note of notes) {
    const t = (beat - note.beat) * secPerBeat
    if (t < 0) continue
    const heldSec = note.durationBeats * secPerBeat
    if (t > heldSec + env.releaseSec) continue
    const velN = note.velocity <= 1 ? note.velocity : note.velocity / 127
    const level = flashEnvelopeAt(env, t, heldSec) * (0.25 + 0.75 * velN)
    if (level <= 0) continue
    const z = zoneOfPitch(note.pitch, zones)
    if (level > outLevels[z]) {
      outLevels[z] = level
      outPitches[z] = note.pitch
    }
  }
}

// ── Zone color ──────────────────────────────────────────────────────────────
// Self-contained hex/HSV math (no imports): the instrument AND its settings
// panel both call zoneColorHex, so the wall and the panel preview cannot
// disagree about what a zone wears.

export const FLASH_WALL_COLOR_MODE = { solid: 0, spectrum: 1, pitch: 2 } as const

function hexToHsv(hex: string): { h: number; s: number; v: number } {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  const n = m ? parseInt(m[1], 16) : 0x8de1ff
  const r = ((n >> 16) & 255) / 255
  const g = ((n >> 8) & 255) / 255
  const b = (n & 255) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  let h = 0
  if (d > 0) {
    if (max === r) h = ((g - b) / d + 6) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h /= 6
  }
  return { h, s: max === 0 ? 0 : d / max, v: max }
}

function hsvToHex(h: number, s: number, v: number): string {
  const hh = ((h % 1) + 1) % 1
  const f = (n: number) => {
    const k = (n + hh * 6) % 6
    const c = v - v * s * Math.max(0, Math.min(k, 4 - k, 1))
    return Math.round(c * 255).toString(16).padStart(2, '0')
  }
  return `#${f(5)}${f(3)}${f(1)}`
}

/**
 * What a zone wears. Solid: everything is the base color. Spectrum: the base
 * hue fans around the wheel across the zones, so the division of the screen is
 * visible even at rest (saturation gets a floor - a near-white base would fan
 * into twelve whites). Pitch: the zone takes the hue of the note lighting it
 * (pitch class around the wheel), falling back to the base while dark.
 */
export function zoneColorHex(
  baseHex: string,
  mode: number,
  zone: number,
  zones: number,
  pitch: number,
): string {
  if (mode === FLASH_WALL_COLOR_MODE.spectrum) {
    const { h, s, v } = hexToHsv(baseHex)
    return hsvToHex(h + zone / Math.max(1, zones), Math.max(s, 0.6), v)
  }
  if (mode === FLASH_WALL_COLOR_MODE.pitch && pitch >= 0) {
    const { s, v } = hexToHsv(baseHex)
    return hsvToHex((((pitch % 12) + 12) % 12) / 12, Math.max(s, 0.6), v)
  }
  return baseHex
}
