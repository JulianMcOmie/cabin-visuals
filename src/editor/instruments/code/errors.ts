// Errors thrown by code instruments / post passes / compositions. A throwing
// instrument must never take the frame down with it: the runtime catches, logs
// ONCE per distinct message, and records it here so tools can read it back
// (`window.__cabinCodeErrors()`, used by `cabin shot` to print failures next to
// the pictures). A failing frame renders whatever the instrument last posed.

export type CodePhase = 'setup' | 'frame' | 'post' | 'composition' | 'dispose' | 'camera' | 'look'

export interface CodeError {
  id: string
  trackId: string
  phase: CodePhase
  message: string
  stack?: string
  beat: number
  count: number
}

const errors = new Map<string, CodeError>()
const listeners = new Set<() => void>()
let version = 0
const changed = () => { version++; for (const fn of listeners) fn() }

/** For useSyncExternalStore: the track rows show an error badge. */
export function subscribeCodeErrors(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}
export function codeErrorsVersion(): number { return version }

/** The first error recorded for a track (its row's badge), or undefined. */
export function codeErrorForTrack(trackId: string): CodeError | undefined {
  for (const e of errors.values()) if (e.trackId === trackId) return e
  return undefined
}

export function reportCodeError(id: string, trackId: string, phase: CodePhase, err: unknown, beat: number): void {
  const e = err instanceof Error ? err : new Error(String(err))
  const key = `${id}|${phase}|${e.message}`
  const prev = errors.get(key)
  if (prev) {
    prev.count++
    return
  }
  errors.set(key, { id, trackId, phase, message: e.message, stack: e.stack, beat, count: 1 })
  changed()
  console.error(`[code instrument ${id}] ${phase} failed at beat ${beat.toFixed(3)}: ${e.message}`, e)
}

export function listCodeErrors(): CodeError[] {
  return [...errors.values()]
}

export function clearCodeErrors(): void {
  errors.clear()
  changed()
}

if (typeof window !== 'undefined') {
  const w = window as unknown as Record<string, unknown>
  w.__cabinCodeErrors = listCodeErrors
  w.__cabinClearCodeErrors = clearCodeErrors
}
