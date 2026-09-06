'use client'

import type { ObjectInstrumentDef } from './types'
import { lazyInstrument } from './lazyInstrument'

// The Photo instrument: an ordered bank of the user's own photos, cut by MIDI.
// A note-on selects photo (pitch - PHOTO_BASE_PITCH) mod photoCount and shows
// it full-frame; the photo latches until the next note-on, bounded by its
// block (block-gated visibility). It is the Video instrument minus a timeline:
// a still image has no seeking, no clip time, no decode engine - just a texture.
//
// Between photos it can blend rather than hard-cut: a crossfade, fade-through-
// black, slide/push, wipe, or zoom. The two photos and the blend amount all
// come from photoTransitionAt(beat, notes) - a pure function - so the shader is
// just a viewport-sized plane sampling `from` and `to` at a beat-derived
// progress. Cut (the default) is the same path with progress pinned to 1.
//
// Pause invariant: the frame at a beat is f(beat, notes). A photo loads once
// per ref into a module cache; while paused, a load arrival redraws the last
// request (the frame callback is skip-gated and won't re-fire itself).

// Transition modes, matched to the `transition` param's option values. Kept in
// one place so the param list and the shader agree.
export const MODE_CUT = 0
export const MODE_CROSSFADE = 1
export const MODE_FADE_BLACK = 2
export const MODE_SLIDE = 3
export const MODE_WIPE = 4
export const MODE_ZOOM = 5
export const MODE_BOUNCE = 6

export const photoInstrument: ObjectInstrumentDef = {
  id: 'photo',
  name: 'Photo',
  kind: 'object',
  identityColor: '#f4915d',
  userInterfaceRenderer: 'photo',
  params: [
    {
      key: 'fit',
      label: 'Fit',
      type: 'select' as const,
      options: [
        { value: 0, label: 'Cover (fill, crop edges)' },
        { value: 1, label: 'Fit (letterbox)' },
      ],
      default: 0,
    },
    {
      key: 'transition',
      label: 'Transition',
      type: 'select' as const,
      options: [
        { value: MODE_CUT, label: 'Cut (instant)' },
        { value: MODE_CROSSFADE, label: 'Crossfade' },
        { value: MODE_FADE_BLACK, label: 'Fade through black' },
        { value: MODE_SLIDE, label: 'Slide (push)' },
        { value: MODE_WIPE, label: 'Wipe' },
        { value: MODE_ZOOM, label: 'Zoom' },
        { value: MODE_BOUNCE, label: 'Bounce' },
      ],
      default: MODE_CUT,
    },
    {
      key: 'transitionBeats',
      label: 'Transition length',
      type: 'number' as const,
      min: 0.05,
      max: 4,
      step: 0.05,
      default: 0.5,
    },
  ],
  // The Photo track's MIDI editor shows only its photo rows (generatePhotoRows).
  // A full-frame layer: the renderer pins it dead-ahead of the camera, parallel
  // to it, so the photo reads as a screen - never a tilted plane in space.
  fullFrame: true,
  component: lazyInstrument(() => import('./PhotoVisual').then((m) => m.PhotoComponent)),
}
