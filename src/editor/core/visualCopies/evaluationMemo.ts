/** Scratch memo tables live only for one synchronous visual evaluation. Nested
 * frame chains share the scope, including interleaved copy clocks, but the next
 * frame/document/seek starts empty. No beat history is retained by closures. */
let current: Map<object, Map<unknown, unknown>> | undefined

export function withCopyEvaluation<T>(evaluate: () => T): T {
  if (current) return evaluate()
  current = new Map()
  try {
    return evaluate()
  } finally {
    current = undefined
  }
}

/** Use only for a pure calculation whose complete varying input is `key`.
 * Resolved immutable inputs belong in the closure; copy position/index/color
 * must stay outside a beat-only memo. Direct callers outside an evaluation
 * compute normally. Returned values are read-only scratch for the scope. */
export function memoizeEvaluation<K, V>(compute: (key: K) => V): (key: K) => V {
  const owner = {}
  return (key) => {
    if (!current) return compute(key)
    let values = current.get(owner)
    if (!values) { values = new Map(); current.set(owner, values) }
    if (values.has(key)) return values.get(key) as V
    const value = compute(key)
    values.set(key, value)
    return value
  }
}
