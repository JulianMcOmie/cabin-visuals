import { doc, track, block, n } from './builder'
import { PHOTO_BASE_PITCH } from '../editor/core/photo/photoTime'
import type { TemplateDef } from './library'

// Slideshow: a bare Photo instrument with one note per beat, pitches climbing
// from PHOTO_BASE_PITCH. The Photo instrument maps (pitch - base) mod photoCount
// to a bank index, so each beat advances to the next photo and wraps around
// however many the user has added - drop photos onto the timeline and they play
// in order, one per beat, with no editing.

const BARS = 16
const BEATS = BARS * 4

// One note on every beat, pitch ascending so consecutive beats select
// consecutive photos (mod the bank size). Held ~a beat so the block reads as a
// full grid; the latch keeps each photo up until the next beat regardless.
const slideshowNotes = Array.from({ length: BEATS }, (_, b) => n(b, PHOTO_BASE_PITCH + b, 0.95, 100))

export const slideshow: TemplateDef = {
  id: 'slideshow',
  name: 'Slideshow',
  description: 'Drop your photos onto the timeline and they cut on every beat, in order.',
  bpm: 120,
  cardPreview: 'animatedSlideshow',
  document: doc({
    bpm: 120,
    totalBars: BARS,
    tracks: [
      track({
        name: 'Photos',
        instrumentId: 'photo',
        color: '#f59e0b',
        blocks: [block(0, BARS, slideshowNotes)],
      }),
    ],
  }),
}
