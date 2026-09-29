import type { ObjectInstrumentDef } from '../types'
import { lazyInstrument } from '../lazyInstrument'
import type { CodeInstrumentSpec } from './types'
import { toMidiRows, toParamDefs } from './params'
import { publishSpec, stableView } from './live'
import { autoPanel } from './panel'

export { p, rowsFrom, toMidiRows, toParamDefs } from './params'

// defineInstrument: turn a code-instrument spec into an ordinary
// ObjectInstrumentDef the whole app already understands (registry, resolver,
// settings panel, MIDI editor, export). The R3F host that runs setup/frame is
// the shared lazy chunk CodeInstrumentView - this file stays React-free and
// node-importable, so tools can read a pack's params and rows without a browser.
//
// Defining IS publishing: the call hands the spec to the live registry
// (live.ts), and the def's component is the one stable view for this id - so
// when a hot reload re-runs the instrument's module, the running view swaps to
// the new code on its next frame instead of remounting (see live.ts).

/** A def produced from a code spec. `code` carries the spec for the runtime. */
export interface CodeInstrumentDef extends ObjectInstrumentDef {
  code: CodeInstrumentSpec
}

export function isCodeInstrument(def: ObjectInstrumentDef | undefined): def is CodeInstrumentDef {
  return !!def && 'code' in def && !!(def as CodeInstrumentDef).code
}

const ID_PATTERN = /^[a-z0-9][a-z0-9-]*\.[a-zA-Z0-9][a-zA-Z0-9_-]*$/

export function defineInstrument<S = any>(spec: CodeInstrumentSpec<S>): CodeInstrumentDef {
  if (!ID_PATTERN.test(spec.id)) {
    throw new Error(`defineInstrument: id "${spec.id}" must look like "<pack>.<name>" (lowercase pack, e.g. "innuendo.chladni")`)
  }
  const def: CodeInstrumentDef = {
    id: spec.id,
    name: spec.name,
    kind: 'object',
    params: toParamDefs(spec.params),
    midiRows: toMidiRows(spec.rows),
    identityColor: spec.color,
    userInterfaceRenderer: 'parameters',
    // a console panel: the spec's own, or one built from its params ('auto', the default)
    panelSpec: spec.panel === false ? undefined : spec.panel && spec.panel !== 'auto' ? spec.panel : autoPanel(spec as CodeInstrumentSpec),
    fullFrame: spec.fullFrame,
    defaultOnTop: spec.onTop,
    castsShadows: spec.castsShadows,
    // One lazy host per id for the page's lifetime: it runs whatever spec is
    // newest for this id (CodeInstrumentView + live.ts).
    component: stableView(spec.id, () => lazyInstrument(() => import('./CodeInstrumentView').then((m) => m.codeViewFor(spec.id)))),
    code: spec as CodeInstrumentSpec,
  }
  publishSpec(spec as CodeInstrumentSpec)
  return def
}
