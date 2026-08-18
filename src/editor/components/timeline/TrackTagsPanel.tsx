'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, X } from 'lucide-react'
import { useProjectStore } from '../../store/ProjectStore'
import { allProjectTags } from '../../utils/trackTags'
import { clamp } from '../../utils/math'

const PANEL_WIDTH = 240
// Rough height for the below/above flip test (chips row + combobox).
const PANEL_EST_HEIGHT = 140

/** Add/remove a track's tags. Tags are the group labels a modulator can route to.
 *  Chips plus a dashed "+ add" chip; clicking it opens a combobox (type a new
 *  tag, or pick an existing project tag). */
function TagEditor({
  tags, suggestions, onChange,
}: {
  tags: string[]
  suggestions: string[]
  onChange: (tags: string[]) => void
}) {
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (adding) inputRef.current?.focus()
  }, [adding])

  useEffect(() => {
    if (!adding) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setAdding(false)
        setOpen(false)
        setDraft('')
      }
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [adding])

  const addTag = (value: string) => {
    const t = value.trim()
    if (t && !tags.includes(t)) onChange([...tags, t])
    setDraft('')
    setOpen(false)
    setAdding(false)
  }

  // Existing project tags not already on this track, narrowed by what's typed.
  const q = draft.trim().toLowerCase()
  const matches = suggestions.filter((s) => !tags.includes(s) && s.toLowerCase().includes(q))

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5">
        {tags.map((t) => (
          <span
            key={t}
            className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-[3px] bg-[var(--bg-app)] border border-[var(--border)] text-[11px] text-[var(--text-3)]"
          >
            {t}
            <button
              onClick={() => onChange(tags.filter((x) => x !== t))}
              className="text-[var(--text-muted)] hover:text-[var(--text)] cursor-pointer"
              aria-label={`Remove tag ${t}`}
            >
              <X size={10} />
            </button>
          </span>
        ))}
        {!adding && (
          <button
            onClick={() => setAdding(true)}
            className="px-2 py-0.5 rounded-[3px] border border-dashed border-[var(--border)] text-[11px] text-[var(--text-muted)] hover:text-[var(--text-3)] hover:border-[var(--border-strong)] transition-colors cursor-pointer"
          >
            + add
          </button>
        )}
      </div>
      {adding && (
        <div ref={ref} className="relative mt-2">
          <div className="flex items-center gap-1 h-7 pl-2 pr-1 rounded bg-[var(--bg-app)] border border-[var(--border)] focus-within:border-[var(--accent)]">
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => { setDraft(e.target.value); setOpen(true) }}
              onFocus={() => setOpen(true)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); addTag(draft) }
                else if (e.key === 'Escape') {
                  // First Escape closes only the combobox; the panel's window
                  // listener takes the next one.
                  e.stopPropagation()
                  setAdding(false)
                  setOpen(false)
                  setDraft('')
                }
              }}
              placeholder="Add a tag…"
              className="flex-1 min-w-0 bg-transparent text-[11px] text-[var(--text-2)] outline-none placeholder:text-[var(--text-muted)]"
            />
            <button
              onClick={() => setOpen((v) => !v)}
              className="flex-shrink-0 text-[var(--text-muted)] hover:text-[var(--text-2)] cursor-pointer"
              aria-label="Show existing tags"
            >
              <ChevronDown size={13} />
            </button>
          </div>
          {open && matches.length > 0 && (
            <div className="absolute z-30 mt-1 w-full max-h-48 overflow-y-auto rounded bg-[var(--bg-elevated)] border border-[var(--border)] shadow-lg shadow-black/40 py-1">
              {matches.map((s) => (
                <button
                  key={s}
                  onClick={() => addTag(s)}
                  className="w-full px-2 h-7 flex items-center text-[11px] text-[var(--text-2)] hover:bg-[var(--border)] truncate cursor-pointer"
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** The track row's tag popup - anchored under the row's tag button, portal'd so
 *  the timeline's scroll/clip containers can't cut it off. */
export function TrackTagsPanel({
  trackId,
  anchor,
  onClose,
}: {
  trackId: string
  /** Viewport-space rect of the opener button (position the popover under it). */
  anchor: { left: number; top: number; bottom: number }
  onClose: () => void
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const track = useProjectStore((s) => s.tracks[trackId])
  const tracks = useProjectStore((s) => s.tracks)
  const setTrackTags = useProjectStore((s) => s.setTrackTags)

  useEffect(() => {
    const onDown = (ev: MouseEvent) => {
      const target = ev.target as HTMLElement
      if (panelRef.current?.contains(target)) return
      // The row's own opener toggles the panel itself - let its click handler win.
      if (target.closest?.('[data-tags-opener]')?.getAttribute('data-tags-opener') === trackId) return
      onClose()
    }
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') onClose()
    }
    // Deferred so the opener click that mounted the panel doesn't instantly close it.
    const id = setTimeout(() => window.addEventListener('mousedown', onDown), 0)
    window.addEventListener('keydown', onKey)
    return () => {
      clearTimeout(id)
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose, trackId])

  if (!track || track.type !== 'base' || !track.instrumentId) return null

  // Clamp into the viewport: prefer below the anchor, flip above when cramped.
  const left = clamp(anchor.left - 8, 8, window.innerWidth - PANEL_WIDTH - 8)
  const top = anchor.bottom + PANEL_EST_HEIGHT + 8 > window.innerHeight
    ? Math.max(8, anchor.top - PANEL_EST_HEIGHT - 6)
    : anchor.bottom + 6

  return createPortal(
    <div
      ref={panelRef}
      data-testid="track-tags-panel"
      className="fixed z-[70] rounded-lg border border-[var(--border-strong)] bg-[var(--bg-elevated)] p-3 shadow-[0_12px_32px_rgba(0,0,0,0.5)]"
      style={{ left, top, width: PANEL_WIDTH }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="mb-2 flex items-center gap-2">
        <span className="text-[11px] font-semibold text-[var(--text)]">Tags</span>
        <span className="max-w-[120px] truncate text-[10px] text-[var(--text-muted)]">{track.name}</span>
      </div>
      <TagEditor
        tags={track.tags ?? []}
        suggestions={allProjectTags(tracks)}
        onChange={(tags) => setTrackTags(trackId, tags)}
      />
    </div>,
    document.body,
  )
}
