import { getInstrument } from '../instruments'
import type { ObjectInstrumentDef } from '../instruments/types'
import { getMoverOrSplitterDefinition } from '../core/visualCopies/registry'
import { colorToOklch } from './oklch'
import { AUDIO_TRACK_COLOR } from './trackColors'
import type { Track } from '../types'

// The display color a track WEARS in the UI (timeline blocks, piano roll,
// editor chrome, drag ghosts) - distinct from the persisted track.color,
// which stays untouched as the hue-cycle fallback. Instrument tracks derive
// their identity from the instrument (Tyler's P0, 2026-07-29): a def-declared
// identityColor, else the instrument's sole color param, else the cycle.
//
// EVERY CHILD LANE IS INDEPENDENT (Tyler, 2026-07-31). Lanes used to inherit
// their owning instrument's color so a track's whole family read as one voice;
// they no longer do. A mover/splitter/colorizer wears the color its DEFINITION
// declares (core/visualCopies/identityColors.ts) - so Impact Pulse's notes are
// the same rose as the console you write them in, in every project - and the
// param lanes (automation / envelope / ability), which have no definition to
// declare anything, wear their own hue-cycle color instead.
//
// What that trades away is real and was the old rule's whole point: a glance no
// longer tells you which instrument a lane belongs to, only what the lane IS.
// Nesting already says the former (a lane sits under its parent), and nothing
// said the latter.

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
 * A mover / splitter / colorizer row's OWN color, from its definition.
 *
 * Either a fixed hex or, for a definition whose subject IS a color the user
 * picked, the live value of one of its own color params (the Colorizer's
 * palette slot 1). A `{ param }` identity that resolves to something
 * near-achromatic says nothing about which lane this is, so it falls through to
 * the lane's own cycle color rather than showing a white row.
 *
 * Every shipped definition declares one (identityColors.ts); the optional
 * return covers a legacy id that no longer resolves and test fakes, which fall
 * through to the cycle color like any other lane.
 */
function moverIdentity(track: Track, preserveNeutral = false): string | undefined {
  if (track.type !== 'mover' && track.type !== 'splitter') return undefined
  const def = getMoverOrSplitterDefinition(track.moverId ?? track.splitterId)
  const identity = def?.identityColor
  if (!identity) return undefined
  if (typeof identity === 'string') return identity
  // Live: the stored value if the user has picked one, else the param default,
  // so a freshly added Colorizer already wears its palette's first color.
  const picked = track.stringParams?.[identity.param]
    ?? (def!.params.find((pd) => pd.key === identity.param) as { default?: string } | undefined)?.default
  if (!picked) return undefined
  const parsed = colorToOklch(picked)
  return parsed && (preserveNeutral || parsed.c > ACHROMATIC_CHROMA) ? picked : undefined
}

/**
 * The color a track presents in the UI.
 * - audio → the fixed sapphire identity
 * - base → the instrument identity (fixed or param-derived), unless it is
 *   near-achromatic or unparseable - then the track's cycle color
 * - mover / splitter / colorizer → its definition's declared color
 * - everything else (param lanes, composition tracks, groups) → its own track.color
 */
export function resolveTrackDisplayColor(track: Track): string {
  if (track.type === 'audio') return AUDIO_TRACK_COLOR
  const declared = moverIdentity(track)
  if (declared) return declared
  if (track.type === 'base') {
    const derived = instrumentIdentity(track)
    if (derived && (colorToOklch(derived)?.c ?? 0) > ACHROMATIC_CHROMA) return derived
  }
  return track.color
}

/**
 * The color for chrome that is NAMING one instrument rather than color-coding a
 * timeline: the instrument's own declared color, achromatic or not.
 *
 * Same resolution as the display color, minus the achromatic guard. That guard
 * keeps a white instrument's timeline blocks from going monochrome among colored
 * neighbours, but it costs the instrument its identity everywhere else - and
 * because the cycle it falls back to is seeded from the audio sapphire, the
 * first tracks in a project are BLUE. A white instrument's inspector tab
 * therefore came out the same blue as the app accent and read as "the scene's
 * color", which is exactly what the tab is not. Here white means white.
 *
 * An instrument that declares no color at all still has nothing to say, so the
 * cycle color remains the last resort.
 */
export function resolveTrackIdentityColor(track: Track): string {
  if (track.type === 'audio') return AUDIO_TRACK_COLOR
  const declared = moverIdentity(track, true)
  if (declared) return declared
  if (track.type === 'base') {
    const derived = instrumentIdentity(track)
    if (derived && colorToOklch(derived)) return derived
  }
  return track.color
}
