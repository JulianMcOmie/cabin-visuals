import { doc, track, block, hits, every } from './builder'
import type { TemplateDef } from './library'

// The Midi Roll template: drop a MIDI file and the notes themselves are the
// video - a scrolling piano roll in the VIDI-studio style, riding over a slow
// ambient dot tunnel.
//
// Every setting is copied verbatim from Julia's "Untitled Project"
// (ac4bce46-6796-4d9d-b8f4-053592059b7d, 9:16 at 120bpm): the roll's green
// (#69a366), thin outline bars (style 0, thickness 0.012) with small diamond
// markers, a 4-beat window, glow 0.55 with ripple 0.6 and a heavy starfield,
// and behind it a dim Wormhole (brightness 0.4, speed 18) multiplied through a
// Parametric Pattern splitter into a slow drifting dot lattice. The splitter's
// amount/copies are the one deliberate departure from the source project
// (1.35/36 in place of its 2.75/153 - a sparser default, per Julia). Only
// the notes are placeholder - her real project's notes came from her own MIDI
// file, which is exactly what the /midi-setup step replaces them with
// (refillMidiRollTrack keeps this track's styling and swaps the pattern).
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
    tracks: [
      // THE track: name + instrument are the refill contract (see
      // refillMidiRollTrack in ProjectStore) - rename it and dropped MIDI
      // mints a plain new track instead of restyling this one.
      track({
        name: 'Midi Roll',
        instrumentId: 'midiRoll',
        color: '#2f86ee',
        params: {
          style: 0,
          thickness: 0.012,
          rounded: 0,
          window: 4,
          maxGap: 0.085,
          marker: 2,
          markerSize: 0.8,
          hitFlash: 0.45,
          ripple: 0.6,
          glow: 0.55,
          stars: 0.85,
        },
        stringParams: { color: '#69a366' },
        blocks: [block(0, BARS, every(16, BARS * 4, FIGURE))],
      }),
      // The ambient backdrop: a dim wormhole with no blocks at all, its dots
      // multiplied through the parametric splitter into a drifting lattice.
      track({
        name: 'Wormhole',
        instrumentId: 'wormhole',
        color: '#2f3aee',
        params: {
          speed: 18,
          radius: 8,
          dotSize: 0.005,
          brightness: 0.4,
          noiseAmount: 0.35,
          viewDistance: 28,
        },
        children: [
          track({
            name: 'Parametric Pattern',
            instrumentId: '',
            type: 'splitter',
            color: '#712fee',
            splitterId: 'parametricPattern',
            inputValues: { amount: 1.35, copies: 36, radius: 0 },
          }),
        ],
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
