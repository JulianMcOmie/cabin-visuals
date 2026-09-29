import path from 'path'
import { pathToFileURL } from 'url'
import { Cabin } from '../lib/api'
import type { CommandGroup } from '../lib/command'
import { coerce, open, resolveTrack, save, timeCtx } from '../lib/common'
import { listNotes, summarize } from '../lib/summary'
import { parsePosition, parseRange } from '../lib/time'
import { UsageError } from '../lib/args'

export const midiCommands: CommandGroup = {
  title: 'MIDI + STRUCTURE',
  note: 'everything in absolute beats; blocks are bookkeeping the API does for you',
  commands: [
    {
      name: 'notes', usage: '<name> <scene/track> [--range 28-40] [--names]', summary: 'list a track\'s notes (bar.beat, beat, pitch, length, velocity)',
      run(a) {
        const range = a.opt('range'), names = a.flag('names')
        const p = open(a.need('project name'))
        const t = resolveTrack(p, a.need('scene/track'))
        const [from, to] = range ? parseRange(range, timeCtx(p)) : [-Infinity, Infinity]
        console.log(listNotes(t.raw, p.beatsPerBar, from, to, names) || '(no notes)')
      },
    },
    {
      name: 'run', usage: '<name> <script.ts> [args...] [--dry]', summary: 'run an edit script: export default (p: Cabin, args) => ...',
      async run(a) {
        const dry = a.flag('dry')
        const name = a.need('project name')
        const script = path.resolve(a.need('script path'))
        const p = open(name)
        p.author = `script:${path.basename(script)}`
        const mod = await import(pathToFileURL(script).href)
        const fn = mod.default ?? mod.edit
        if (typeof fn !== 'function') throw new Error(`${script} must export default (p: Cabin, args: string[]) => ...`)
        await fn(p, a.rest)
        save(p, `run ${path.basename(script)}`, dry)
        console.log(summarize(p.name, p.doc, p.meta))
      },
    },
    {
      name: 'eval', usage: '<name> "<code>" [--dry]', summary: 'inline edit with `p` in scope (an expression prints its value)',
      details: 'e.g. cabin eval song "p.scene(\'A\').get(\'Kick\').clear(p.bar(8))"',
      async run(a) {
        const dry = a.flag('dry')
        const name = a.need('project name')
        const code = a.need('code')
        const p = open(name)
        p.author = 'eval'
        const AsyncFunction = Object.getPrototypeOf(async () => undefined).constructor as new (...x: string[]) => (...y: unknown[]) => Promise<unknown>
        let fn: (...x: unknown[]) => Promise<unknown>
        try { fn = new AsyncFunction('p', `return (${code})`) } catch { fn = new AsyncFunction('p', code) }
        const result = await fn(p)
        if (result !== undefined && result !== p) console.log(typeof result === 'string' ? result : JSON.stringify(result, (_k, v) => (v instanceof Cabin ? undefined : v), 1))
        save(p, 'eval', dry)
      },
    },
    {
      name: 'set', usage: '<name> <scene/track> key=value ...', summary: 'set params (numbers/bools) or strings (colours/text); device inputs on movers/splitters',
      run(a) {
        const p = open(a.need('project name'))
        const t = resolveTrack(p, a.need('scene/track'))
        const values: Record<string, number | boolean | string> = {}
        for (const kv of a.rest) {
          const eq = kv.indexOf('=')
          if (eq < 1) throw new UsageError(`expected key=value, got "${kv}"`)
          values[kv.slice(0, eq)] = coerce(kv.slice(eq + 1))
        }
        a.rest.length = 0
        if (t.raw.type === 'mover' || t.raw.type === 'splitter') t.inputs(Object.fromEntries(Object.entries(values).map(([k, v]) => [k, Number(v)])))
        else t.set(values)
        save(p, `set ${t.name}`)
        console.log(`set ${Object.keys(values).join(', ')} on "${t.name}"`)
      },
    },
    {
      name: 'keys', usage: '<name> <scene/track> <param> "<pos>:<value>[:<ease>], ..." [--min 0 --max 1] [--clear]',
      summary: 'automate a param with exact keyframes + easing (an automation lane under the track)',
      details: 'e.g. cabin keys song Tunnel/Score speed "80:1.5, 88:3:expo.in, 92:1.9:quad.out"  (positions in the usual grammar)',
      run(a) {
        const min = a.opt('min'), max = a.opt('max'), clear = a.flag('clear')
        const p = open(a.need('project name'))
        const t = resolveTrack(p, a.need('scene/track'))
        const param = a.need('param')
        const spec = a.need('keyframes')
        const ctx = timeCtx(p)
        const points = spec.split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
          const parts = s.split(':')
          if (parts.length < 2) throw new UsageError(`bad keyframe "${s}" (pos:value[:ease])`)
          return { beat: parsePosition(parts[0], ctx), value: Number(parts[1]), ease: parts[2] }
        })
        const lane = t.child(`${param} curve`, { param, ...(min !== undefined && max !== undefined ? { range: { min: Number(min), max: Number(max) } } : {}) })
        if (clear) lane.clear()
        lane.curve(points, min !== undefined && max !== undefined ? { min: Number(min), max: Number(max) } : {})
        save(p, `keys ${t.name}.${param}`)
        console.log(`${points.length} keyframe(s) on "${t.name}" → ${param}`)
      },
    },
    {
      name: 'midi import', usage: '<name> <file.mid> --scene <S> [--map A=B,...] [--only A,B] [--instrument id] [--offset beats] [--replace]',
      summary: 'place a MIDI file\'s tracks onto tracks (by name, or new ones)',
      async run(a) {
        const { importMidi } = await import('../lib/midi')
        const sceneName = a.opt('scene'), mapS = a.opt('map') ?? '', onlyS = a.opt('only'), instrument = a.opt('instrument')
        const offset = a.num('offset', 0), replace = a.flag('replace')
        const p = open(a.need('project name'))
        const file = path.resolve(a.need('.mid file'))
        if (!sceneName) throw new UsageError('--scene is required')
        const map = Object.fromEntries(mapS.split(',').filter(Boolean).map((kv) => kv.split('=').map((s) => s.trim()) as [string, string]))
        const only = onlyS?.split(',').map((s) => s.trim())
        const report = importMidi(p, file, { scene: p.scene(sceneName), map, only, instrument, offset, replace })
        save(p, `midi import ${path.basename(file)}`)
        console.log(report.join('\n') || '(no notes in file)')
      },
    },
    {
      name: 'midi export', usage: '<name> <out.mid> [--scene S1,S2]', summary: 'write tracks as a Standard MIDI File (one MIDI track per Cabin track)',
      async run(a) {
        const { exportMidi } = await import('../lib/midi')
        const scenes = a.opt('scene')?.split(',')
        const p = open(a.need('project name'))
        const out = path.resolve(a.need('output .mid'))
        console.log(`wrote ${exportMidi(p, scenes ?? null, out)} tracks → ${out}`)
      },
    },
    {
      name: 'lanes', usage: '<name> [--from-analysis] [--replace]', summary: 'the song\'s shared MIDI lanes (Kick, Snare, Vocal …) that code instruments read with ctx.lane(name)',
      details: '--from-analysis writes Kick/Snare/Hat/Bass/Vocal/Other/Chord lanes from the song analysis into the Lanes scene',
      run(a) {
        const fromAnalysis = a.flag('from-analysis'), replace = a.flag('replace')
        const p = open(a.need('project name'))
        if (fromAnalysis) {
          const n = p.lanesFromAnalysis({ replace })
          save(p, 'lanes from analysis')
          console.log(`wrote ${n} lanes from the analysis`)
        }
        const lanes = p.lanes()
        if (!lanes.length) { console.log('(no lanes - cabin lanes <name> --from-analysis, or p.lane(name) in a script)'); return }
        for (const l of lanes) {
          const ns = l.notes()
          console.log(`${l.name.padEnd(12)} ${String(ns.length).padStart(5)} notes${ns.length ? `  bars ${Math.floor(ns[0].beat / p.beatsPerBar)}–${Math.floor(ns[ns.length - 1].beat / p.beatsPerBar)}` : ''}`)
        }
      },
    },
  ],
}
