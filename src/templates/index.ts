// Templates: canned project documents a user can start from (projects page)
// or demo without an account (/editor?template=<id>). Adding a template = one
// entry in a library volume; nothing else hardcodes the list.

export { type TemplateDef } from './library'
import { TEMPLATES as VOL1, type TemplateDef } from './library'
import { slideshow } from './library-slideshow'
import { LYRIC_TEMPLATES } from './library-lyrics'

// Lyric videos lead (the product's current wedge), then Slideshow - the two
// "bring your own material" starting points - then the showcase volume.
export const TEMPLATES: TemplateDef[] = [...LYRIC_TEMPLATES, slideshow, ...VOL1]

// Every template document carries its own id, so a project created from (or
// switched onto) it remembers which template it is on - the editor's Templates
// tab marks that card as current. Stamped centrally so template volumes don't
// each repeat the wiring. (Lyric styles stamp themselves in their factory.)
for (const t of TEMPLATES) t.document.appliedTemplateId = t.id

export function getTemplate(id: string): TemplateDef | undefined {
  return TEMPLATES.find((t) => t.id === id)
}
