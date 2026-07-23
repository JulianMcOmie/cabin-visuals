import { doc, track, block, n } from './builder'
import type { TemplateDef } from './library'
import type { Block, Note } from '../editor/types'
import { lyricPattern } from './library-lyrics'

// The Neon Psychedelic style: small acid-green words drifting over a dim tunnel
// that has been fanned into a radial kaleidoscope.
//
// Every value here is copied verbatim from Julia's project "Neon Psychedelic
// template reference" (Save Your Tears at 118bpm), tuned by hand against the
// real song. Only the words are placeholder, since transcription replaces them
// while keeping this styling.
//
// It shares the Wormhole style's skeleton - same tunnel instrument, same pulse,
// same placement lanes - but inverts the emphasis. Where Wormhole is a blown-out
// wall (Brightness 3) with big rainbow words flying at the camera, this one runs
// the tunnel at Brightness 0.1 and Speed 200: nearly dark, moving as fast as the
// instrument allows, so it reads as streaks rather than a surface. The words sit
// back at 20% opacity in a fixed acid green instead of rushing forward.
//
// The Radial splitter is what makes it "psychedelic": 13 copies of the tunnel
// fanned around the view plane, so the streaks become a kaleidoscope. It is a
// CHILD of the tunnel track, and its own note stream gates when the fan is live.
const BARS = 16
// 512 = MAX_TOTAL_BARS, the project-length ceiling. The block is authored to it
// and trimmed back to the song's end on apply (see songEndBars) - the template
// cannot know how long the song is, so it claims the ceiling and gets cut down.
const CEILING_BARS = 512

/** A ceiling-length loop block whose pattern window is `loopBars`. */
function loopBlock(loopBars: number, notes: Note[]): Block {
  return { ...block(0, CEILING_BARS, notes), loop: true, loopLengthBars: loopBars }
}

// Four on the floor alternating the top of the pulse ladder with the middle, so
// the tunnel reads as strong/weak/strong/weak rather than a flat metronome.
// Short notes - only the onset matters, the envelope owns everything after it.
const PULSE_PATTERN: Note[] = [
  n(0, 67, 0.25, 100),
  n(1, 64, 0.25, 100),
  n(2, 67, 0.25, 100),
  n(3, 64, 0.25, 100),
]

function neonPsychedelicDocument() {
  const words = lyricPattern()
  return doc({
    bpm: 120,
    totalBars: BARS,
    tracks: [
      // Righteous at 40% size and 20% opacity - deliberately small and faint, so
      // the words read as part of the light rather than a caption over it. Flight
      // and rainbow are both OFF (the Wormhole style's two loudest features): the
      // words hold still in one green while the tunnel does the moving.
      track({
        name: 'Lyrics',
        instrumentId: 'textDisplay',
        color: '#e4e4e7',
        params: {
          font: 8, // Neon (Righteous)
          fontSize: 0.4,
          opacity: 0.2,
          colorMode: 0,
          glow: 0,
          hue: 0,
          strokeWidth: 0.08,
          // Glow is off, but contained-glow rides along so turning glow up lands
          // on a halo clipped at the stroke rather than one washing over it.
          glowContained: 1,
          onsetBounce: 0.09,
          releaseDuration: 0.5,
          // Size latches per word, so the Font Size lane below gives each word
          // its own size instead of resizing everything on screen together.
          sizeMode: 1,
          rainbowEnabled: 0,
          rainbowCycleLength: 64,
          flightEnabled: 0,
          flightSpeed: 60,
          flightTumble: 2.2,
          flightSubdivRate: 2,
        },
        stringParams: {
          text: words.text,
          color: '#54e316',
          strokeColor: '#000000',
        },
        blocks: [block(0, BARS, words.notes)],
        // Placement and size lanes, all STEP: each word snaps to its spot and
        // its size and holds both while it fades, which is what posMode/sizeMode
        // per-word latching exists to preserve. Ramping instead would slide and
        // resize every word live, chasing whatever the newest word is set to.
        children: [
          track({
            name: 'Position X',
            instrumentId: '',
            type: 'automation',
            color: '#e4e4e7',
            targetParam: 'posX',
            interpolation: 'step',
            blocks: [loopBlock(16, [
              n(0, 60, 8, 100), n(8, 56, 8, 100), n(16, 64, 8, 100), n(24, 68, 8, 100),
              n(32, 56, 8, 100), n(40, 68, 8, 100), n(48, 64, 8, 100), n(56, 60, 8, 100),
            ])],
          }),
          track({
            name: 'Position Y',
            instrumentId: '',
            type: 'automation',
            color: '#e4e4e7',
            targetParam: 'posY',
            interpolation: 'step',
            blocks: [loopBlock(16, [
              n(0, 60, 8, 100), n(8, 68, 8, 100), n(16, 64, 8, 100), n(24, 56, 8, 100),
              n(32, 60, 8, 100), n(40, 52, 8, 100), n(48, 56, 8, 100), n(56, 60, 8, 100),
            ])],
          }),
          // A tighter size range than Wormhole's (40-44, not 40-52): these words
          // are small to begin with, so the variation is a flicker in scale
          // rather than a jump. The quarter-beat offsets land the size step just
          // after the placement step instead of on top of it.
          track({
            name: 'Font Size',
            instrumentId: '',
            type: 'automation',
            color: '#e4e4e7',
            targetParam: 'fontSize',
            interpolation: 'step',
            blocks: [loopBlock(16, [
              n(0, 44, 8, 100), n(8.25, 40, 8, 100), n(16, 44, 8, 100), n(24.25, 40, 8, 100),
              n(32.25, 44, 8, 100), n(40.25, 40, 8, 100), n(48.25, 44, 8, 100), n(56.25, 44, 8, 100),
            ])],
          }),
        ],
      }),
      track({
        name: 'Wormhole',
        instrumentId: 'wormhole',
        color: '#22d3ee',
        params: {
          // Speed 200 is the instrument's ceiling and Brightness 0.1 is nearly
          // its floor - the pairing is the whole look: barely-lit walls moving
          // fast enough to smear into streaks.
          speed: 200,
          radius: 7.8,
          brightness: 0.1,
          noiseScale: 0.5,
          ringDetail: 192,
          colorSpread: 1,
          viewDistance: 67,
        },
        blocks: [loopBlock(1, PULSE_PATTERN)],
        children: [
          track({
            name: 'Radial',
            instrumentId: '',
            type: 'splitter',
            splitterId: 'radial',
            color: '#6366f1',
            inputValues: { plane: 0, copies: 13, radius: 10 },
            // Eight short gates alternating pitch every two bars, plus one note
            // held across the whole 4-bar window - the sustained copy keeps the
            // fan present while the short ones re-trigger it on the beat.
            blocks: [loopBlock(4, [
              n(0, 60, 16, 100),
              n(1, 64, 0.25, 100), n(3, 64, 0.25, 100), n(5, 64, 0.25, 100), n(7, 64, 0.25, 100),
              n(9, 65, 0.25, 100), n(11, 65, 0.25, 100), n(13, 65, 0.25, 100), n(15, 65, 0.25, 100),
            ])],
          }),
        ],
      }),
    ],
  })
}

// Like the Wormhole style, the reference project is 9:16 and templates cannot
// carry a canvas aspect (doc() emits no viewAspect and applyTemplate never
// writes one), so applying this leaves the project's aspect alone.
export const neonPsychedelic: TemplateDef = {
  id: 'neonPsychedelic',
  name: 'Neon Psychedelic',
  styleName: 'Neon Psychedelic',
  description: 'Small acid-green words drifting over a dim tunnel fanned into a kaleidoscope.',
  bpm: 120,
  cardPreview: 'animatedLyric',
  lyricFlow: true,
  hiddenFromGallery: true,
  document: neonPsychedelicDocument(),
}
