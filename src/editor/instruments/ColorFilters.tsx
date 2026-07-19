import type { ObjectState, ResolvedNote } from '../core/visual/types'
import type { MidiRowDef, ObjectInstrumentDef, ParamDef } from './types'

interface ColorFilterRow extends MidiRowDef {
  mode: number
}

export const COLOR_FILTER_ROWS: ColorFilterRow[] = [
  { pitch: 72, label: 'Invert', mode: 1 },
  { pitch: 71, label: 'Solarize', mode: 2 },
  { pitch: 70, label: 'Remap · RGB → GBR', mode: 3 },
  { pitch: 69, label: 'Remap · RGB → BRG', mode: 4 },
  { pitch: 68, label: 'Heat map', mode: 5 },
  { pitch: 67, label: 'Neon duotone', mode: 6 },
  { pitch: 66, label: 'Posterize', mode: 7 },
  { pitch: 65, label: 'Luma rainbow', mode: 8 },
  { pitch: 64, label: 'Hue cycle', mode: 9 },
]

const FILTER_BY_PITCH = new Map(COLOR_FILTER_ROWS.map((row) => [row.pitch, row]))

export interface ActiveColorFilter {
  mode: number
  amount: number
  beat: number
}

/** Resolve one track's held filter. The latest-started recognized note wins;
 * velocity and track opacity both scale the Amount parameter. */
export function resolveActiveColorFilter(
  state: Pick<ObjectState, 'activeNotes' | 'params' | 'opacity' | 'blackedOut' | 'beat'> | undefined,
): ActiveColorFilter | null {
  if (!state || state.blackedOut) return null
  let selected: ResolvedNote | undefined
  for (const note of state.activeNotes) {
    if (!FILTER_BY_PITCH.has(note.pitch)) continue
    if (!selected || note.beat >= selected.beat) selected = note
  }
  if (!selected) return null
  const row = FILTER_BY_PITCH.get(selected.pitch)!
  const velocity = selected.velocity <= 1 ? selected.velocity : selected.velocity / 127
  const amount = Math.max(0, Math.min(1, (state.params.amount ?? 1) * state.opacity * velocity))
  return amount > 0 ? { mode: row.mode, amount, beat: state.beat } : null
}

const PARAMS: ParamDef[] = [
  { key: 'amount', label: 'Amount', min: 0, max: 1, step: 0.01, default: 1 },
]

function ColorFiltersVisual() {
  // The scene compositor consumes this track's ObjectState and applies the
  // shader after the scene has rendered. No geometry belongs in the scene.
  return null
}

export const colorFiltersInstrument: ObjectInstrumentDef = {
  id: 'colorFilters',
  name: 'Color Filters',
  kind: 'object',
  params: PARAMS,
  userInterfaceRenderer: 'colorFilters',
  midiRows: COLOR_FILTER_ROWS,
  component: ColorFiltersVisual,
}
