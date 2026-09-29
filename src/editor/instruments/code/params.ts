import type { MidiRowDef, ParamDef } from '../types'
import type { BoolSpec, ColorSpec, NumSpec, ParamSpecs, RowSpecs, SelectSpec, TextSpec } from './types'

// Param and MIDI-row builders shared by code instruments and code compositions.
// Pure data: no React, no three.

type Opts<T> = Omit<T, 'kind' | 'default' | 'min' | 'max' | 'options'>

/** Param builders: `params: { speed: p.num(1, 0, 4), sand: p.color('#ffd08a') }`. */
export const p = {
  num: (value: number, min: number, max: number, opts: Opts<NumSpec> = {}): NumSpec => ({ kind: 'num', default: value, min, max, ...opts }),
  int: (value: number, min: number, max: number, opts: Opts<NumSpec> = {}): NumSpec => ({ kind: 'num', default: value, min, max, step: 1, integer: true, ...opts }),
  bool: (value = false, opts: Opts<BoolSpec> = {}): BoolSpec => ({ kind: 'bool', default: value, ...opts }),
  select: (options: string[], value = 0, opts: Opts<SelectSpec> = {}): SelectSpec => ({ kind: 'select', options, default: value, ...opts }),
  color: (value: string, opts: Opts<ColorSpec> = {}): ColorSpec => ({ kind: 'color', default: value, ...opts }),
  text: (value = '', opts: Opts<TextSpec> = {}): TextSpec => ({ kind: 'text', default: value, ...opts }),
}

const titleize = (key: string) =>
  key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').replace(/^./, (c) => c.toUpperCase())

function niceStep(min: number, max: number): number {
  const range = Math.abs(max - min)
  if (range === 0) return 0.01
  return Math.pow(10, Math.floor(Math.log10(range / 100)))
}

export function toParamDefs(specs: ParamSpecs | undefined): ParamDef[] {
  return Object.entries(specs ?? {}).map(([key, s]): ParamDef => {
    const label = s.label ?? titleize(key)
    const showIf = s.showIf
    switch (s.kind) {
      case 'num':
        return { key, label, showIf, min: s.min, max: s.max, step: s.step ?? (s.integer ? 1 : niceStep(s.min, s.max)), default: s.default, curve: s.curve, integer: s.integer }
      case 'bool':
        return { key, label, showIf, type: 'boolean', default: s.default ? 1 : 0 }
      case 'select':
        return { key, label, showIf, type: 'select', default: s.default, options: s.options.map((o, i) => ({ value: i, label: o })) }
      case 'color':
        return { key, label, showIf, type: 'color', default: s.default }
      case 'text':
        return { key, label, showIf, type: 'string', default: s.default, multiline: s.multiline }
    }
  })
}

export function toMidiRows(rows: RowSpecs | undefined): MidiRowDef[] | undefined {
  if (!rows) return undefined
  return Object.entries(rows)
    .map(([pitch, r]) => {
      const row = typeof r === 'string' ? { label: r } : r
      return { pitch: Number(pitch), label: row.label, color: row.color, emphasized: row.emphasized }
    })
    .sort((a, b) => b.pitch - a.pitch)
}

/** Rows for a run of pitches: `rowsFrom(48, ['C','C#',...])` or a label function. */
export function rowsFrom(firstPitch: number, labels: string[] | number, label?: (pitch: number, i: number) => string): RowSpecs {
  const out: RowSpecs = {}
  const n = typeof labels === 'number' ? labels : labels.length
  for (let i = 0; i < n; i++) {
    const pitch = firstPitch + i
    out[pitch] = typeof labels === 'number' ? (label ? label(pitch, i) : `Row ${i + 1}`) : labels[i]
  }
  return out
}

