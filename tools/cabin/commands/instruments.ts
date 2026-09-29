import path from 'path'
import type { CommandGroup } from '../lib/command'
import { regenerate } from '../lib/common'
import { REPO } from '../lib/paths'

export const instrumentCommands: CommandGroup = {
  title: 'INSTRUMENTS',
  note: 'code instruments: one file in src/editor/instruments/custom/<pack>/ - hot-swapped live on save',
  commands: [
    {
      name: 'describe', usage: '[id] [--filter text]', summary: 'params + MIDI rows of any instrument / device / effect / composition',
      async run(a) {
        const filter = a.opt('filter')
        const id = a.next()
        const { describeAll, describeOne } = await import('../lib/registry')
        console.log(id ? await describeOne(id) : await describeAll(filter))
      },
    },
    {
      name: 'instrument new', usage: '<pack>/<name> [--kind strokes|particles|mesh|fullframe|post|camera|composition]',
      summary: 'scaffold a code instrument (registered at once; edit it and it swaps in live)',
      async run(a) {
        const kind = a.opt('kind', 'strokes') as 'strokes'
        const { scaffold } = await import('../lib/scaffold')
        const file = scaffold(a.need('<pack>/<name>'), kind)
        regenerate()
        console.log(`wrote ${path.relative(REPO, file)} (registered - it is in the library's Code folder)`)
      },
    },
    {
      name: 'instruments', usage: '', summary: 'regenerate + list the code-instrument registry',
      run() { regenerate(true) },
    },
  ],
}
