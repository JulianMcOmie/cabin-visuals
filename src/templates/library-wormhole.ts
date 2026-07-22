import { doc, track, block, n } from './builder'
import type { TemplateDef } from './library'
import type { Block, Note } from '../editor/types'
import { lyricPattern } from './library-lyrics'

// The Wormhole style: words riding a point tunnel that lurches on every beat.
//
// Every value here is copied verbatim from Julia's project "wormhole template
// reference" (561890ec-658f-498a-8c51-58e7bb93308f, Save Your Tears at 118bpm),
// tuned by hand against the real song. Only the words are placeholder, since
// transcription replaces them while keeping this styling.
//
// Brightness, Warp Scale and Ring Detail are all pinned to their maximum: a
// blown-out, heavily warped tube at the densest lattice the instrument offers.
// Ring Detail 192 is the expensive one (~74k points per tube, both tubes sharing
// the one geometry); it is what makes the walls read as solid rather than
// speckled, so drop it before dropping anything else if this needs to get cheaper.
//
// Flight Speed 40 was ALSO the maximum when this was tuned - the ceiling has since
// been raised to 200, and 40 is simply where it was left rather than a considered
// choice. Worth re-testing against the new range before treating it as final.
//
// The two deliberate mid-range values carry the look: Tunnel Width 7.8 (near the
// top of 0.5-8) puts the camera well inside a wide tube rather than threading a
// pipe, and View Distance 67 of a possible 250 keeps the far end fading out, so
// the motion reads as speed instead of a static starfield.

const BARS = 16
// 512 = MAX_TOTAL_BARS, the project-length ceiling. The block is authored to it
// and trimmed back to the song's end on apply (see songEndBars) - the template
// cannot know how long the song is, so it claims the ceiling and gets cut down.
const CEILING_BARS = 512

/** A ceiling-length loop block whose pattern window is `loopBars`. */
function loopBlock(loopBars: number, notes: Note[]): Block {
  return { ...block(0, CEILING_BARS, notes), loop: true, loopLengthBars: loopBars }
}

// Julia's pattern: one bar, four on the floor, alternating the top row of the
// pulse ladder with the middle. Row 8 (67) is the full-force hit and row 5 (64)
// is roughly a third of it, so the tunnel reads as strong/weak/strong/weak
// rather than a flat metronome. Short notes - only the onset matters, the
// envelope owns everything after it.
const PULSE_PATTERN: Note[] = [
  n(0, 67, 0.25, 100),
  n(1, 64, 0.25, 100),
  n(2, 67, 0.25, 100),
  n(3, 64, 0.25, 100),
]

function wormholeDocument() {
  const words = lyricPattern()
  return doc({
    bpm: 120,
    totalBars: BARS,
    tracks: [
      // Hot pink Bebas Neue in FLIGHT mode - the words rush the camera and tumble
      // as they go, so they travel with the tunnel instead of hanging in front of
      // it. Condensed caps at full glow survive a wall running at Brightness 3
      // where the earlier plain face did not, and the black stroke is what stops
      // the pink dissolving into the cyan the moment the two overlap.
      track({
        name: 'Lyrics',
        instrumentId: 'textDisplay',
        color: '#e4e4e7',
        params: {
          font: 7, // Poster (Bebas Neue)
          fontSize: 0.9,
          opacity: 1,
          colorMode: 0,
          glow: 1,
          strokeWidth: 0.2,
          onsetBounce: 0.08,
          releaseDuration: 0.4,
          rainbowEnabled: 0,
          flightEnabled: 1,
          flightTumble: 5,
          flightSubdivRate: 2,
          // Backdrop is OFF (shape 0). The colour and opacity are carried anyway
          // so switching the shape on lands on Julia's staged cyan rather than a
          // default black slab.
          backdropShape: 0,
          backdropPad: 0,
          backdropOpacity: 0.5,
        },
        stringParams: {
          text: words.text,
          color: '#fe39a2',
          strokeColor: '#000000',
          backdropColor: '#02beed',
        },
        blocks: [block(0, BARS, words.notes)],
      }),
      track({
        name: 'Wormhole',
        instrumentId: 'wormhole',
        color: '#22d3ee',
        params: {
          speed: 40,
          radius: 7.8,
          brightness: 3,
          noiseScale: 0.5,
          ringDetail: 192,
          viewDistance: 67,
        },
        blocks: [loopBlock(1, PULSE_PATTERN)],
      }),
    ],
  })
}

export const wormhole: TemplateDef = {
  id: 'wormhole',
  name: 'Wormhole',
  styleName: 'Wormhole',
  description: 'Words hurtling down an endless point tunnel that lurches on every beat.',
  bpm: 120,
  cardPreview: 'animatedLyric',
  lyricFlow: true,
  hiddenFromGallery: true,
  document: wormholeDocument(),
}
