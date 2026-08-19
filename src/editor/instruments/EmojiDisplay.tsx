import type { ObjectInstrumentDef, ParamDef } from './types'
import { lazyInstrument } from './lazyInstrument'

// Ported from Excellent DAW. Eight emoji glyphs laid out in a 2×4 grid across the full
// frame, rearranged by MIDI triggers: switch corners, swap halves, rotate the whole set
// CW/CCW, flip the layout axis, a whole-180 flip, per-row rotations, and a held "3D depth"
// trigger that spawns depth trails zooming toward the camera. Emoji are unicode drawn to a
// canvas + CanvasTexture (no image assets, no IndexedDB). Tyler's seek handling and palette
// are dropped.
//
// Adapter notes: Tyler read note-on edges from `pitchNoteOnCounts` (per-pitch counts) and
// accumulated layout state across frames. Here everything is refolded from state.notes up
// to the playhead every frame: the layout is the fold of all trigger hits at or before the
// current beat, the position easing and depth fade are closed-form exponentials anchored
// at the driving note's beat, and the trail phase is total held time so far - so a paused
// playhead is a static frame and scrub == playback. Tyler's layout / rotation / trail math
// is copied verbatim; only the trigger reads are rewired.
//
// The visual itself lives in ./EmojiDisplayVisual (lazy: fetched when a project
// mounts an emoji display); this file is the def - params, rows, and nothing heavy.

export const DEFAULT_EMOJIS =
  '😀 😎 🔥 💀 👻 🎉 🌈 ⭐ 💖 🎵 🚀 🌊 🍕 🎸 👑 💎 🦋 🌺 🎭 🤖 👽 🦄 🐉 🌙 ' +
  '🎪 🧊 🫧 🪩 🎯 🧿 🔮 🪬 🫀 🧠 👁️ 🦑 🐙 🪸 🍄 🌵 🪻 🫠 🥶 🤯 🥳 😈 🤡 🛸'

const PARAMS: ParamDef[] = [
  { key: 'emojis', label: 'Emojis (space-separated)', type: 'string', default: DEFAULT_EMOJIS, multiline: true },
  { key: 'fontSize', label: 'Size', min: 0.05, max: 2, step: 0.05, default: 0.15 },
  { key: 'opacity', label: 'Opacity', min: 0, max: 1, step: 0.05, default: 1 },
  { key: 'moveSpeed', label: 'Move Speed', min: 1, max: 30, step: 1, default: 8 },
  { key: 'padding', label: 'Padding', min: 0, max: 0.4, step: 0.02, default: 0.1 },
  { key: 'spread', label: 'Spread', min: 0, max: 3, step: 0.05, default: 1 },
]

export const emojiDisplayInstrument: ObjectInstrumentDef = {
  id: 'emojiDisplay',
  name: 'Emoji Display',
  kind: 'object',
  identityColor: '#fbbf24',
  userInterfaceRenderer: 'emojiDisplay',
  params: PARAMS,
  midiRows: [
    { pitch: 43, label: 'Show 8th emoji in list' },
    { pitch: 42, label: 'Show 7th emoji in list' },
    { pitch: 41, label: 'Show 6th emoji in list' },
    { pitch: 40, label: 'Show 5th emoji in list' },
    { pitch: 39, label: 'Show 4th emoji in list' },
    { pitch: 38, label: 'Show 3rd emoji in list' },
    { pitch: 37, label: 'Show 2nd emoji in list' },
    { pitch: 36, label: 'Show 1st emoji in list', emphasized: true },
    { pitch: 35, label: 'Swap corners (diagonal)' },
    { pitch: 34, label: 'Swap halves' },
    { pitch: 33, label: 'Rotate corners CW' },
    { pitch: 32, label: 'Rotate corners CCW' },
    { pitch: 31, label: 'Flip layout axis' },
    { pitch: 30, label: '3D depth trails (hold)' },
    { pitch: 29, label: 'Flip whole grid 180°' },
    { pitch: 28, label: 'Spin top row CW' },
    { pitch: 27, label: 'Spin top row CCW' },
    { pitch: 26, label: 'Spin bottom row CW' },
    { pitch: 25, label: 'Spin bottom row CCW' },
  ],
  component: lazyInstrument(() => import('./EmojiDisplayVisual').then((m) => m.EmojiDisplayVisual)),
  fullFrame: true,
}
