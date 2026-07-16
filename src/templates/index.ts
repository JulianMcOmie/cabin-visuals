// Templates: canned project documents a user can start from (projects page)
// or demo without an account (/editor?template=<id>). Adding a template = one
// entry in a library volume; nothing else hardcodes the list.

export { type TemplateDef } from './library'
import { TEMPLATES as VOL1, type TemplateDef } from './library'
import { retroArcade } from './library-vol2'
import { slideshow } from './library-slideshow'
import { LYRIC_TEMPLATES } from './library-lyrics'

// Lyric videos lead (the product's current wedge), then Slideshow - the two
// "bring your own material" starting points - then the showcase volumes.
export const TEMPLATES: TemplateDef[] = [...LYRIC_TEMPLATES, slideshow, ...VOL1, retroArcade]

export function getTemplate(id: string): TemplateDef | undefined {
  return TEMPLATES.find((t) => t.id === id)
}
