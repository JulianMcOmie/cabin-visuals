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
  MODULES.map((module) => [module.id, { start: module.bankStart, size: module.maxRows }]),
) as Record<string, { start: number; size: number }>

export function consolidatedMoverPitch(moduleId: string, rowIndex: number): number {
  const bank = CONSOLIDATED_MOVER_BANKS[moduleId]
  if (!bank || rowIndex < 0 || rowIndex >= bank.size) return -1
  return bank.start + rowIndex
}

function enableKey(module: MoverModule): string {
  return `enable__${module.id}`
}

function settingKey(module: MoverModule, key: string): string {
  return `${module.id}__${key}`
}

function prefixedParam(module: MoverModule, param: ParamDef): ParamDef {
  return {
    ...param,
    key: settingKey(module, param.key),
    label: `${module.label} · ${param.label}`,
    showIf: enableKey(module),
  }
}

const CONSOLIDATED_PARAMS: ParamDef[] = MODULES.flatMap((module) => [
  {
    key: enableKey(module),
    label: `${module.label} module`,
    type: 'boolean' as const,
    default: module.defaultEnabled,
  },
  ...module.definition.params.map((param) => prefixedParam(module, param)),
])

function moduleSettings(settings: ConsolidatedSettings, module: MoverModule): Record<string, number> {
  const out: Record<string, number> = {}
  for (const param of module.definition.params) {
    if (typeof param.default !== 'number') continue
    out[param.key] = settings[settingKey(module, param.key)] ?? param.default
  }
  return out
}

function nativeRows(
  settings: ConsolidatedSettings,
  module: MoverModule,
): MidiRowDef[] {
  // Six makes Visibility's dynamic Each Index mapping consume exactly the
  // remainder of the MIDI range. Other modules ignore priorCount.
  return (module.definition.midiRows?.(moduleSettings(settings, module), { priorCount: 6 }) ?? [])
    .slice(0, module.maxRows)
}

function consolidatedMidiRows(settings: ConsolidatedSettings): MidiRowDef[] {
  const rows: MidiRowDef[] = []
  for (const module of MODULES) {
    if ((settings[enableKey(module)] ?? module.defaultEnabled) < 0.5) continue
    nativeRows(settings, module).forEach((row, index) => {
      rows.push({
        ...row,
        pitch: module.bankStart + index,
        label: `${module.label} · ${row.label}`,
      })
    })
  }
  return rows
}

function moduleNotes(
  notes: readonly ResolvedNote[],
  settings: ConsolidatedSettings,
  module: MoverModule,
): ResolvedNote[] {
  const rows = nativeRows(settings, module)
  const end = module.bankStart + rows.length
  return notes.flatMap((note) => {
    if (note.pitch < module.bankStart || note.pitch >= end) return []
    return [{ ...note, pitch: rows[note.pitch - module.bankStart].pitch }]
  })
}

function resolveModules(
  settings: ConsolidatedSettings,
  notes: readonly ResolvedNote[],
): MoverOrSplitter[] {
  return MODULES.flatMap((module) => {
    if ((settings[enableKey(module)] ?? module.defaultEnabled) < 0.5) return []
    return [module.definition.resolve({
      settings: moduleSettings(settings, module),
      notes: moduleNotes(notes, settings, module),
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
  params: CONSOLIDATED_PARAMS,
  midiRows: consolidatedMidiRows,
  strictMidiRows: true,
  resolve({ settings, notes }) {
    const modules = resolveModules(settings, notes)
    return {
      apply(visualCopy, context) {
        let copies: VisualCopy[] = [visualCopy]
        for (const module of modules) {
          const previous = copies
          const count = previous.length
          copies = previous.flatMap((copy, index) => module.apply(copy, {
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
