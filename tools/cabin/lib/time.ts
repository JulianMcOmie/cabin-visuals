// Positions on the command line. One grammar everywhere (--at, --from, --to):
//
//   28        bar 28 (0-based, fractional ok: 28.5 = halfway through bar 28)
//   b112      beat 112
//   45.5s     45.5 seconds
//   @chorus   the start of section "chorus" (cabin.json); @chorus+2 = two bars in
//
// Lists are comma-separated; `28-40` (bars) or `@chorus` expands in ranges.

import type { Section } from './project'

export interface TimeCtx {
  bpm: number
  beatsPerBar: number
  sections: Section[]
}

export function parsePosition(token: string, ctx: TimeCtx): number {
  const t = token.trim()
  if (!t) throw new Error('empty position')
  const sec = /^(-?\d*\.?\d+)s$/.exec(t)
  if (sec) return (Number(sec[1]) * ctx.bpm) / 60
  const beat = /^b(-?\d*\.?\d+)$/.exec(t)
  if (beat) return Number(beat[1])
  const named = /^@([\w .-]+?)(?:([+-]\d*\.?\d+))?$/.exec(t)
  if (named) {
    const s = ctx.sections.find((x) => x.name.toLowerCase() === named[1].toLowerCase())
    if (!s) throw new Error(`no section "${named[1]}" (have: ${ctx.sections.map((x) => x.name).join(', ') || 'none - add them to cabin.json'})`)
    return (s.from + Number(named[2] ?? 0)) * ctx.beatsPerBar
  }
  const bar = /^(?:bar:?)?(-?\d*\.?\d+)$/.exec(t)
  if (bar) return Number(bar[1]) * ctx.beatsPerBar
  throw new Error(`can't read position "${token}" (use 28, b112, 45.5s or @section)`)
}

/** A range: "28-40" (bars), "@chorus" (the section), or "<pos>:<pos>". Returns beats [from, to). */
export function parseRange(token: string, ctx: TimeCtx): [number, number] {
  const t = token.trim()
  const sec = /^@([\w .-]+)$/.exec(t)
  if (sec) {
    const s = ctx.sections.find((x) => x.name.toLowerCase() === sec[1].toLowerCase())
    if (s) return [s.from * ctx.beatsPerBar, s.to * ctx.beatsPerBar]
  }
  const bars = /^(\d*\.?\d+)-(\d*\.?\d+)$/.exec(t)
  if (bars) return [Number(bars[1]) * ctx.beatsPerBar, Number(bars[2]) * ctx.beatsPerBar]
  const pair = t.split(':')
  if (pair.length === 2) return [parsePosition(pair[0], ctx), parsePosition(pair[1], ctx)]
  throw new Error(`can't read range "${token}" (use 28-40, @section or <pos>:<pos>)`)
}

export function parsePositions(list: string, ctx: TimeCtx): number[] {
  return list.split(',').filter(Boolean).map((p) => parsePosition(p, ctx))
}

/** "bar.beat" label (1-based beat within the 0-based bar, like `28.1`). */
export function barBeat(beat: number, beatsPerBar: number): string {
  const bar = Math.floor(beat / beatsPerBar + 1e-9)
  const inBar = beat - bar * beatsPerBar
  const b = Math.round((inBar + 1) * 1000) / 1000
  return `${bar}.${Number.isInteger(b) ? b : b.toFixed(3).replace(/0+$/, '')}`
}
