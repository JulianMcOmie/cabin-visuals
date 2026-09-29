// Meter decoder startup, not playback. A stalled request must not hold the
// whole library hostage; cancellation removes queued work before it starts.
export function createClipLoadQueue(limit = 3, timeoutMs = 8000) {
  let active = 0
  const pending = new Set<() => void>()
  return function acquire(start: (done: () => void) => void): () => void {
    let finished = false
    let granted = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const done = () => {
      if (finished) return
      finished = true
      pending.delete(grant)
      clearTimeout(timer)
      if (granted) active--
      if (active < limit) pending.values().next().value?.()
    }
    const grant = () => {
      pending.delete(grant)
      granted = true
      active++
      timer = setTimeout(done, timeoutMs)
      start(done)
    }
    if (active < limit) grant()
    else pending.add(grant)
    return done
  }
}

export const acquireClipLoad = createClipLoadQueue()
