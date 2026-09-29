import fs from 'fs'
import { execFileSync } from 'child_process'
import { Cabin } from '../lib/api'
import type { CommandGroup } from '../lib/command'
import { attachAudio, editorUrl, open, save } from '../lib/common'
import { docPath, listProjects, loadDoc, projectDir, projectExists } from '../lib/project'
import { summarize } from '../lib/summary'
import { listHistory, readEntry } from '../lib/history'
import { diffDocs, formatDiff, isEmptyDiff } from '../../../src/devtools/docDiff'
import { UsageError } from '../lib/args'

export const projectCommands: CommandGroup = {
  title: 'PROJECTS',
  note: 'projects/<name>/project.json - open live in the editor: /editor?file=<name>',
  commands: [
    {
      name: 'ls', usage: '', summary: 'list projects',
      run() {
        const names = listProjects()
        console.log(names.length ? names.join('\n') : '(no projects yet - cabin new <name>)')
      },
    },
    {
      name: 'new', usage: '<name> [--bpm 120] [--bars 32] [--audio song.m4a]', summary: 'create a project (optionally with its song)',
      async run(a) {
        const bpm = a.num('bpm', 120), bars = a.num('bars', 32), audio = a.opt('audio')
        const name = a.need('project name')
        if (projectExists(name)) throw new Error(`project "${name}" already exists`)
        const { emptyDocument } = await import('../../../src/persistence/types')
        const doc = emptyDocument()
        doc.bpm = bpm
        doc.totalBars = bars
        const visual = doc.sceneOrder.map((id) => doc.scenes[id]).find((s) => !s.isMain)
        if (visual) visual.backgroundColor = '#000000'
        const p = new Cabin(name, doc, {}, projectDir(name))
        if (audio) await attachAudio(p, audio)
        save(p, 'new')
        console.log(`created projects/${name}/project.json\n  editor: ${await editorUrl(name)}`)
      },
    },
    {
      name: 'info', usage: '<name>', summary: 'scenes, tracks, devices, note spans, sections',
      run(a) {
        const p = open(a.need('project name'))
        console.log(summarize(p.name, p.doc, p.meta))
      },
    },
    {
      name: 'open', usage: '<name> [--browser]', summary: 'the editor URL for the project',
      async run(a) {
        const browser = a.flag('browser')
        const url = await editorUrl(a.need('project name'))
        console.log(url)
        if (browser) execFileSync('open', [url])
      },
    },
    {
      name: 'sections', usage: '<name> [set name:from-to,...]', summary: 'named bar ranges (shown on the editor ruler; @name positions)',
      run(a) {
        const p = open(a.need('project name'))
        if (a.next() === 'set') {
          p.sections = a.need('sections like intro:0-4,verse:4-24').split(',').map((s) => {
            const m = /^([^:]+):(\d*\.?\d+)-(\d*\.?\d+)$/.exec(s.trim())
            if (!m) throw new UsageError(`bad section "${s}" (name:from-to in bars)`)
            return { name: m[1].trim(), from: Number(m[2]), to: Number(m[3]) }
          })
          save(p, 'sections')
        }
        for (const s of p.sections) console.log(`${s.name.padEnd(14)} bars ${s.from}-${s.to}  (${p.toSec(p.bar(s.from)).toFixed(2)}s-${p.toSec(p.bar(s.to)).toFixed(2)}s)`)
      },
    },
    {
      name: 'history', usage: '<name> [--n 20]', summary: 'the CLI writes to this project, newest last, with what each changed',
      run(a) {
        const n = a.num('n', 20)
        const name = a.need('project name')
        const all = listHistory(name)
        if (!all.length) { console.log('(no CLI writes yet)'); return }
        const shown = all.slice(-n)
        let prev = all.length > shown.length ? readEntry(all[all.length - shown.length - 1]) : null
        for (const e of shown) {
          const doc = readEntry(e)
          const d = prev ? diffDocs(prev, doc) : null
          const tracks = d ? d.tracks.length : 0
          const notes = d ? d.tracks.reduce((s, t) => s + t.notesAdded.length + t.notesRemoved.length, 0) : 0
          console.log(`${String(e.seq).padStart(4)}  ${e.at}  ${e.label.padEnd(28)}${d ? `  ${tracks} track(s), ${notes} note change(s)` : ''}`)
          prev = doc
        }
      },
    },
    {
      name: 'diff', usage: '<name> [--last] [--from <seq>]', summary: 'what changed since my last write (= your edits in the editor); --last: what my last write did',
      run(a) {
        const last = a.flag('last')
        const from = a.opt('from')
        const name = a.need('project name')
        const all = listHistory(name)
        if (!all.length) { console.log('(no CLI writes yet - nothing to compare with)'); return }
        const current = loadDoc(name)
        if (last) {
          if (all.length < 2) { console.log('(only one write so far)'); return }
          console.log(formatDiff(diffDocs(readEntry(all[all.length - 2]), readEntry(all[all.length - 1])), current.beatsPerBar))
          return
        }
        const base = from ? all.find((e) => e.seq === Number(from)) : all[all.length - 1]
        if (!base) throw new Error(`no history entry ${from}`)
        const d = diffDocs(readEntry(base), current)
        console.log(isEmptyDiff(d) ? `(no changes since write ${base.seq}: ${base.label})` : formatDiff(d, current.beatsPerBar))
      },
    },
    {
      name: 'undo', usage: '<name> [--force]', summary: 'restore the document from before my last write',
      run(a) {
        const force = a.flag('force')
        const name = a.need('project name')
        const all = listHistory(name)
        if (all.length < 2) throw new Error('nothing to undo (fewer than two recorded writes)')
        const current = loadDoc(name)
        const lastWrite = readEntry(all[all.length - 1])
        const edited = diffDocs(lastWrite, current)
        if (!isEmptyDiff(edited) && !force) {
          throw new Error(`the project changed since my last write (your edits?):\n${formatDiff(edited, current.beatsPerBar)}\nundo would discard them - pass --force to do it anyway`)
        }
        const target = all[all.length - 2]
        const p = open(name)
        p.doc = readEntry(target)
        save(p, `undo to ${target.seq}`)
        console.log(`restored the document from write ${target.seq} (${target.label})`)
        void fs; void docPath
      },
    },
  ],
}
