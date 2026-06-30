import { evaluateModulator } from './modulators'
import type { ResolvedGraph } from './types'

type PortValues = Record<string, number>

/**
 * The per-frame modulation matrix. Evaluate every modulator's output, then for
 * each object's port combine the routings that hit it (per the port's rule),
 * starting from the port's resting default. Writes portValues per object into
 * `out`. Cheap arithmetic — the graph/routing structure was built at resolve.
 */
export function runMatrix(graph: ResolvedGraph, beat: number, out: Map<string, PortValues>) {
  const modOutput = new Map<string, number>()
  for (const mod of graph.modulators) modOutput.set(mod.id, evaluateModulator(mod, beat))

  for (const obj of graph.objects) {
    const portValues: PortValues = {}
    for (const port of obj.ports) {
      let v = port.default
      for (const mod of graph.modulators) {
        if (mod.targetObjectId !== obj.trackId || mod.targetPort !== port.key) continue
        v = combine(port.combine, v, modOutput.get(mod.id) ?? 0)
      }
      portValues[port.key] = port.range ? clamp(v, port.range[0], port.range[1]) : v
    }
    out.set(obj.trackId, portValues)
  }
}

function combine(rule: 'add' | 'multiply' | 'max' | 'replace', a: number, b: number): number {
  switch (rule) {
    case 'add': return a + b
    case 'multiply': return a * b
    case 'max': return Math.max(a, b)
    case 'replace': return b
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}
