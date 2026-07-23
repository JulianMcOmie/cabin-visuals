// Templates: canned project documents a user can start from (projects page)
// or demo without an account (/editor?template=<id>). Adding a template = one
// entry in a library volume; nothing else hardcodes the list.

export { type TemplateDef } from './library'
import { type TemplateDef } from './library'
import { slideshow } from './library-slideshow'
import { LYRIC_TEMPLATES } from './library-lyrics'
import { silentFilm } from './library-silent-film'
import { wormhole } from './library-wormhole'
import { neonPsychedelic } from './library-neon-psychedelic'

// Lyric videos lead (the product's current wedge), then Slideshow - the two
// "bring your own material" starting points.
export const TEMPLATES: TemplateDef[] = [...LYRIC_TEMPLATES, silentFilm, wormhole, neonPsychedelic, slideshow]

/** The looks a lyric project can wear, in offer order. These are ordinary
 *  templates that happen to share the Lyrics-track contract, so switching
 *  between them is just applyTemplate (which carries the words across). */
export const LYRIC_STYLES: TemplateDef[] = TEMPLATES.filter((t) => t.lyricFlow)

/** Templates the projects page advertises. The lyric STYLES are excluded:
 *  you choose a look after transcription, not before there is a song. */
export const GALLERY_TEMPLATES: TemplateDef[] = TEMPLATES.filter((t) => !t.hiddenFromGallery)

/** Is this project on a lyric template? Such a project only ever wants lyric
 *  styles offered to it. Falls back to the Lyrics-track contract so a project
 *  whose template id predates this (or was cleared) still counts. */
export function isLyricTemplateId(id: string | null | undefined): boolean {
  return !!id && LYRIC_STYLES.some((t) => t.id === id)
}

// Every template document carries its own id, so a project created from (or
// switched onto) it remembers which template it is on - the editor's Templates
// tab marks that card as current. Stamped centrally so template volumes don't
// each repeat the wiring. (Lyric styles stamp themselves in their factory.)
for (const t of TEMPLATES) t.document.appliedTemplateId = t.id

export function getTemplate(id: string): TemplateDef | undefined {
  return TEMPLATES.find((t) => t.id === id)
}
