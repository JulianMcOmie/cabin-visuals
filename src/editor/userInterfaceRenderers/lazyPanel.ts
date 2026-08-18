import { lazy } from 'react'
import type { UserInterfaceRendererDefinition } from './types'

// Every bespoke panel is loaded ON DEMAND: the registries stay synchronous
// lookups (`getUserInterfaceRenderer` etc. return a component immediately),
// but the component is a `React.lazy` shell whose module — several of them
// mount their own r3f Canvas, drei helpers and postprocessing — is only
// fetched the first time a track that names it is selected. The render sites
// in TrackEditor sit under `<Suspense fallback={null}>`, so the only visible
// difference is the panel body arriving one network round-trip after the
// chassis on FIRST selection; once loaded it renders exactly as before.
//
// `lazy` needs a module with a `default` export and these files export named
// definitions, so the loader re-shapes the module on the way in. The name is
// looked up dynamically (not destructured) so the call site stays one line;
// the panel module is needed whole either way.
export function lazyPanel(
  load: () => Promise<{ [K: string]: unknown }>,
  name: string,
): UserInterfaceRendererDefinition {
  return lazy(async () => {
    const m = await load()
    const component = m[name] as UserInterfaceRendererDefinition | undefined
    if (!component) throw new Error(`lazyPanel: module has no export "${name}"`)
    return { default: component }
  })
}
