import fs from 'fs'
import path from 'path'
import type { MidiRowDef, ParamDef } from '../../../src/editor/instruments/types'
import { CUSTOM } from './paths'

// `cabin describe`: the vocabulary of everything placeable - object instruments
// (built-in and code), composition instruments, movers/splitters/colorizers,
// effects - read straight from the app's own registries (imported under node),
// so what it prints is exactly what the editor will do.

async function load() {
  const [inst, dirs, vc, fx] = await Promise.all([
    import('../../../src/editor/instruments/index'),
    import('../../../src/editor/core/directors/index'),
    import('../../../src/editor/core/visualCopies/registry'),
    import('../../../src/editor/effects/index'),
  ])
  // code instruments/compositions register as a side effect of this module
  await import('../../../src/editor/instruments/code/register')
  return { inst, dirs, vc, fx }
}

function paramLine(p: ParamDef): string {
  const t = p.type ?? 'number'
  if (t === 'number') {
    const n = p as { min: number; max: number; default: number; step: number; integer?: boolean }
    return `  ${p.key.padEnd(18)} ${n.integer ? 'int' : 'num'} ${n.min}..${n.max} (default ${n.default})  "${p.label}"${p.showIf ? `  [if ${p.showIf}]` : ''}`
  }
  if (t === 'select') {
    const s = p as { options: { value: number; label: string }[]; default: number }
    return `  ${p.key.padEnd(18)} select ${s.options.map((o) => `${o.value}=${o.label}`).join(' | ')} (default ${s.default})  "${p.label}"`
  }
  const d = (p as { default: unknown }).default
  return `  ${p.key.padEnd(18)} ${t} (default ${JSON.stringify(d)})  "${p.label}"`
}

function rowsLines(rows: MidiRowDef[] | undefined): string[] {
  if (!rows?.length) return ['  (full piano roll - any pitch)']
  return rows.map((r) => `  ${String(r.pitch).padStart(3)}  ${r.label}`)
}

function findCodeFile(id: string): string | null {
  const walk = (dir: string): string | null => {
    if (!fs.existsSync(dir)) return null
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        const hit = walk(full)
        if (hit) return hit
      } else if (/\.tsx?$/.test(e.name) && !e.name.includes('.generated.')) {
        if (fs.readFileSync(full, 'utf8').includes(`'${id}'`)) return full
      }
    }
    return null
  }
  return walk(CUSTOM)
}

export async function describeAll(filter?: string): Promise<string> {
  const { inst, dirs, vc, fx } = await load()
  const out: string[] = []
  const f = filter?.toLowerCase()
  const keep = (id: string, name: string) => !f || id.toLowerCase().includes(f) || name.toLowerCase().includes(f)
  const objects = Object.values(inst.INSTRUMENTS)
  const code = objects.filter((d) => 'code' in d)
  const builtin = objects.filter((d) => !('code' in d))
  out.push('OBJECT INSTRUMENTS (base tracks in a visual scene)')
  for (const d of builtin) if (keep(d.id, d.name)) out.push(`  ${d.id.padEnd(22)} ${d.name}${d.midiRows ? `  [${d.midiRows.length} rows]` : ''}`)
  out.push('CODE INSTRUMENTS (src/editor/instruments/custom/)')
  for (const d of code) if (keep(d.id, d.name)) out.push(`  ${d.id.padEnd(22)} ${d.name}${(d as { code: { description?: string } }).code.description ? ` - ${(d as { code: { description?: string } }).code.description}` : ''}`)
  out.push('COMPOSITIONS (Composite scene)')
  for (const d of dirs.listCompositionInstruments()) if (keep(d.id, d.name)) out.push(`  ${d.id.padEnd(22)} ${d.name}${'code' in d ? '  (code)' : ''}`)
  out.push('DEVICES (child tracks: movers / splitters / colorizers)')
  for (const d of vc.listMoverOrSplitterDefinitions()) if (keep(d.id, d.label)) out.push(`  ${`${d.kind}:${d.id}`.padEnd(30)} ${d.label}${d.legacy ? '  (legacy)' : ''}`)
  out.push('EFFECTS (track.effects / scene effects)')
  for (const d of fx.PLUGIN_LIST) if (keep(d.id, d.name) && !d.deprecated) out.push(`  ${`${d.category}:${d.id}`.padEnd(30)} ${d.name}`)
  return out.join('\n')
}

export async function describeOne(id: string): Promise<string> {
  const { inst, dirs, vc, fx } = await load()
  const out: string[] = []
  const obj = inst.INSTRUMENTS[id]
  if (obj) {
    const code = (obj as { code?: { description?: string } }).code
    out.push(`${obj.id} - ${obj.name}${code ? ' (code instrument)' : ''}${obj.fullFrame ? ' [full-frame]' : ''}`)
    if (code?.description) out.push(code.description)
    if (code) out.push(`file: ${findCodeFile(obj.id) ?? '(not found)'}`)
    out.push('params:')
    out.push(...obj.params.map(paramLine))
    out.push('MIDI rows:')
    out.push(...rowsLines(obj.midiRows))
    if (obj.abilities?.length) out.push('abilities:', ...obj.abilities.map((a) => `  ${a.key}  ${a.label}`))
    return out.join('\n')
  }
  const comp = dirs.compositionDef(id)
  if (comp) {
    out.push(`${comp.id} - ${comp.name} (composition${'code' in comp ? ', code' : ''})`)
    if (comp.panelSummary) out.push(comp.panelSummary)
    out.push('params:', ...comp.params.map(paramLine))
    out.push('MIDI rows: one per visual scene (sceneBindings, from pitch 60 up) plus any declared trigger rows')
    return out.join('\n')
  }
  const dev = vc.getMoverOrSplitterDefinition(id)
  if (dev) {
    out.push(`${dev.kind}:${dev.id} - ${dev.label}`)
    out.push('settings (track.inputValues):', ...dev.params.map(paramLine))
    const rows = dev.midiRows?.({} as never)
    out.push('MIDI rows:', ...rowsLines(rows))
    return out.join('\n')
  }
  const effect = fx.getEffect(id)
  if (effect) {
    out.push(`${effect.category}:${effect.id} - ${effect.name}`)
    out.push('settings:', ...effect.params.map(paramLine))
    return out.join('\n')
  }
  throw new Error(`nothing called "${id}" - try: cabin describe (lists everything)`)
}

/** Param ranges of an instrument (for automation lanes). */
export async function paramRange(instrumentId: string, key: string): Promise<{ min: number; max: number } | null> {
  const { inst } = await load()
  const p = inst.INSTRUMENTS[instrumentId]?.params.find((x) => x.key === key) as { min?: number; max?: number } | undefined
  return p && typeof p.min === 'number' && typeof p.max === 'number' ? { min: p.min, max: p.max } : null
}
