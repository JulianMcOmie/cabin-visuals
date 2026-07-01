import type { ResolvedNote } from './types'

// Event-modifier combine functions, ported from Excellent DAW's track types. A
// modifier is a no-instrument child track; resolve folds each one into its parent
// object's note stream in child order via combine(parent, self). `mute` is special:
// it passes events through unchanged but marks blackout regions (handled in resolve).

export type ModifierType = 'add' | 'override' | 'suppress' | 'mute'

const MODIFIER_TYPES = new Set<string>(['add', 'override', 'suppress', 'mute'])

/** A no-instrument track of one of these types is an event modifier. */
export function isModifierType(type: string): type is ModifierType {
  return MODIFIER_TYPES.has(type)
}

/** [start, end) beat span a modifier note covers (min 1/4 beat so a dot still counts). */
function region(n: ResolvedNote): [number, number] {
  return [n.beat, n.beat + (n.durationBeats || 0.25)]
}

type Combine = (parent: ResolvedNote[], self: ResolvedNote[], beatsPerBar: number) => ResolvedNote[]

const COMBINE: Record<ModifierType, Combine> = {
  // Layer self's notes onto the parent (dedup by same beat + pitch).
  add: (parent, self) => {
    const out = [...parent]
    for (const e of self) {
      if (!out.some((p) => p.beat === e.beat && p.pitch === e.pitch)) out.push(e)
    }
    return out.sort((a, b) => a.beat - b.beat)
  },

  // Replace the parent's notes with self's, within the bar range self spans.
  override: (parent, self, beatsPerBar) => {
    if (self.length === 0) return parent
    if (parent.length === 0) return self
    const minTime = Math.min(...self.map((e) => e.beat))
    const maxTime = Math.max(...self.map((e) => e.beat))
    const rangeStart = Math.floor(minTime / beatsPerBar) * beatsPerBar
    const rangeEnd = (Math.floor(maxTime / beatsPerBar) + 1) * beatsPerBar
    const kept = parent.filter((e) => e.beat < rangeStart || e.beat >= rangeEnd)
    return [...kept, ...self].sort((a, b) => a.beat - b.beat)
  },

  // Drop parent notes whose start falls inside a self region.
  suppress: (parent, self) => {
    if (self.length === 0 || parent.length === 0) return parent
    const suppressed = (t: number) => self.some((s) => { const [a, b] = region(s); return t >= a && t < b })
    return parent.filter((e) => !suppressed(e.beat))
  },

  // Notes pass through; the blackout is applied at render (see resolve/VisualEngine).
  mute: (parent) => parent,
}

export function combineModifier(
  type: ModifierType,
  parent: ResolvedNote[],
  self: ResolvedNote[],
  beatsPerBar: number,
): ResolvedNote[] {
  return COMBINE[type](parent, self, beatsPerBar)
}
