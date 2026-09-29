import path from 'path'
import type { CommandGroup } from '../lib/command'
import { attachAudio, open, save, timeCtx } from '../lib/common'
import { parseRange } from '../lib/time'

export const analysisCommands: CommandGroup = {
  title: 'ANALYSIS',
  note: 'librosa + Demucs in ~/.cache/cabin/venv (cabin analyze --setup makes it once)',
  commands: [
    {
      name: 'analyze', usage: '<name> [--audio song.m4a] [--stems dir] [--json file] [--bpm N] [--downbeat sec] [--keep-bpm] [--sections] [--lanes]',
      summary: 'stems → grid, events, envelopes; sets bpm, aligns bar 0 to ONE, suggests sections, writes analysis.mid',
      details: '--lanes also writes the shared MIDI lanes (Kick, Snare, Vocal …) for ctx.lane(name). --setup builds the Python venv.',
      async run(a) {
        const { runAnalysis, setupVenv } = await import('../lib/analyzeCmd')
        if (a.flag('setup')) { setupVenv(); return }
        const audio = a.opt('audio'), json = a.opt('json'), stems = a.opt('stems'), bpm = a.opt('bpm'), downbeat = a.opt('downbeat')
        const keepBpm = a.flag('keep-bpm'), sections = a.flag('sections'), lanes = a.flag('lanes')
        const p = open(a.need('project name'))
        if (audio) await attachAudio(p, audio)
        const report = runAnalysis(p, { json, stems, bpm, downbeat, keepBpm, sections })
        if (lanes) console.log(`wrote ${p.lanesFromAnalysis({ replace: true })} lanes`)
        save(p, 'analyze')
        console.log(report)
      },
    },
    {
      name: 'analysis', usage: '<name> [--range 0-32] [--events kick,vocal,...] [--midi out.mid]', summary: 'the per-bar energy table, or event lists, or the analysis as MIDI',
      async run(a) {
        const range = a.opt('range'), events = a.opt('events'), midiOut = a.opt('midi')
        const p = open(a.need('project name'))
        const { formatBars } = await import('../lib/analysis')
        const an = p.analysis()
        const [from, to] = range ? parseRange(range, timeCtx(p)) : [0, an.endBeat]
        if (midiOut) {
          an.toMidi(path.resolve(midiOut))
          console.log(`wrote ${midiOut}`)
        }
        if (events) {
          const bpb = p.beatsPerBar
          for (const name of events.split(',').map((x) => x.trim())) {
            const list = (an as unknown as Record<string, Array<{ beat: number; v: number; dur?: number; pitch?: number | null; pc?: number }>>)[name]
            if (!Array.isArray(list)) throw new Error(`no event list "${name}" (kick snare hat bass vocal other)`)
            const hits = list.filter((h) => h.beat >= from && h.beat < to)
            console.log(`${name}: ${hits.length} in range`)
            for (const h of hits) {
              const bar = Math.floor(h.beat / bpb)
              const extra = [h.dur !== undefined ? `dur ${h.dur.toFixed(2)}` : '', h.pitch != null ? `pitch ${h.pitch.toFixed(1)}` : '', h.pc !== undefined ? `pc ${h.pc}` : ''].filter(Boolean).join('  ')
              console.log(`  b${h.beat.toFixed(3).padStart(8)}  bar ${String(bar).padStart(3)} +${(h.beat - bar * bpb).toFixed(2)}  v ${h.v.toFixed(2)}  ${extra}`)
            }
          }
          return
        }
        if (!midiOut) console.log(formatBars(an.bars(Math.floor(from / p.beatsPerBar), Math.ceil(to / p.beatsPerBar)), p.sections))
      },
    },
  ],
}
