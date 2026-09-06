'use client'

import type { ObjectInstrumentDef } from './types'
import { lazyInstrument } from './lazyInstrument'

// The Video instrument: an ordered bank of the user's own clips, cut by MIDI.
// A note-on selects clip (pitch − VIDEO_BASE_PITCH) mod clipCount and restarts it;
// the clip latches until the next note-on, bounded by its block.
//
// Rendering is the mediabunny decode engine (core/video/decodeEngine), NOT a
// <video> element - element seeking could not do instant, re-triggerable cuts.
// The engine keeps each clip's head decoded and warm, so a note-triggered
// restart lands on a cached frame the next display tick.
//
// Pause invariant: the frame at a beat is f(beat, notes). The active clip and
// its source-time are derived purely (activeVideoAt + clipTimeAt); the engine
// draws exactly that. Live playback serves from the warm buffer; export serves
// frame-exact (engine.drawExact); a paused decode arrival redraws the last
// request (the frame callback is skip-gated and won't re-fire on its own).
//
// VideoVisual registers the export frame preparer while mounted.

export const videoInstrument: ObjectInstrumentDef = {
  id: 'video',
  name: 'Video',
  kind: 'object',
  identityColor: '#8b5cf6',
  userInterfaceRenderer: 'video',
  params: [
    { key: 'loop', label: 'Loop Clips', type: 'boolean' as const, default: 1 },
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
    // Escape hatch for phone footage whose orientation lives in metadata the
    // decode engine doesn't apply - the clip-bank preview (<video>, which does)
    // looks upright while the render comes out sideways.
    {
      key: 'rotate',
      label: 'Rotate',
      type: 'select' as const,
      options: [
        { value: 0, label: 'None' },
        { value: 1, label: '90° clockwise' },
        { value: 2, label: '180°' },
        { value: 3, label: '90° counter-clockwise' },
      ],
      default: 0,
    },
  ],
  // The Video track's MIDI editor shows only its clip rows (generateVideoClipRows).
  // A full-frame layer: the renderer pins it dead-ahead of the camera, parallel
  // to it, so footage reads as a screen — never a tilted plane in space.
  fullFrame: true,
  component: lazyInstrument(() => import('./VideoVisual').then((m) => m.VideoComponent)),
}
