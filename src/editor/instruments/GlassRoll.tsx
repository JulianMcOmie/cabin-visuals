import type { ObjectInstrumentDef, ParamDef } from './types'
import { lazyInstrument } from './lazyInstrument'

// Glass Roll: a falling piano roll modeled frame-by-frame on a Rousseau-style
// piano video (reference capture `damnotes.mp4`, 2026-09-06). Notes are
// stained-glass tiles - rounded slabs of leaded mosaic in cathedral blues,
// violets, pinks and pale glass - that fall onto a keyboard rail; a struck
// tile burns white at the rail, spills blue light down the keys, and sheds a
// plume of sparkle dust that rises in curling ribbons. Sibling of Midi Roll
// (same canvas-texture + bloom architecture, its own look and layout):
// pitch maps to REAL KEY POSITIONS (white/black widths), time runs top to
// bottom, and the fall is clocked in seconds by default so the roll reads
// like the video at any tempo.
//
// Pause invariant: tiles, glow, key light and every dust mote are closed-
// form functions of (beat, notes, params) - the plume is not a simulation
// (see glassRollCore.ts), so scrub == playback and export is frame-exact.

/** A glass palette: weighted facet colors plus the lead-line tone. Weights
 *  are relative frequencies (Cathedral leans deep blue with pale glass and
 *  violet second, exactly the reference's mix). */
export interface GlassPalette {
  name: string
  facets: Array<[hex: string, weight: number]>
  lead: string
}

export const GLASS_PALETTES: GlassPalette[] = [
  {
    name: 'Cathedral',
    facets: [
      ['#1420d0', 2.5], ['#2f3cf0', 1], ['#5a35e0', 2.5], ['#8a6fe8', 2],
      ['#c855c0', 0.6], ['#e07ab0', 0.5], ['#dcdcff', 0.9], ['#3fc8a8', 0.7],
      ['#78d890', 0.35], ['#e0c070', 0.3],
    ],
    lead: '#c6ccd8',
  },
  {
    name: 'Ocean',
    facets: [
      ['#1436c8', 3], ['#2a7de8', 2.2], ['#35c8e0', 1.6], ['#7fe6f0', 1.2],
      ['#e8f6ff', 1.6], ['#4ad8b0', 1], ['#1e6e9e', 1], ['#a8c8ff', 0.8],
    ],
    lead: '#bfd0e0',
  },
  {
    name: 'Rose',
    facets: [
      ['#e0407a', 2.5], ['#f07aa8', 2], ['#ffb3c8', 1.4], ['#c02a5a', 1.6],
      ['#fff0f4', 1.6], ['#ffc86a', 0.9], ['#9a4ad0', 0.8], ['#ff8a5a', 0.6],
    ],
    lead: '#e0cbd2',
  },
  {
    name: 'Emerald',
    facets: [
      ['#1c8a4a', 2.6], ['#2fc46e', 2], ['#8ff0b0', 1.4], ['#0e5a3a', 1.6],
      ['#eefff4', 1.4], ['#d8f06a', 0.8], ['#2ab8c8', 0.9], ['#f0d060', 0.4],
    ],
    lead: '#c4d6c8',
  },
  {
    name: 'Amber',
    facets: [
      ['#f08a1e', 2.6], ['#ffc040', 2], ['#ffe08a', 1.4], ['#c04a10', 1.6],
      ['#fff4e0', 1.4], ['#e83a4a', 0.8], ['#8a2a80', 0.6], ['#ffa060', 1],
    ],
    lead: '#d8ccb8',
  },
  {
    name: 'Silver',
    facets: [
      ['#dfe6f2', 3], ['#b8c4d8', 2], ['#8f9db8', 1.6], ['#f6f8ff', 2],
      ['#6a7a9a', 1], ['#c8d8ff', 1], ['#a0b8e0', 0.8],
    ],
    lead: '#d4dae6',
  },
]

const PARAMS: ParamDef[] = [
  // ── Glass ────────────────────────────────────────────────────────────
  {
    key: 'palette', label: 'Glass Palette', type: 'select', default: 0,
    options: GLASS_PALETTES.map((p, i) => ({ value: i, label: p.name })),
  },
  { key: 'tint', label: 'Hue Shift', min: -180, max: 180, step: 1, default: 0 },
  // Facet size: 1 = the reference's one-to-two facets across a tile.
  { key: 'glassDetail', label: 'Facet Detail', min: 0.5, max: 2.5, step: 0.05, default: 1 },
  { key: 'mosaicSeed', label: 'Mosaic Seed', min: 0, max: 100, step: 1, default: 7, integer: true },
  { key: 'leadBright', label: 'Lead Brightness', min: 0, max: 1.5, step: 0.05, default: 0.75 },
  { key: 'flowers', label: 'Flower Motifs', min: 0, max: 2.5, step: 0.1, default: 1 },
  { key: 'glassBright', label: 'Glass Brightness', min: 0.2, max: 1.6, step: 0.05, default: 1 },
  // ── Tiles ────────────────────────────────────────────────────────────
  // Fraction of the key's width a tile fills (the reference's ~0.86).
  { key: 'noteWidth', label: 'Note Width', min: 0.3, max: 1.2, step: 0.02, default: 0.86 },
  { key: 'cornerRadius', label: 'Corner Radius', min: 0, max: 0.5, step: 0.01, default: 0.22 },
  { key: 'noteGap', label: 'Note Gap (px)', min: 0, max: 12, step: 0.5, default: 2 },
  { key: 'borderWidth', label: 'Border Width', min: 0, max: 4, step: 0.1, default: 1.6 },
  // ── Time ─────────────────────────────────────────────────────────────
  // Seconds by default: the video's fall is ~2.5 s top-to-rail, and a
  // real piano roll reads that way at any tempo. Beats for musical sync.
  {
    key: 'speedMode', label: 'Fall Clock', type: 'select', default: 0, options: [
      { value: 0, label: 'Seconds' },
      { value: 1, label: 'Beats' },
    ],
  },
  { key: 'fallSeconds', label: 'Fall Time (s)', min: 0.5, max: 10, step: 0.1, default: 2.5, showIf: 'speedMode=0' },
  { key: 'window', label: 'Fall Time (beats)', min: 1, max: 32, step: 0.5, default: 5, showIf: 'speedMode=1' },
  // ── Layout ───────────────────────────────────────────────────────────
  {
    key: 'layout', label: 'Key Range', type: 'select', default: 0, options: [
      { value: 0, label: 'Full piano (88)' },
      { value: 1, label: 'Fit to notes' },
      { value: 2, label: 'Custom' },
    ],
  },
  { key: 'lowKey', label: 'Lowest Key', min: 0, max: 120, step: 1, default: 21, integer: true, showIf: 'layout=2' },
  { key: 'highKey', label: 'Highest Key', min: 7, max: 127, step: 1, default: 108, integer: true, showIf: 'layout=2' },
  // Where the keyboard rail sits, as a fraction of the frame height. The
  // reference frames the roll in the top half and the piano below.
  { key: 'hitLine', label: 'Rail Position', min: 0.2, max: 1, step: 0.01, default: 0.5 },
  { key: 'octaveLines', label: 'Octave Lines', type: 'boolean', default: 1 },
  // The Night backdrop's soft cloud washes (the reference room is lit
  // unevenly - a pale drift of light up one side).
  { key: 'ambient', label: 'Ambient Light', min: 0, max: 2.5, step: 0.05, default: 1, showIf: 'backdrop=0' },
  {
    key: 'backdrop', label: 'Backdrop', type: 'select', default: 0, options: [
      { value: 0, label: 'Night' },
      { value: 1, label: 'Black' },
      { value: 2, label: 'Scene' },
    ],
  },
  // ── Keyboard ─────────────────────────────────────────────────────────
  {
    key: 'keyboard', label: 'Keyboard', type: 'select', default: 2, options: [
      { value: 0, label: 'None' },
      { value: 1, label: 'Rail only' },
      { value: 2, label: 'Keys' },
    ],
  },
  { key: 'keyboardHeight', label: 'Keyboard Height', min: 0.05, max: 0.5, step: 0.01, default: 0.26, showIf: 'keyboard=2' },
  { key: 'keyLight', label: 'Key Light', min: 0, max: 2.5, step: 0.05, default: 1, showIf: 'keyboard' },
  // ── Strike ───────────────────────────────────────────────────────────
  { key: 'hitWhite', label: 'Strike Whiteness', min: 0, max: 1, step: 0.05, default: 0.62 },
  { key: 'attack', label: 'Strike Attack (s)', min: 0, max: 0.3, step: 0.01, default: 0.04 },
  { key: 'release', label: 'Afterglow (s)', min: 0.05, max: 3, step: 0.05, default: 0.8 },
  { key: 'glow', label: 'Glow', min: 0, max: 2.5, step: 0.05, default: 1 },
  { key: 'glowReach', label: 'Glow Reach', min: 0.3, max: 2.5, step: 0.05, default: 1 },
  // ── Sparkle plume ────────────────────────────────────────────────────
  { key: 'particles', label: 'Sparkle Amount', min: 0, max: 3, step: 0.05, default: 1 },
  { key: 'particleRise', label: 'Sparkle Rise', min: 0, max: 3, step: 0.05, default: 1 },
  { key: 'particleLife', label: 'Sparkle Life (s)', min: 0.3, max: 6, step: 0.1, default: 1.6 },
  { key: 'particleSpread', label: 'Sparkle Spread', min: 0, max: 3, step: 0.05, default: 1 },
  { key: 'particleCurl', label: 'Sparkle Curl', min: 0, max: 3, step: 0.05, default: 1 },
  { key: 'particleSize', label: 'Sparkle Size', min: 0.4, max: 3, step: 0.05, default: 1 },
  { key: 'particleColor', label: 'Sparkle Color', type: 'color', default: '#dfe8ff' },
  { key: 'haze', label: 'Blue Haze', min: 0, max: 2.5, step: 0.05, default: 1 },
  // The thin blue vapor lines that race up ahead of the puff on a strike.
  { key: 'streaks', label: 'Vapor Streaks', min: 0, max: 3, step: 0.05, default: 1 },
]

export const glassRollInstrument: ObjectInstrumentDef = {
  id: 'glassRoll',
  name: 'Glass Roll',
  kind: 'object',
  identityColor: '#7f9cff',
  userInterfaceRenderer: 'parameters',
  params: PARAMS,
  // No midiRows: every pitch lands on its real key.
  component: lazyInstrument(() => import('./GlassRollVisual').then((m) => m.GlassRollVisual)),
  fullFrame: true,
}
