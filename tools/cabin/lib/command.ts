import type { Args } from './args'

// One CLI command. Commands live in tools/cabin/commands/<group>.ts, one array
// per group; cli.ts dispatches on the longest matching name ("midi import"
// before "midi") and generates `cabin help` from these fields - so adding a
// command is one object in one file, and its help can't drift from it.

export interface Command {
  /** One or more words: 'comments', 'midi import', 'comment add'. */
  name: string
  /** Arguments after the name, e.g. '<name> <id> "text" [--resolve]'. */
  usage: string
  /** One line for `cabin help`. */
  summary: string
  /** More detail for `cabin help <command>`. */
  details?: string
  run(a: Args): Promise<void> | void
}

export interface CommandGroup {
  title: string
  /** A line under the group title in `cabin help`. */
  note?: string
  commands: Command[]
}
