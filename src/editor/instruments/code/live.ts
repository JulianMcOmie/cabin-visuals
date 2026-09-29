import type { CodeInstrumentSpec } from './types'

// The LIVE registry: the latest spec for every code instrument id, kept on
// globalThis so it survives hot reloads of the modules around it.
//
// Hot swap, end to end: editing `custom/<pack>/<name>.ts` re-evaluates that
// module, whose `defineInstrument(spec)` call publishes the new spec here.
// The instrument's view component is stable per id (stableView), reads
// `latestSpec(id)` every frame, and when the spec object changed it tears the
// old setup down and runs the new one - on the next frame, with the engine,
// the stores and the page untouched. Metadata (params, rows) reaches the app
// registry through code/register.tsx, which re-runs with the edited module
// and triggers a re-resolve.

interface LiveState {
  specs: Map<string, CodeInstrumentSpec>
  views: Map<string, unknown>
  specListeners: Set<(id: string) => void>
  registryListeners: Set<() => void>
  registryVersion: number
}

const holder = globalThis as unknown as { __cabinCodeLive?: LiveState }
const live: LiveState = (holder.__cabinCodeLive ??= {
  specs: new Map(),
  views: new Map(),
  specListeners: new Set(),
  registryListeners: new Set(),
  registryVersion: 0,
})

/** Record the newest spec for its id; views running an older one swap on their next frame. */
export function publishSpec(spec: CodeInstrumentSpec) {
  const prev = live.specs.get(spec.id)
  live.specs.set(spec.id, spec)
  if (prev && prev !== spec) for (const fn of live.specListeners) fn(spec.id)
}

/** The newest spec for an instrument id (undefined until its module has loaded). */
export function latestSpec(id: string): CodeInstrumentSpec | undefined {
  return live.specs.get(id)
}

/** Called with the id whenever an already-published instrument gets a new spec. */
export function onSpecSwap(fn: (id: string) => void): () => void {
  live.specListeners.add(fn)
  return () => { live.specListeners.delete(fn) }
}

/** One value per id for the life of the page (the view component, so a hot swap never remounts). */
export function stableView<T>(id: string, make: () => T): T {
  let v = live.views.get(id) as T | undefined
  if (v === undefined) {
    v = make()
    live.views.set(id, v)
  }
  return v
}

/** Bumped by code/register.tsx after (re)registering code instruments/compositions. */
export function bumpRegistry() {
  live.registryVersion++
  for (const fn of live.registryListeners) fn()
}

export function registryVersion(): number {
  return live.registryVersion
}

export function onRegistryChange(fn: () => void): () => void {
  live.registryListeners.add(fn)
  return () => { live.registryListeners.delete(fn) }
}
