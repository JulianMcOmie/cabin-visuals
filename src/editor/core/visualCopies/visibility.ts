import type { MidiRowDef } from '../../instruments/types'
import type { ResolvedNote } from '../visual/types'
import type { MoverOrSplitterDefinition } from './definitions'
import { VISIBILITY_COLOR } from './identityColors'

export interface VisibilitySettings {
  /** -1 = one row gates ALL copies; 0 = one note per index; positive = each
   * group's percentage width (legacy saves may carry 10/20). */
  grouping: number
  attackBeats: number
  decayBeats: number
  sustainLevel: number
  releaseBeats: number
}

const VISIBILITY_TOP_PITCH = 127
const VISIBILITY_GROUPING_OPTIONS = [
  { value: -1, label: 'All' },
  { value: 0, label: 'Each index' },
  { value: 50, label: '2 groups' },
  { value: 25, label: '4 groups' },
  { value: 12.5, label: '8 groups' },
]

function visibilityGroupCount(grouping: number, priorCount: number): number {
  if (grouping < 0) return 1
  return grouping > 0 ? Math.min(priorCount, Math.ceil(100 / grouping)) : priorCount
}

function visibilityMidiRows(
  settings: VisibilitySettings,
  context: { priorCount: number } = { priorCount: 1 },
): MidiRowDef[] {
  if (settings.grouping < 0) return [{ pitch: VISIBILITY_TOP_PITCH, label: 'All copies' }]
  const priorCount = Math.max(1, Math.min(128, Math.round(context.priorCount)))
  const groupCount = visibilityGroupCount(settings.grouping, priorCount)
  return Array.from({ length: groupCount }, (_, index) => {
    if (settings.grouping === 0) return { pitch: VISIBILITY_TOP_PITCH - index, label: `Index ${index + 1}` }
    return { pitch: VISIBILITY_TOP_PITCH - index, label: `Group ${index + 1} of ${groupCount}` }
  })
}

function noteControlsVisibilityIndex(note: ResolvedNote, index: number, count: number, grouping: number): boolean {
  const noteIndex = VISIBILITY_TOP_PITCH - note.pitch
  if (grouping < 0) return noteIndex === 0
  if (grouping === 0) return noteIndex === index
  const groupCount = visibilityGroupCount(grouping, count)
  const groupIndex = Math.min(groupCount - 1, Math.floor((index / Math.max(1, count)) * groupCount))
  return noteIndex === groupIndex
}

/** Closed-form ADSR for one index/group. Velocity is intentionally ignored. */
export function evaluateVisibilityOpacity(
  notes: readonly ResolvedNote[],
  beat: number,
  index: number,
  count: number,
  settings: VisibilitySettings,
): number {
  const attack = Math.max(0, settings.attackBeats)
  const decay = Math.max(0, settings.decayBeats)
  const release = Math.max(0, settings.releaseBeats)
  const sustain = Math.max(0, Math.min(1, settings.sustainLevel))
  const heldValue = (age: number): number => {
    if (attack > 0 && age < attack) return age / attack
    if (decay > 0 && age < attack + decay) return 1 - (1 - sustain) * ((age - attack) / decay)
    return sustain
  }

  let opacity = 0
  for (const note of notes) {
    if (!noteControlsVisibilityIndex(note, index, count, settings.grouping)) continue
    const age = beat - note.beat
    if (age < 0) continue
    const hold = Math.max(note.durationBeats || 0, attack)
    if (age < hold) opacity = Math.max(opacity, heldValue(age))
    else if (release > 0 && age < hold + release) {
      opacity = Math.max(opacity, heldValue(hold) * (1 - (age - hold) / release))
    }
  }
  return Math.max(0, Math.min(1, opacity))
}

export const visibilityMover: MoverOrSplitterDefinition<VisibilitySettings> = {
  id: 'visibility',
  label: 'Visibility',
  kind: 'mover',
  identityColor: VISIBILITY_COLOR,
  params: [
    {
      key: 'grouping',
      label: 'Note mapping',
      type: 'select',
      options: VISIBILITY_GROUPING_OPTIONS,
      default: -1,
    },
    { key: 'attackBeats', label: 'Attack (beats)', min: 0, max: 8, step: 0.01, default: 0.05 },
    { key: 'decayBeats', label: 'Decay (beats)', min: 0, max: 8, step: 0.01, default: 0 },
    { key: 'sustainLevel', label: 'Sustain', min: 0, max: 1, step: 0.01, default: 1 },
    { key: 'releaseBeats', label: 'Release (beats)', min: 0, max: 8, step: 0.01, default: 0.5 },
  ],
  midiRows: visibilityMidiRows,
  strictMidiRows: true,
  resolve({ settings, notes }) {
    return {
      apply(visualCopy, { beat, index, count }) {
        return [{
          transform: visualCopy.transform.clone(),
          opacity: visualCopy.opacity * evaluateVisibilityOpacity(notes, beat, index, count, settings),
          colorShift: { ...visualCopy.colorShift },
        }]
      },
    }
  },
}
