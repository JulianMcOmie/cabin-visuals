import { doc, track, block, n } from './builder'
import type { TemplateDef } from './library'
import type { VideoClip } from '../editor/store/VideoStore'
import type { Note } from '../editor/types'

// Promo Cuts: a shot-for-shot rebuild of a reference short-form promo
// (beatsee.app's TikTok, 26s) - measured, not approximated. The reference was
// frame-scanned for cut points (ffmpeg scene detection + manual frame reads)
// and its voiceover word-timestamped with whisper; every shot below carries
// what the original had at that moment, and the caption stream is the
// original's script word for word.
//
// The audio is a SHIPPED TTS VOICEOVER of that exact script (ElevenLabs,
// "Liam - Energetic, Social Media Creator" - the reference's archetype), plus
// a quiet synthesized funk bed (104bpm, A minor - it is mixed low in the FILE
// because tracks have no gain control). The whole timeline - caption notes AND
// cut notes - sits on the voiceover's FORCED-ALIGNMENT word timestamps
// (ElevenLabs forced alignment, the same engine the lyric pipeline trusts),
// and the cuts are expressed as word anchors: retime the words and the cuts
// follow. Change the script later, regenerate a voiceover, align, retime.
//
// The reference's grammar, preserved here:
//   - hard cuts only, no dissolves - the pacing IS the transition
//   - one white bold caption word per voiceover word, centered a touch below
//     middle, popping on its word's onset
//   - shots: cold-open visual → laptop reveal → studio b-roll escalating to
//     the "posted it, 10 views" joke (black frame + meme beat) → product
//     reveal montage quickening through ~0.5s flashes → feature tour →
//     UI panel captures → logo end card sitting alone
//
// Placeholder clips in /public/templates/promo name each shot exactly
// ("LAPTOP REVEAL - handheld reveal: laptop playing a visual", ...). Swap
// them in the Video track's bank; timing lives in MIDI and survives.
//
// The reference is 9:16 and so is this template: the document carries
// viewAspect '9:16', applied when a project is CREATED from it (switching
// templates in-editor never reshapes an existing canvas). The voiceover and
// music arrive on creation the same way.
//
// UNLISTED: private while in development - it appears in no gallery or
// Templates tab, only by direct link: /editor?template=promoCuts

const BPM = 120
/** Seconds → beats at 120 (the voiceover timeline is measured in seconds). */
const B = (sec: number) => sec * 2
const BARS = 14 // 28s: the 23.3s voiceover plus the end card holding

// ── The script, word by word, at the voiceover's forced-alignment times ──────
// [caption, startSec] - ElevenLabs forced alignment of the shipped read.
const WORDS: [string, number][] = [
  ['THIS', 0.1], ['SITE', 0.34], ['HAS', 0.58], ['BEEN', 0.72], ['HIDDEN', 0.88], ['FOR', 1.12], ['WEEKS.', 1.36],
  ['SO', 2.14], ["YOU'VE", 2.3], ['MADE', 2.52], ['A', 2.66], ['TRACK.', 2.78], ["YOU'RE", 3.56], ['HYPED.', 3.78],
  ['YOU', 4.52], ['WANT', 4.66], ['TO', 4.76], ['SHARE', 4.94], ['IT.', 5.16],
  ['SO', 5.68], ['YOU', 5.82], ['SCREEN', 6.02], ['RECORD', 6.34], ['FL', 6.84], ['STUDIO,', 7.14],
  ['POST', 7.96], ['IT,', 8.26], ['AND', 8.8], ["YOU'VE", 8.96], ['GOT', 9.14], ['10', 9.4], ['VIEWS.', 9.68],
  ['SO', 10.9], ['I', 11.14], ['HAVE', 11.26], ['THE', 11.38], ['PERFECT', 11.56], ['SITE', 11.96], ['FOR', 12.22], ['YOU.', 12.42],
  ['BEATSEE.APP', 12.92],
  ['DROP', 14.6], ['A', 14.82], ['TRACK,', 14.94], ['CUSTOMIZE', 15.66], ['YOUR', 16.14], ['VISUALS,', 16.3],
  ['AND', 16.9], ['EXPORT.', 17.2],
  ['YOU', 18.56], ['CAN', 18.66], ['USE', 18.8], ['IT', 18.94], ['TOTALLY', 19.14], ['FOR', 19.58], ['FREE,', 19.78],
  ['AND', 20.5], ['THERE', 20.62], ['IS', 20.74], ['MORE', 20.96], ['THAN', 21.16], ['80', 21.42], ['EFFECTS', 21.66],
  ['AND', 22.08], ['40', 22.3], ['VISUALIZERS.', 22.6],
]

// Each caption holds until the next word (so phrases read continuously) but
// drops during real pauses instead of lingering through them.
const CAPTION_NOTES: Note[] = WORDS.map(([, sec], i) => {
  const next = WORDS[i + 1]?.[1]
  const holdSec = next !== undefined ? Math.min(next - sec - 0.02, 1.1) : 0.9
  return n(B(sec), 48, B(Math.max(0.2, holdSec)))
})

// ── The shot list: the reference's 20 cuts, anchored to WORDS ────────────────
// [padIndex, captionIndex, offsetSec] - each cut is expressed relative to the
// caption word it sat on in the reference, so retiming the words (new script,
// new voiceover, new alignment) carries the cuts along automatically. Pad
// index n answers pitch 48+n; a clip latches until the next cut.
const CUT_ANCHORS: [number, number, number][] = [
  [0, 0, -10],     // cold open: waveform visual (clamps to 0)
  [1, 1, 0.09],    // handheld laptop reveal, playing a visual - the hook line
  [2, 8, 0],       // studio b-roll: producer at laptop ("you've made a track")
  [3, 14, 0],      // screen close-up: DAW on the monitors ("you want to share it")
  [4, 19, 0],      // raw FL Studio screen capture ("so you screen record")
  [5, 23, 0],      // prop shot: hand holding a phone ("FL Studio, post it")
  [6, 27, 0],      // hard black - the caption alone carries "and you've got"
  [7, 30, 0],      // reaction meme, letterboxed ("10 views")
  [8, 33, 0],      // laptop running the product, feature open ("I have the perfect")
  [9, 38, 0],      // full-frame glitch visual ("site for you")
  [10, 39, 0.3],   // ~0.5s glitch-art flash - the montage quickens
  [11, 40, -0.2],  // brand burst: particles + name ("BEATSEE.APP")
  [12, 40, 0.43],  // laptop playing an album-art visual
  [13, 43, -0.3],  // product UI again, another feature ("drop a track, customize")
  [14, 47, -0.1],  // bold full-frame visual pop ("and")
  [15, 48, 0],     // quick art collage ("export")
  [16, 52, 0.09],  // glitch text-art clip ("use it totally")
  [17, 55, -0.06], // screen capture: effects panel scroll ("80 effects")
  [18, 63, 0],     // screen capture: visualizer grid ("40 visualizers")
  [19, 65, 1.3],   // end card: logo on black, holds to the end
]

const VIDEO_CUTS: Note[] = CUT_ANCHORS.map(([pad, word, offset]) =>
  n(B(Math.max(0, WORDS[word][1] + offset)), 48 + pad, 0.5))

// ── The pad bank: one placeholder per shot, named for what to film ───────────
const SHOTS: string[] = [
  'Waveform visual (placeholder)',
  'Laptop reveal - playing a visual (placeholder)',
  'Studio b-roll - producer at laptop (placeholder)',
  'Screen close-up - DAW (placeholder)',
  'Screen recording - FL Studio (placeholder)',
  'Prop shot - hand-held phone (placeholder)',
  'Black screen - caption only (placeholder)',
  'Reaction meme, letterboxed (placeholder)',
  'Product UI 1 (placeholder)',
  'Glitch visual, full frame (placeholder)',
  'Glitch art flash (placeholder)',
  'Brand burst (placeholder)',
  'Laptop - album-art visual (placeholder)',
  'Product UI 2 (placeholder)',
  'Visual pop, full frame (placeholder)',
  'Collage flash (placeholder)',
  'Text glitch (placeholder)',
  'Effects panel capture (placeholder)',
  'Visualizer panel capture (placeholder)',
  'End card - logo on black (placeholder)',
]

const padRef = (i: number) => `/templates/promo/shot-${String(i + 1).padStart(2, '0')}.mp4`

const PROMO_CLIPS: Record<string, VideoClip> = Object.fromEntries(
  SHOTS.map((fileName, i) => [padRef(i), { ref: padRef(i), fileName, duration: 4, width: 480, height: 854 }]),
)

function promoDocument() {
  return doc({
    bpm: BPM,
    totalBars: BARS,
    viewAspect: '9:16',
    videoClips: PROMO_CLIPS,
    audio: [
      {
        name: 'Voiceover',
        ref: '/templates/promo/voiceover.mp3',
        fileName: 'Promo voiceover (TTS placeholder)',
        duration: 23.32,
      },
      {
        name: 'Music',
        ref: '/templates/promo/music.mp3',
        fileName: 'Groove bed (placeholder)',
        duration: 32,
        trimEnd: 28, // end with the project, not the file
      },
    ],
    tracks: [
      // The reference's caption treatment: white heavy sans, LARGE, one word
      // at a time slightly below center, soft drop shadow (no stroke - the
      // reference's words float on the footage, they aren't outlined).
      track({
        name: 'Captions',
        instrumentId: 'textDisplay',
        color: '#e4e4e7',
        params: {
          font: 0, // Arial Black / Impact stack
          // Sized for a 9:16 canvas, where Text Display keys off the narrow
          // WIDTH: the widest words (VISUALIZERS., BEATSEE.APP) hit the 3:1
          // canvas-aspect cap, so their plane spans fontSize * 0.6 * 3 of the
          // frame width - 0.5 lands them at ~90% with short words at ~30%,
          // the reference's proportions. 1.0 overflowed both edges.
          fontSize: 0.5,
          strokeWidth: 0,
          shadow: 0.6,
          opacity: 1,
          glow: 0,
          onsetBounce: 0.06,
          releaseDuration: 0.2,
          posY: -0.1,
        },
        stringParams: {
          text: WORDS.map(([w]) => w).join(' '),
          color: '#ffffff',
          strokeColor: '#000000',
        },
        blocks: [block(0, BARS, CAPTION_NOTES)],
      }),
      track({
        name: 'Footage',
        instrumentId: 'video',
        color: '#f59e0b',
        params: { loop: 1, fit: 0 },
        videoPads: SHOTS.map((_, i) => ({ ref: padRef(i), inPoint: 0 })),
        blocks: [block(0, BARS, VIDEO_CUTS)],
      }),
    ],
  })
}

export const promoCuts: TemplateDef = {
  id: 'promoCuts',
  name: 'Promo Cuts',
  description: 'A measured rebuild of the short-form product promo: 20 hard cuts, a caption word per voiceover word, TTS voiceover included.',
  bpm: BPM,
  unlisted: true,
  document: promoDocument(),
}
