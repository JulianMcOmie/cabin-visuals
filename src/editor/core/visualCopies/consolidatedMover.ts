import type { MidiRowDef, ParamDef } from '../../instruments/types'
import type { ResolvedNote } from '../visual/types'
import type { MoverOrSplitterDefinition } from './definitions'
import { forceFieldPushMover } from './forceFieldPush'
import { motionMover } from './motion'
import { radialMotionMover } from './radialMotion'
import { constantOrbitMover, orbitBurstMover } from './rotationMovers'
import { translationOscillatorMover } from './translationOscillator'
import type { MoverOrSplitter, VisualCopy } from './types'
import { visibilityMover } from './visibility'
import { waveTerrainMover } from './waveTerrain'
import { CONSOLIDATED_MOVER_COLOR } from './identityColors'

type ConsolidatedSettings = Record<string, number>

interface MoverModule {
  id: string
  label: string
  definition: MoverOrSplitterDefinition<any>
  bankStart: number
  maxRows: number
  defaultEnabled: number
}

/**
 * Fixed, collision-free MIDI banks. Motion supplies the overlapping Burst,
 * Rotate Burst, and Constant Rotate capabilities through its Step, Snap, and
 * Spin blocks, so every DISTINCT mover behavior fits in one 128-note lane.
 */
const MODULES: MoverModule[] = [
  { id: 'motion', label: 'Motion', definition: motionMover, bankStart: 0, maxRows: 26, defaultEnabled: 1 },
  // Radial Motion emits 27 rows since its rework (three depths, no colour
  // layers), but the bank stays 69 wide: these sizes are what fix every module
  // BELOW it, so reclaiming the slack would silently retune every existing
  // project's All Movers lane. The spare 42 pitches are simply never issued.
  { id: 'radialMotion', label: 'Radial Motion', definition: radialMotionMover, bankStart: 26, maxRows: 69, defaultEnabled: 0 },
  { id: 'orbitBurst', label: 'Orbit Burst', definition: orbitBurstMover, bankStart: 95, maxRows: 6, defaultEnabled: 1 },
  { id: 'constantOrbit', label: 'Constant Orbit', definition: constantOrbitMover, bankStart: 101, maxRows: 7, defaultEnabled: 0 },
  { id: 'translationOscillator', label: 'Translation Oscillator', definition: translationOscillatorMover, bankStart: 108, maxRows: 7, defaultEnabled: 1 },
  { id: 'forceFieldPush', label: 'Force Field Pulse', definition: forceFieldPushMover, bankStart: 115, maxRows: 5, defaultEnabled: 1 },
  { id: 'waveTerrain', label: 'Wave Terrain', definition: waveTerrainMover, bankStart: 120, maxRows: 2, defaultEnabled: 0 },
  // Six pitches remain. All/2/4-group Visibility fits completely; Each Index
  // addresses the first six indices when the incoming copy count is >6.
  { id: 'visibility', label: 'Visibility', definition: visibilityMover, bankStart: 122, maxRows: 6, defaultEnabled: 0 },
]

export const CONSOLIDATED_MOVER_BANKS = Object.fromEntries(
  MODULES.map((moverModule) => [
    moverModule.id,
    { start: moverModule.bankStart, size: moverModule.maxRows },
  ]),
) as Record<string, { start: number; size: number }>

export function consolidatedMoverPitch(moduleId: string, rowIndex: number): number {
  const bank = CONSOLIDATED_MOVER_BANKS[moduleId]
  if (!bank || rowIndex < 0 || rowIndex >= bank.size) return -1
  return bank.start + rowIndex
}

function enableKey(moverModule: MoverModule): string {
  return `enable__${moverModule.id}`
}

function settingKey(moverModule: MoverModule, key: string): string {
  return `${moverModule.id}__${key}`
}

function prefixedParam(moverModule: MoverModule, param: ParamDef): ParamDef {
  return {
    ...param,
    key: settingKey(moverModule, param.key),
    label: `${moverModule.label} · ${param.label}`,
    showIf: enableKey(moverModule),
  }
}

const CONSOLIDATED_PARAMS: ParamDef[] = MODULES.flatMap((moverModule) => [
  {
    key: enableKey(moverModule),
    label: `${moverModule.label} module`,
    type: 'boolean' as const,
    default: moverModule.defaultEnabled,
  },
  ...moverModule.definition.params.map((param) => prefixedParam(moverModule, param)),
])

function moduleSettings(settings: ConsolidatedSettings, moverModule: MoverModule): Record<string, number> {
  const out: Record<string, number> = {}
  for (const param of moverModule.definition.params) {
    if (typeof param.default !== 'number') continue
    out[param.key] = settings[settingKey(moverModule, param.key)] ?? param.default
  }
  return out
}

function nativeRows(
  settings: ConsolidatedSettings,
  moverModule: MoverModule,
): MidiRowDef[] {
  // Six makes Visibility's dynamic Each Index mapping consume exactly the
  // remainder of the MIDI range. Other modules ignore priorCount.
  return (moverModule.definition.midiRows?.(moduleSettings(settings, moverModule), { priorCount: 6 }) ?? [])
    .slice(0, moverModule.maxRows)
}

function consolidatedMidiRows(settings: ConsolidatedSettings): MidiRowDef[] {
  const rows: MidiRowDef[] = []
  for (const moverModule of MODULES) {
    if ((settings[enableKey(moverModule)] ?? moverModule.defaultEnabled) < 0.5) continue
    nativeRows(settings, moverModule).forEach((row, index) => {
      rows.push({
        ...row,
        pitch: moverModule.bankStart + index,
        label: `${moverModule.label} · ${row.label}`,
      })
    })
  }
  return rows
}

function moduleNotes(
  notes: readonly ResolvedNote[],
  settings: ConsolidatedSettings,
  moverModule: MoverModule,
): ResolvedNote[] {
  const rows = nativeRows(settings, moverModule)
  const end = moverModule.bankStart + rows.length
  return notes.flatMap((note) => {
    if (note.pitch < moverModule.bankStart || note.pitch >= end) return []
    return [{ ...note, pitch: rows[note.pitch - moverModule.bankStart].pitch }]
  })
}

function resolveModules(
  settings: ConsolidatedSettings,
  notes: readonly ResolvedNote[],
): MoverOrSplitter[] {
  return MODULES.flatMap((moverModule) => {
    if ((settings[enableKey(moverModule)] ?? moverModule.defaultEnabled) < 0.5) return []
    return [moverModule.definition.resolve({
      settings: moduleSettings(settings, moverModule),
      notes: moduleNotes(notes, settings, moverModule),
    })]
  })
}

/**
 * A modular mover rack: every distinct production mover behavior in one track,
 * one settings panel, and one collision-free semantic MIDI lane.
 *
 * Modules execute in the same order shown in the settings panel. Structural
 * output remains beat-independent because module enable switches and copy
 * counts are settings, while MIDI only drives the resolved module behavior.
 */
export const consolidatedMover: MoverOrSplitterDefinition<ConsolidatedSettings> = {
  id: 'allMovers',
  label: 'All Movers',
  kind: 'mover',
  legacy: true,
  identityColor: CONSOLIDATED_MOVER_COLOR,
  params: CONSOLIDATED_PARAMS,
  midiRows: consolidatedMidiRows,
  strictMidiRows: true,
  resolve({ settings, notes }) {
    const modules = resolveModules(settings, notes)
    return {
      apply(visualCopy, context) {
        let copies: VisualCopy[] = [visualCopy]
        for (const resolvedMover of modules) {
          const previous = copies
          const count = previous.length
          copies = previous.flatMap((copy, index) => resolvedMover.apply(copy, {
            ...context,
            index,
            count,
          }))
        }
        return copies
      },
    }
  },
}
