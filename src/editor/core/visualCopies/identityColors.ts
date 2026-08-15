// The identity colour every mover, splitter and colorizer WEARS in the UI:
// its timeline blocks, its piano-roll rows and notes, and the accent of its
// settings panel. One per definition, in one file ON PURPOSE.
//
// ── Why these are not per-definition literals ────────────────────────────────
//
// A palette is the one kind of constant that cannot be reviewed a file at a
// time: the only interesting property is how each colour relates to the other
// twenty-five, and two definitions in different files silently landing on the
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
/** Waypoints' chartreuse. Hue 120°. */
export const WAYPOINTS_COLOR = '#b7d34e'
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
// The warm stretch between the two immovable anchors Impact Pulse (2°) and
// Meteor Impact (51°), respaced at ~12.2° when Riso Duotone joined: the wheel
// was full (its widest gap was 17°, whose midpoint sits 8.5° from each
// neighbour and fails the 11° floor), so this is the rebalance the file's
// "adding one" note prescribes. Only spread entries moved - Force Field 18→26,
// Gradient 35→39 - and both stayed within a few degrees of where they were.
/**
 * Riso Duotone's fluoro pink. Hue 14° - the closest the palette can get to
 * Pantone 806U, the ink the device ships with, without crowding Impact Pulse.
 */
export const RISO_DUOTONE_COLOR = '#ff7587'
/** Hue 26°. */
export const FORCE_FIELD_PUSH_COLOR = '#ff786e'
/** Hue 39°. */
export const GRADIENT_COLORIZER_COLOR = '#ff7c50'
// Hue ~86° is deliberately left free for the COLORIZER, which is the one
// definition that does not take a fixed colour from this file: its subject IS
// a colour the user picked, so it declares `{ param: 'color' }` and wears its
// live palette slot 1 (default '#ffd166', hue 86°). Nothing else may claim that
// hue, or a Colorizer left on its default would collide with it.
/**
 * Hue 62° - the peach between Meteor Impact's orange and the Mover's amber.
 * It sits 11.1° from each, barely over the test's floor, and the quantization
 * of an 8-bit hex leaves exactly one usable hue in that window: the two
 * nearest alternatives measure 61.1 and 62.6 and both fail. When the wheel is
 * full again, REBALANCE a stretch of movable hues instead of hunting for a
 * gap - worked example: fitting Symmetric Motion meant respacing the five
 * violet-to-rose entries between Radial Motion (286°, immovable) and Impact
 * Pulse (2°, immovable) at an even ~12.7°, moving only spread entries, never
 * a panel-accent anchor. (For now the 2026-08 mover consolidation has
 * reopened the 86-150 band and ~200-210 - see MOVER_COLOR.)
 */
export const SYMMETRY_COLOR = '#fdb97d'
/**
 * Symmetric Rotation's twist ochre. Hue 103° - the middle of the one WIDE gap
 * the wheel still had, between the Colorizer's unclaimed 86° and Waypoints'
 * 120°, sitting 17° clear of each. Nothing was moved to fit it.
 */
export const SYMMETRIC_ROTATION_COLOR = '#d8c830'
/** Hue 135° - the middle of the band the mover consolidation reopened. */
export const LINE_COLOR = '#95db6c'
/** Hue 150°. */
export const WAVE_TERRAIN_COLOR = '#6de18b'
// The Conveyor→Impact Scatter stretch, respaced at ~11.8° when Physics joined:
// by 2026-08 the wheel was full again (no gap anywhere reached the 22° an
// insertion needs), and this band's two movable entries plus its two immovable
// panel-accent walls were the only place three even gaps still fit. Freeze and
// the Cosine Palette moved by ~5-6° and kept their own lightness and chroma -
// only the hue was re-voiced, which is the only channel that survives
// midiEditorPalette anyway.
/** Hue 186° - ice, for the mover that stops time. */
export const FREEZE_COLOR = '#13c1b4'
/** Hue 198°. An arbitrary pick on purpose: the Cosine Palette's subject is
 *  every hue at once, so no single hue can stand for it and a computed
 *  `{ param }` identity has no user-picked color to follow. */
export const COSINE_PALETTE_COLOR = '#00bfc4'
/** Hue 210° - the physics mover's cyan. */
export const PHYSICS_COLOR = '#00c3db'
/** Hue 247°. */
export const MOTION_COLOR = '#4eaeff'
/** Hue 260°. */
export const TUNNEL_COLOR = '#72a7ff'
/** Hue 273°. */
export const DUPLICATE_TRAIL_COLOR = '#8ba0ff'
// The violet-to-rose stretch: five entries respaced evenly (~12.7°) between
// the immovable Radial Motion (286°) and Impact Pulse (2°) anchors when
// Symmetric Motion joined - each sits as close to its pre-rebalance hue as
// the spacing allows.
/** Hue 299°. */
export const POLYHEDRON_COLOR = '#b68eff'
/** Hue 311°. */
export const PARAMETRIC_PATTERN_COLOR = '#ce7ffe'
/** Hue 324°. */
export const RADIAL_COLOR = '#e078ea'
/** Hue 337° - the mover that moves a formation symmetrically. */
export const SYMMETRIC_MOTION_COLOR = '#ef72d3'
/** Hue 349°. */
export const GRID_COLOR = '#fb6dba'

// ── Opting out of hue ───────────────────────────────────────────────────────
/**
 * All Movers is every behaviour at once and has no one thing to stand for, so
 * it claims no hue. PURE grey (chroma 0): anything above the re-voicing's 0.02
 * floor comes back saturated, which is how this first shipped as a blue
 * indistinguishable from Tunnel's.
 */
export const CONSOLIDATED_MOVER_COLOR = '#ababab'
