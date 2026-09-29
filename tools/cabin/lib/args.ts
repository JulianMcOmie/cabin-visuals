// Command-line arguments for one command: flags (--x), options (--x value) and
// positionals, consumed as they're read so leftovers can be reported.

export class Args {
  constructor(public rest: string[]) {}

  /** `--name` present? (consumed) */
  flag(name: string): boolean {
    const i = this.rest.indexOf(`--${name}`)
    if (i >= 0) { this.rest.splice(i, 1); return true }
    return false
  }

  /** `--name value` (consumed), or the fallback. */
  opt(name: string, fallback?: string): string | undefined {
    const i = this.rest.indexOf(`--${name}`)
    if (i >= 0) {
      const v = this.rest[i + 1]
      this.rest.splice(i, 2)
      return v
    }
    return fallback
  }

  /** Numeric option. */
  num(name: string, fallback: number): number {
    const v = this.opt(name)
    if (v === undefined) return fallback
    const n = Number(v)
    if (!Number.isFinite(n)) throw new Error(`--${name} expects a number, got "${v}"`)
    return n
  }

  /** Next positional (after options have been read). */
  next(): string | undefined {
    const i = this.rest.findIndex((a) => !a.startsWith('--'))
    return i >= 0 ? this.rest.splice(i, 1)[0] : undefined
  }

  /** Next positional, required. */
  need(what: string): string {
    const v = this.next()
    if (!v) throw new UsageError(`missing ${what}`)
    return v
  }
}

/** A mistake in how the command was called: the CLI prints the command's usage with it. */
export class UsageError extends Error {}
