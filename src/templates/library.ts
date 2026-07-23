import type { ProjectDocument } from '../persistence/types'

// The template library's shared shape. Each volume (library-*.ts) exports
// complete v2 project documents that index.ts assembles into the live list.
// (The original showcase volume lived in this file; its last entry,
// Hyperspeed, was retired on 2026-07-23.)

export interface TemplateDef {
  id: string
  name: string
  description: string
  bpm: number
  /** How the gallery card previews this template. 'video' (default) plays a
   *  captured clip of its real render. 'animatedSlideshow' replaces that with a
   *  bespoke canvas animation, because Slideshow's real render is blank until
   *  the user adds photos - it is the one value the preview-capture script
   *  skips. 'animatedLyric' is video-FIRST: it plays the captured clip when one
   *  exists and falls back to a canvas word-pop until then, so lyric templates
   *  are still captured by `npm run previews`. */
  cardPreview?: 'video' | 'animatedSlideshow' | 'animatedLyric'
  /** A lyric template: ships a root 'Lyrics' Text Display track (the refill /
   *  carry-over contract), and applying it to a not-yet-transcribed project
   *  continues into the lyric setup flow (song → transcribe → align → style).
   *  These are also each other's STYLES: the setup flow's last step offers all
   *  of them, and a project already on one only ever sees these in the
   *  editor's Templates tab - a lyric project has no use for Slideshow. */
  lyricFlow?: boolean
  /** Name to use when this is offered as a style rather than as a template
   *  ("Minimal" reads better than "Lyric Video" in a list of looks). */
  styleName?: string
  /** Kept out of the projects-page "start from a template" gallery. The lyric
   *  styles live here: you pick a look AFTER there is a song to hear it
   *  against, so the gallery shows one lyric entry rather than three. */
  hiddenFromGallery?: boolean
  document: ProjectDocument
}
