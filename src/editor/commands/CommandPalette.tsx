'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Command } from 'lucide-react'
import { listCommands, runCommand, type EditorCommand } from './registry'
import { useUIStore } from '../store/UIStore'

// ⌘K / Ctrl+K: every editor command (commands/registry.ts - the same list the
// cabin CLI runs with `cabin cmd`). Type to filter, ↑↓ to move, Enter to run;
// a command that needs an argument asks for it in the same box.

function score(c: EditorCommand, q: string): number {
  if (!q) return 1
  const hay = `${c.title} ${c.group} ${c.keywords ?? ''} ${c.id}`.toLowerCase()
  let at = 0, s = 0
  for (const ch of q.toLowerCase()) {
    const i = hay.indexOf(ch, at)
    if (i < 0) return 0
    s += i === at ? 2 : 1
    at = i + 1
  }
  return s + (c.title.toLowerCase().startsWith(q.toLowerCase()) ? 10 : 0)
}

export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const [pending, setPending] = useState<{ cmd: EditorCommand; values: Record<string, unknown>; argIndex: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    // capture phase + early registration: the MIDI editor's vim mode claims k
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        e.stopImmediatePropagation()
        setOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  useEffect(() => {
    useUIStore.setState({ modalOpen: open })
    if (open) { setQ(''); setSel(0); setPending(null); setError(null); setTimeout(() => inputRef.current?.focus(), 0) }
  }, [open])

  const list = useMemo(() => {
    if (!open || pending) return []
    return listCommands().map((c) => [c, score(c, q)] as const).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]).map(([c]) => c).slice(0, 40)
  }, [open, q, pending])

  if (!open) return null

  const required = (c: EditorCommand) => (c.args ?? []).filter((a) => !a.optional)
  const execute = async (cmd: EditorCommand, values: Record<string, unknown>) => {
    try {
      await runCommand(cmd.id, values)
      setOpen(false)
    } catch (e) {
      setError((e as Error).message)
    }
  }
  const choose = (cmd: EditorCommand) => {
    if (required(cmd).length) { setPending({ cmd, values: {}, argIndex: 0 }); setQ(''); return }
    void execute(cmd, {})
  }
  const submitArg = () => {
    if (!pending) return
    const args = required(pending.cmd)
    const arg = args[pending.argIndex]
    const raw = q.trim()
    const value = raw !== '' && !Number.isNaN(Number(raw)) ? Number(raw) : raw
    const values = { ...pending.values, [arg.name]: value }
    if (pending.argIndex + 1 < args.length) { setPending({ ...pending, values, argIndex: pending.argIndex + 1 }); setQ('') }
    else void execute(pending.cmd, values)
  }
  const arg = pending ? required(pending.cmd)[pending.argIndex] : null

  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-start justify-center bg-black/40 pt-[14vh]" onPointerDown={() => setOpen(false)} data-testid="command-palette">
      <div className="w-[560px] overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--text)] shadow-2xl" onPointerDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-[var(--border)] px-3 py-2.5">
          <Command size={14} className="text-[var(--text-muted)]" />
          {pending && <span className="rounded bg-[var(--border)] px-1.5 py-0.5 text-[11px]">{pending.cmd.title}</span>}
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => { setQ(e.target.value); setSel(0); setError(null) }}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Escape') { if (pending) { setPending(null); setQ('') } else setOpen(false) }
              else if (e.key === 'ArrowDown') { e.preventDefault(); setSel((v) => Math.min(list.length - 1, v + 1)) }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((v) => Math.max(0, v - 1)) }
              else if (e.key === 'Enter') { e.preventDefault(); if (pending) submitArg(); else if (list[sel]) choose(list[sel]) }
            }}
            placeholder={arg ? arg.hint : 'Type a command…'}
            className="flex-1 bg-transparent text-[14px] outline-none placeholder:text-[var(--text-muted)]"
          />
          <kbd className="rounded border border-[var(--border)] px-1 text-[10px] text-[var(--text-muted)]">esc</kbd>
        </div>
        {error && <div className="px-3 py-2 text-[12px] text-red-400">{error}</div>}
        {!pending && (
          <div className="max-h-[50vh] overflow-y-auto py-1">
            {list.length === 0 && <div className="px-3 py-3 text-[12px] text-[var(--text-muted)]">No matching commands</div>}
            {list.map((c, i) => (
              <button
                key={c.id}
                className={`flex w-full items-center gap-3 px-3 py-1.5 text-left text-[13px] ${i === sel ? 'bg-[color-mix(in_srgb,var(--accent)_18%,transparent)]' : ''}`}
                onMouseEnter={() => setSel(i)}
                onClick={() => choose(c)}
              >
                <span className="w-[72px] flex-shrink-0 text-[10px] uppercase tracking-wide text-[var(--text-muted)]">{c.group}</span>
                <span className="flex-1 truncate">{c.title}</span>
                <span className="text-[10px] text-[var(--text-3)]">{c.id}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
