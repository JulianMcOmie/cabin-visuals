import { doc, track, block, hits, every } from './builder'
import type { TemplateDef } from './library'

// The Midi Roll template: drop a MIDI file and the notes themselves are the
// video - a scrolling piano roll in the VIDI-studio style, riding over a
// drifting starfield.
//
// Every setting is copied verbatim from Julia's "midirollsettings" project
// (77598003-4129-42db-b724-cdaa733fa1bb, resynced 2026-08-21 10:51): deep
// indigo Line-style bars (#241d49, style 2, hair-thin 0.006) with small dot
// markers across a wide 22-beat window, glow 0.55 with ripple 0.6 - and
// behind it the standalone Starfield in near-black indigo (#130240): a DENSE
// field (density 316), stretched deep (depth 419) with an inverted size
// trend (-3.15, far dots larger than near), warm dust off. The Starfield
// track has no blocks on purpose: it is presence-driven, so it drifts for
// the whole timeline. Only the notes are placeholder - her real project's
// notes came from her own MIDI file, which is exactly what the /midi-setup
// step replaces them with (refillMidiRollTrack keeps this track's styling
// and swaps the pattern).
//
// The placeholder pattern is authored, not copied: a quiet four-chord figure
// (bass + arpeggio + a top line) spanning the same register her file did, so
// the gallery card and a skipped setup step both show the roll doing its
// auto-fit over something musical.

const BARS = 16

// One 4-bar figure, repeated. Velocities sit low (her file peaked around 50) -
// velocity drives the hit flash, so the pattern glimmers rather than strobes.
const FIGURE = hits([
  // Bass roots: long and dim, the floor of the auto-fit range.
  [0, 45, 3.5, 18], [4, 41, 3.5, 15], [8, 48, 3.5, 16], [12, 43, 3.5, 20],
  // Mid-voice arpeggio, offbeat.
  [0.5, 57, 1, 12], [1.5, 60, 1, 14], [2.5, 64, 1.2, 16],
  [4.5, 57, 1, 12], [5.5, 60, 1.2, 13], [6.5, 65, 1, 15],
  [8.5, 60, 1, 14], [9.5, 64, 1.2, 15], [10.5, 67, 1, 17],
  [12.5, 59, 1, 13], [13.5, 62, 1.2, 15], [14.5, 67, 1, 16],
  // Top line: the brightest hits, held.
  [0, 72, 2.2, 34], [2.5, 69, 1.2, 28], [4, 72, 2.5, 30], [6.5, 76, 1.2, 38],
  [8, 76, 2.2, 40], [10.5, 72, 1, 30], [12, 71, 2, 33], [14, 74, 1.8, 36],
])

function midiRollDocument() {
  return doc({
    bpm: 120,
    totalBars: BARS,
    viewAspect: '9:16',
    // The source project's room: stars over black, not cabin blue.
    background: '#000000',
    tracks: [
      // THE track: name + instrument are the refill contract (see
      // refillMidiRollTrack in ProjectStore) - rename it and dropped MIDI
      // mints a plain new track instead of restyling this one.
      track({
        name: 'Midi Roll',
        instrumentId: 'midiRoll',
        color: '#2f86ee',
        params: {
          style: 2,
          thickness: 0.006,
          rounded: 0,
          window: 22,
          maxGap: 0.085,
          marker: 2,
          markerSize: 0.8,
          hitFlash: 0.55,
          ripple: 0.6,
          glow: 0.55,
          playPower: 0.2,
        },
        stringParams: { color: '#241d49' },
        blocks: [block(0, BARS, every(16, BARS * 4, FIGURE))],
      }),
      // The ambient backdrop: the standalone Starfield, blockless so its
      // presence-driven dots drift for the whole timeline.
      track({
        name: 'Starfield',
        instrumentId: 'starfield',
        color: '#2f3aee',
        params: {
          density: 316,
          size: 0.587,
          speed: 1.7,
          depth: 419,
          sizeTrend: -3.15,
          warmDust: 0,
        },
        stringParams: { color: '#130240' },
      }),
    ],
  })
}

export const midiRoll: TemplateDef = {
  id: 'midiRoll',
  name: 'Midi Roll',
  description: 'Your MIDI is the video: a glowing piano roll scrolling over a drifting dot field.',
  bpm: 120,
  document: midiRollDocument(),
}
