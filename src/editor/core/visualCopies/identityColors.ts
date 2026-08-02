// The identity colour every mover, splitter and colorizer WEARS in the UI:
// its timeline blocks, its piano-roll rows and notes, and the accent of its
// settings panel. One per definition, in one file ON PURPOSE.
//
// ── Why these are not per-definition literals ────────────────────────────────
//
// A palette is the one kind of constant that cannot be reviewed a file at a
// time: the only interesting property is how each colour relates to the other
// twenty-four, and two definitions in different files silently landing on the
// same blue is invisible until you see them side by side in a timeline. So the
// values live here, together, and each definition imports its own.
//
// (The Colorizer is the one definition NOT listed here. Its subject is a colour
// the user picked, so it declares `{ param: 'color' }` and wears its live
// palette slot instead of a constant - see the note at hue 86 below.)
//
// ── ONLY THE HUE SURVIVES ────────────────────────────────────────────────────
//
// This is the constraint that shapes the whole palette, and it is not visible
// from any single colour. `utils/midiEditorPalette.ts` re-voices a track colour
// through OKLCH at a FIXED lightness and chroma (0.82 / 0.16) before drawing
// notes, rows and blocks - it keeps the hue and throws the rest away. So two
// definitions distinguished only by lightness render IDENTICALLY where it
// matters. (Found the hard way: a first pass separated Colorizer's gold from
// Wave Terrain's by lightness at one degree of hue apart, and they came out the
// same colour in the timeline.)
//
// Every colour here is therefore placed by HUE ALONE, as far apart as the
// entry count and the immovable panel accents allow (the wheel peaked at 26
// entries ~12-16° apart before the 2026-08 mover consolidation returned five
// hues). identityColors.test.ts enforces a floor of 11°, so a new definition
// that crowds an existing one fails rather than shipping a lane that looks like
// a duplicate. (11 rather than 12 because a hex only carries 8 bits per
// channel - a hue placed at exactly 12 round-trips to ~11.7 - and because the
// app's own Visibility/Conveyor pair has always been 11.3 apart.)
//
// The corollary for "no colour": a chroma at or below 0.02 makes the re-voicing
// treat the source as grey and leave it grey. ANYTHING ABOVE gets resurrected to
// full chroma - a tasteful slate at 0.035 comes back as a saturated blue.
// All Movers is pure grey for that reason, not merely a desaturated one.
//
// ── How the values were chosen ───────────────────────────────────────────────
//
// Nine were already the hard-coded accent of a bespoke settings panel. Those
// are LOAD-BEARING and copied exactly: the whole point of the system is that a
// mover's notes match the console you write them in, so the panel's look is the
// fixed point and the palette works around it. Their panels now import from
// here instead of re-declaring the hex, which is what stops the two drifting.
//
// The rest were spread evenly through the hue gaps the nine leave behind.
// Lightness still varies (yellows and greens sit at 0.82, where 0.73 clips
// against the sRGB gamut and comes out olive) because these ARE used unvoiced
// as panel accents - it just cannot be relied on to separate two definitions.
//
// ── Adding one ───────────────────────────────────────────────────────────────
//
// Pick a hue ≥11° from every existing entry - including the Colorizer's default
// at 86° (the test checks the fixed ones and will name the pair) - and generate
// the hex at 0.73/0.19, or 0.82/0.16 in the 60-158° band. If the definition has
// a bespoke panel, make the panel import the constant rather than repeating the
// value.

// ── Already a panel accent: copied exactly, panels import these ──────────────
/** Impact Pulse's strike rose. Hue 2°. */
export const IMPACT_PULSE_COLOR = '#ff6b9d'
/** Meteor Impact's ember. Hue 51°. */
export const METEOR_IMPACT_COLOR = '#ff8a3c'
/**
 * The Mover's amber. Hue 73° - inherited EXACTLY from the retired Burst mover,
 * whose panel accent this was: the 2026-08 mover consolidation folded Burst,
 * Rotate/Orbit Burst, Constant Rotate/Orbit and Translation Oscillator into
 * the one `mover` definition, and the family's most-played color carries the
 * flag. Their other five hues (99, 112, 124, 137, 208) went back to the wheel,
 * so the palette has real gaps again - the 86-150 band and ~200-210 are open.
 */
export const MOVER_COLOR = '#f5a623'
/** Visibility's emerald. Hue 163°. */
export const VISIBILITY_COLOR = '#34d399'
/** Conveyor's current teal. Hue 175°. */
export const CONVEYOR_COLOR = '#48e5c2'
/** Impact Scatter's shock blue. Hue 222°. */
export const IMPACT_SCATTER_COLOR = '#5ad8ff'
/** Approach's warp blue. Hue 234°. */
export const APPROACH_COLOR = '#5cc8ff'
/** Radial Motion's orbit violet. Hue 286°. */
export const RADIAL_MOTION_COLOR = '#8b7bff'

// ── Spread through the gaps ─────────────────────────────────────────────────
/** Hue 18°. */
export const FORCE_FIELD_PUSH_COLOR = '#ff767f'
/** Hue 35°. */
export const GRADIENT_COLORIZER_COLOR = '#ff7b5a'
// Hue ~86° is deliberately left free for the COLORIZER, which is the one
// definition that does not take a fixed colour from this file: its subject IS
// a colour the user picked, so it declares `{ param: 'color' }` and wears its
// live palette slot 1 (default '#ffd166', hue 86°). Nothing else may claim that
// hue, or a Colorizer left on its default would collide with it.
/**
 * Hue 62° - the peach between Meteor Impact's orange and the Mover's amber.
 * It sits 11.1° from each, barely over the test's floor, and the quantization
 * of an 8-bit hex leaves exactly one usable hue in that window: the two
 * nearest alternatives measure 61.1 and 62.6 and both fail. (When this
 * shipped the wheel was FULL; the 2026-08 mover consolidation has since
 * reopened the 86-150 band and ~200-210 - see MOVER_COLOR.)
 */
export const SYMMETRY_COLOR = '#fdb97d'
/** Hue 150°. */
export const WAVE_TERRAIN_COLOR = '#6de18b'
/** Hue 191° - ice, for the mover that stops time. */
export const FREEZE_COLOR = '#00c0bb'
/** Hue 247°. */
export const MOTION_COLOR = '#4eaeff'
/** Hue 260°. */
export const TUNNEL_COLOR = '#72a7ff'
/** Hue 273°. */
export const DUPLICATE_TRAIL_COLOR = '#8ba0ff'
/** Hue 301°. */
export const POLYHEDRON_COLOR = '#ba8cff'
/** Hue 316°. */
export const PARAMETRIC_PATTERN_COLOR = '#d57df7'
/** Hue 332°. */
export const RADIAL_COLOR = '#ea74dc'
/** Hue 347°. */
export const GRID_COLOR = '#f96ebf'

// ── Opting out of hue ───────────────────────────────────────────────────────
/**
 * All Movers is every behaviour at once and has no one thing to stand for, so
 * it claims no hue. PURE grey (chroma 0): anything above the re-voicing's 0.02
 * floor comes back saturated, which is how this first shipped as a blue
 * indistinguishable from Tunnel's.
 */
export const CONSOLIDATED_MOVER_COLOR = '#ababab'
