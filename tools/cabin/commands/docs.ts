import fs from 'fs'
import path from 'path'
import type { CommandGroup } from '../lib/command'
import { REPO } from '../lib/paths'

// `cabin docs`: the guides (the CLAUDE.md files, which are the source of truth)
// and references generated from the source (lib/tsdoc.ts) - so reading docs
// from the command line costs one call and is never out of date.

const GUIDES: Record<string, { file: string; about: string }> = {
  instruments: { file: 'src/editor/instruments/custom/CLAUDE.md', about: 'writing code instruments, compositions, cameras, looks, post passes; the kit; hard-won looks' },
  cli: { file: 'tools/cabin/CLAUDE.md', about: 'the cabin CLI: the loop, scripting API, analysis, rendering, comments, gotchas' },
  app: { file: 'CLAUDE.md', about: 'the repo map: commands, the one rule, invariants, where things are' },
  engine: { file: 'src/editor/core/visual/CLAUDE.md', about: 'the visual engine: resolve, computeAtBeat, object state' },
  editor: { file: 'src/editor/CLAUDE.md', about: 'the editor shell and document model' },
  builtins: { file: 'src/editor/instruments/CLAUDE.md', about: 'built-in (React) instruments and their contract' },
  review: { file: 'src/editor/review/CLAUDE.md', about: 'the review loop in the editor: comments, song strip, review bar, row badges, ⌘K' },
}

export const docsCommands: CommandGroup = {
  title: 'DOCS',
  commands: [
    {
      name: 'docs', usage: '[topic | sdk | api <name>]', summary: 'guides (instruments, cli, app, engine …), the SDK reference, or one symbol',
      details: [
        'cabin docs                 list topics',
        'cabin docs instruments     the code-instrument guide',
        'cabin docs sdk             every export of the SDK (src/editor/instruments/code), one line each',
        'cabin docs api spring      full signature + docs of matching SDK exports',
      ].join('\n'),
      async run(a) {
        const topic = a.next()
        if (!topic) {
          console.log('topics:')
          for (const [k, g] of Object.entries(GUIDES)) console.log(`  ${k.padEnd(12)} ${g.about}`)
          console.log(`  ${'sdk'.padEnd(12)} the code-instrument SDK reference (generated from source)`)
          console.log(`  ${'api <name>'.padEnd(12)} one SDK symbol in full`)
          return
        }
        if (GUIDES[topic]) {
          const file = path.join(REPO, GUIDES[topic].file)
          console.log(fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : `(missing ${GUIDES[topic].file})`)
          return
        }
        const { moduleExports } = await import('../lib/tsdoc')
        const entries = moduleExports('src/editor/instruments/code/index.ts')
        if (topic === 'sdk') {
          let file = ''
          for (const e of entries) {
            const f = e.where.split(':')[0]
            if (f !== file) { console.log(`\n${f}`); file = f }
            const first = e.signature.split('\n')[0].replace(/\s*\{$/, '')
            const doc = e.doc.split('\n')[0]
            const shown = /^(function|interface|type|class|const|enum|namespace)\b/.test(first) ? first : `${e.kind} ${first}`
            console.log(`  ${shown.length > 116 ? shown.slice(0, 113) + '…' : shown}${doc ? `\n      ${doc.slice(0, 120)}` : ''}`)
          }
          return
        }
        if (topic === 'api') {
          const q = a.need('symbol name').toLowerCase()
          const hits = entries.filter((e) => e.name.toLowerCase().includes(q))
          if (!hits.length) { console.log(`(no SDK export matching "${q}")`); return }
          for (const e of hits) console.log(`${e.where}\n${e.doc ? `${e.doc}\n` : ''}${e.signature}\n`)
          return
        }
        throw new Error(`no topic "${topic}" - cabin docs lists them`)
      },
    },
  ],
}
