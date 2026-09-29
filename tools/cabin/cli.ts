// cabin - the command line for building Cabin Visuals projects from code.
// Run via the repo-root launcher: ./cabin <command> ...   (guide: tools/cabin/CLAUDE.md)
//
// Commands live in tools/cabin/commands/<group>.ts (one object each, see
// lib/command.ts); this file only dispatches and prints help generated from them.

import { Args, UsageError } from './lib/args'
import type { Command, CommandGroup } from './lib/command'
import { projectCommands } from './commands/project'
import { midiCommands } from './commands/midi'
import { analysisCommands } from './commands/analysis'
import { instrumentCommands } from './commands/instruments'
import { renderCommands } from './commands/render'
import { commentCommands } from './commands/comments'
import { liveCommands } from './commands/live'
import { docsCommands } from './commands/docs'

const GROUPS: CommandGroup[] = [
  projectCommands, midiCommands, analysisCommands, instrumentCommands, renderCommands, commentCommands, liveCommands, docsCommands,
]
const ALL: Command[] = GROUPS.flatMap((g) => g.commands)

const POSITIONS = 'Positions: 28 = bar 28 (0-based) · 28.5 = halfway through it · b112 = beat · 45.5s · @section(+bars). Ranges: 28-40, @section, <pos>:<pos>.'

function line(c: Command) {
  const head = `  cabin ${c.name}${c.usage ? ` ${c.usage}` : ''}`
  return head.length > 78 ? `${head}\n${' '.repeat(8)}${c.summary}` : `${head.padEnd(79)}${c.summary}`
}

export function helpText(): string {
  const out = ['cabin - build Cabin Visuals projects from code (renders + live commands need the dev server)', '']
  for (const g of GROUPS) {
    out.push(`${g.title}${g.note ? `  (${g.note})` : ''}`)
    for (const c of g.commands) out.push(line(c))
    out.push('')
  }
  out.push(POSITIONS, '', 'cabin help <command> for details · cabin docs for the guides and the SDK reference')
  return out.join('\n')
}

function find(argv: string[]): { cmd: Command; rest: string[] } | null {
  let best: Command | null = null
  for (const c of ALL) {
    const words = c.name.split(' ')
    if (words.every((w, i) => argv[i] === w) && (!best || words.length > best.name.split(' ').length)) best = c
  }
  return best ? { cmd: best, rest: argv.slice(best.name.split(' ').length) } : null
}

async function main() {
  const argv = process.argv.slice(2)
  if (!argv.length || argv[0] === '--help' || argv[0] === '-h') { console.log(helpText()); return }
  if (argv[0] === 'help') {
    const hit = argv.length > 1 ? find(argv.slice(1)) : null
    if (!hit) { console.log(helpText()); return }
    console.log(`cabin ${hit.cmd.name} ${hit.cmd.usage}\n\n${hit.cmd.summary}${hit.cmd.details ? `\n\n${hit.cmd.details}` : ''}`)
    return
  }
  const hit = find(argv)
  if (!hit) {
    const near = ALL.filter((c) => c.name.split(' ')[0] === argv[0]).map((c) => `cabin ${c.name} ${c.usage}`)
    throw new UsageError(`unknown command "${argv.slice(0, 2).join(' ')}"${near.length ? `\n  did you mean:\n    ${near.join('\n    ')}` : ' - cabin help lists them'}`)
  }
  try {
    await hit.cmd.run(new Args(hit.rest))
  } catch (e) {
    if (e instanceof UsageError) throw new UsageError(`${e.message}\n  usage: cabin ${hit.cmd.name} ${hit.cmd.usage}`)
    throw e
  }
}

main().catch((e) => {
  console.error(`cabin: ${(e as Error).message}`)
  process.exit(1)
})
