import { getInstrument } from '../instruments'
import type { ObjectInstrumentDef } from '../instruments/types'
import { colorToOklch } from './oklch'
import { AUDIO_TRACK_COLOR } from './trackColors'
import type { Track } from '../types'

// The display color a track WEARS in the UI (timeline blocks, piano roll,
// editor chrome, drag ghosts) - distinct from the persisted track.color,
// which stays untouched as the hue-cycle fallback. Instrument tracks derive
// their identity from the instrument (Tyler's P0, 2026-07-29): a def-declared
// identityColor, else the instrument's sole color param, else the cycle.
// Child lanes (automation / ability / envelope / nested movers) wear their
// owning instrument's color so a track's whole lane family reads as one voice.

// Below this OKLCH chroma a derived color is basically white/black/grey
// (e.g. TextDisplay's default white) - hue is meaningless there, so the
// track falls back to its cycle color rather than going monochrome.
const ACHROMATIC_CHROMA = 0.02

/** The def's color-source param key: the declared one, else the instrument's
 *  sole color param, else none. */
function identityParamKey(def: ObjectInstrumentDef): string | undefined {
  if (typeof def.identityColor === 'object') return def.identityColor.param
  if (def.identityColor != null) return undefined // fixed literal, no param
  const colorParams = def.params.filter((p) => p.type === 'color')
  return colorParams.length === 1 ? colorParams[0].key : undefined
}

/** The raw instrument-derived identity (no achromatic guard), or undefined
 *  when the instrument declares nothing usable. */
function instrumentIdentity(track: Track): string | undefined {
  const def = getInstrument(track.instrumentId)
  if (!def) return undefined
  if (typeof def.identityColor === 'string') return def.identityColor
  const key = identityParamKey(def)
  if (!key) return undefined
  return track.stringParams?.[key] ?? (def.params.find((p) => p.key === key) as { default?: string } | undefined)?.default
}

/**
 * The color a track presents in the UI.
 * - audio → the fixed sapphire identity
 * - base → the instrument identity (fixed or param-derived), unless it is
 *   near-achromatic or unparseable - then the track's cycle color
 * - anything with a parent → the nearest base ancestor's display color
 * - everything else (top-level movers, directors, groups) → track.color
 */
export function resolveTrackDisplayColor(track: Track, tracks: Record<string, Track>): string {
  if (track.type === 'audio') return AUDIO_TRACK_COLOR
  if (track.type === 'base') {
    const derived = instrumentIdentity(track)
    if (derived && (colorToOklch(derived)?.c ?? 0) > ACHROMATIC_CHROMA) return derived
    return track.color
  }
  let current: Track | undefined = track
  for (let depth = 0; current?.parentId && depth < 32; depth++) {
    current = tracks[current.parentId]
    if (current?.type === 'base') return resolveTrackDisplayColor(current, tracks)
  }
  return track.color
}

/**
 * The color for chrome that is NAMING one instrument rather than color-coding a
 * timeline: the instrument's own declared color, achromatic or not.
 *
 * Same walk as the display color, minus the achromatic guard. That guard keeps a
 * white instrument's timeline blocks from going monochrome among colored
 * neighbours, but it costs the instrument its identity everywhere else - and
 * because the cycle it falls back to is seeded from the audio sapphire, the
 * first tracks in a project are BLUE. A white instrument's inspector tab
 * therefore came out the same blue as the app accent and read as "the scene's
 * color", which is exactly what the tab is not. Here white means white.
 *
 * An instrument that declares no color at all still has nothing to say, so the
 * cycle color remains the last resort.
 */
export function resolveTrackIdentityColor(track: Track, tracks: Record<string, Track>): string {
  if (track.type === 'audio') return AUDIO_TRACK_COLOR
  if (track.type === 'base') {
    const derived = instrumentIdentity(track)
    return derived && colorToOklch(derived) ? derived : track.color
  }
  let current: Track | undefined = track
  for (let depth = 0; current?.parentId && depth < 32; depth++) {
    current = tracks[current.parentId]
    if (current?.type === 'base') return resolveTrackIdentityColor(current, tracks)
  }
  return track.color
}
