'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { MessageSquare, X, Crosshair, Check, RotateCcw, Trash2, CornerDownRight } from 'lucide-react'
import { useCommentsStore, isLive, STATUS_COLOR, type ReviewComment, type CommentStatus } from './commentsStore'
import { captureStill, notesNear, seekTo } from './useCommentSync'
import { useProjectStore } from '../store/ProjectStore'
import { useUIStore } from '../store/UIStore'

// The comment composer (a popover where you pin one) and the comments panel
// (every comment, its thread with Claude's replies and frames, and the
// actions). Dev `?file=` sessions only - mounted by App when the store has a file.

function barLabel(beat: number, bpb: number) {
  const bar = Math.floor(beat / bpb)
  const inBar = beat - bar * bpb
  return `${bar}.${(Math.floor(inBar) + 1)}${inBar % 1 > 0.01 ? `+${(inBar % 1).toFixed(2).slice(1)}` : ''}`
}

function useTargetLabel(trackId?: string, sceneId?: string): string {
  return useProjectStore((s) => {
    if (trackId) {
      for (const scene of Object.values(s.scenes)) {
        const t = scene.tracks[trackId]
        if (t) return `${scene.name} / ${t.name}`
      }
    }
    if (sceneId && s.scenes[sceneId]) return `scene ${s.scenes[sceneId].name}`
    return 'the whole frame'
  })
}

function sectionAt(beat: number): string | undefined {
  const { markers, beatsPerBar } = useProjectStore.getState()
  const bar = beat / beatsPerBar
  return markers.find((m) => bar >= m.from && bar < m.to)?.name
}

function Composer() {
  const composer = useCommentsStore((s) => s.composer)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)
  const bpb = useProjectStore((s) => s.beatsPerBar)
  const target = useTargetLabel(composer?.trackId, composer?.sceneId)
  useEffect(() => { if (composer) { setText(''); setTimeout(() => ref.current?.focus(), 0) } }, [composer])
  if (!composer) return null
  const left = Math.max(12, Math.min(window.innerWidth - 332, composer.x - 160))
  const top = Math.max(12, Math.min(window.innerHeight - 190, composer.y + 12))
  const submit = async () => {
    if (!text.trim() || busy) return
    setBusy(true)
    try {
      const { scenes } = useProjectStore.getState()
      let sceneId = composer.sceneId, sceneName: string | undefined, trackName: string | undefined, instrumentId: string | undefined
      if (composer.trackId) {
        for (const [sid, scene] of Object.entries(scenes)) {
          const t = scene.tracks[composer.trackId]
          if (t) { sceneId = sid; sceneName = scene.name; trackName = t.name; instrumentId = t.instrumentId; break }
        }
      } else if (sceneId) sceneName = scenes[sceneId]?.name
      const still = captureStill(composer.beat)
      await useCommentsStore.getState().add({
        beat: composer.beat, endBeat: composer.endBeat, text,
        trackId: composer.trackId, trackName, sceneId, sceneName, instrumentId, screen: composer.screen,
        notes: notesNear(composer.trackId, composer.beat, composer.endBeat),
      }, still)
      useCommentsStore.getState().closeComposer()
    } finally {
      setBusy(false)
    }
  }
  return (
    <div
      className="fixed z-[90] w-[320px] rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] p-2.5 text-[12px] text-[var(--text)] shadow-2xl"
      style={{ left, top }}
      onPointerDown={(e) => e.stopPropagation()}
      data-testid="comment-composer"
    >
      <div className="mb-1.5 flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
        <MessageSquare size={12} className="text-amber-400" />
        <span>bar {barLabel(composer.beat, bpb)}{sectionAt(composer.beat) ? ` · @${sectionAt(composer.beat)}` : ''} · {target}</span>
      </div>
      <textarea
        ref={ref}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void submit() }
          if (e.key === 'Escape') useCommentsStore.getState().closeComposer()
        }}
        rows={3}
        placeholder="What should change here? (⌘↵ to pin)"
        className="w-full resize-none rounded border border-[var(--border)] bg-[var(--bg-app)] px-2 py-1.5 text-[12px] outline-none focus:border-[var(--accent)]"
      />
      <div className="mt-1.5 flex justify-end gap-1.5">
        <button className="rounded px-2 py-1 text-[var(--text-muted)] hover:text-[var(--text)]" onClick={() => useCommentsStore.getState().closeComposer()}>Cancel</button>
        <button
          className="rounded bg-amber-500/90 px-2.5 py-1 font-medium text-black hover:bg-amber-400 disabled:opacity-50"
          disabled={!text.trim() || busy}
          onClick={() => void submit()}
        >{busy ? 'Pinning…' : 'Pin comment'}</button>
      </div>
    </div>
  )
}

function Card({ c, file, bpb, focused }: { c: ReviewComment; file: string; bpb: number; focused: boolean }) {
  const [reply, setReply] = useState('')
  const [open, setOpen] = useState(false)
  const img = (rel: string) => `/api/dev/projects/${encodeURIComponent(file)}/files/${rel.split('/').map(encodeURIComponent).join('/')}`
  const store = useCommentsStore.getState()
  const section = sectionAt(c.beat)
  const jump = () => {
    seekTo(c.beat)
    if (c.trackId) {
      const { scenes, activeSceneId, setActiveScene } = useProjectStore.getState()
      const sid = Object.keys(scenes).find((k) => scenes[k].tracks[c.trackId!])
      if (sid && sid !== activeSceneId) setActiveScene(sid)
      useUIStore.getState().setSelectedTrackId(c.trackId)
      useUIStore.getState().revealTrack(c.trackId)
    }
    store.focus(c.id)
  }
  const setStatus = (s: CommentStatus) => void store.setStatus(c.id, s)
  return (
    <div
      className={`rounded-md border p-2 ${focused ? 'border-[var(--accent)]' : 'border-[var(--border)]'} bg-[var(--bg-app)]`}
      data-comment-id={c.id}
    >
      <div className="flex items-center gap-1.5 text-[10px] text-[var(--text-muted)]">
        <span className="rounded px-1 py-[1px] font-semibold uppercase tracking-wide text-black" style={{ background: STATUS_COLOR[c.status] }}>{c.status}</span>
        <button className="hover:text-[var(--text)]" onClick={jump} title="Jump there">{c.id} · bar {barLabel(c.beat, bpb)}{section ? ` · @${section}` : ''}</button>
        <span className="ml-auto truncate">{c.trackName ? `${c.sceneName} / ${c.trackName}` : c.sceneName ?? ''}</span>
      </div>
      <div className="mt-1 whitespace-pre-wrap text-[12px] text-[var(--text)]"><span className="text-[var(--text-muted)]">{c.author}: </span>{c.text}</div>
      {/* eslint-disable-next-line @next/next/no-img-element -- dev-only local frames from the project folder */}
      {c.still && <img src={img(c.still)} alt="" className="mt-1.5 w-full rounded border border-[var(--border)] opacity-90" />}
      {c.thread.map((t, i) => (
        <div key={i} className="mt-1.5 border-l-2 pl-2" style={{ borderColor: t.author === 'claude' ? '#a78bfa' : 'var(--border)' }}>
          <div className="whitespace-pre-wrap text-[12px]"><span className={t.author === 'claude' ? 'text-violet-300' : 'text-[var(--text-muted)]'}>{t.author}: </span>{t.text}</div>
          {/* eslint-disable-next-line @next/next/no-img-element -- dev-only local frames */}
          {t.images?.map((im) => <img key={im} src={img(im)} alt="" className="mt-1 w-full rounded border border-violet-400/30" />)}
        </div>
      ))}
      <div className="mt-1.5 flex items-center gap-1 text-[11px]">
        <button className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[var(--text-muted)] hover:bg-[var(--border)] hover:text-[var(--text)]" onClick={() => setOpen((v) => !v)}><CornerDownRight size={11} />Reply</button>
        {isLive(c)
          ? <button className="flex items-center gap-1 rounded px-1.5 py-0.5 text-emerald-300 hover:bg-emerald-500/10" onClick={() => setStatus('resolved')}><Check size={11} />Resolve</button>
          : <button className="flex items-center gap-1 rounded px-1.5 py-0.5 text-amber-300 hover:bg-amber-500/10" onClick={() => setStatus('open')}><RotateCcw size={11} />Reopen</button>}
        <button className="ml-auto rounded p-1 text-[var(--text-muted)] hover:text-red-400" title="Delete" onClick={() => { if (window.confirm(`Delete ${c.id}?`)) void store.remove(c.id) }}><Trash2 size={11} /></button>
      </div>
      {open && (
        <div className="mt-1">
          <textarea
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && reply.trim()) { void store.reply(c.id, reply); setReply(''); setOpen(false) }
            }}
            rows={2}
            placeholder="Reply (⌘↵) - reopens it for Claude"
            className="w-full resize-none rounded border border-[var(--border)] bg-[var(--bg-elevated)] px-2 py-1 text-[12px] outline-none focus:border-[var(--accent)]"
          />
        </div>
      )}
    </div>
  )
}

function Panel() {
  const { panelOpen, doc, file, mode, focusId } = useCommentsStore()
  const bpb = useProjectStore((s) => s.beatsPerBar)
  const [all, setAll] = useState(false)
  const list = useMemo(() => (doc?.comments ?? []).filter((c) => all || isLive(c)).sort((a, b) => a.beat - b.beat), [doc, all])
  useEffect(() => {
    if (!focusId) return
    document.querySelector(`[data-comment-id="${focusId}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [focusId, panelOpen])
  if (!panelOpen || !file) return null
  const live = (doc?.comments ?? []).filter(isLive).length
  return (
    <div
      className="fixed right-3 top-14 bottom-3 z-[75] flex w-[340px] flex-col rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--text)] shadow-2xl"
      onPointerDown={(e) => e.stopPropagation()}
      data-testid="comments-panel"
    >
      <div className="flex items-center gap-2 border-b border-[var(--border)] px-3 py-2 text-[12px]">
        <MessageSquare size={13} className="text-amber-400" />
        <span className="font-medium">Comments</span>
        <span className="text-[var(--text-muted)]">{live} open</span>
        <button
          className={`ml-auto flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] ${mode ? 'bg-amber-500/20 text-amber-300' : 'text-[var(--text-muted)] hover:text-[var(--text)]'}`}
          onClick={() => useCommentsStore.getState().setMode(!mode)}
          title="Comment mode (Shift+C): click a track lane or the canvas to pin a comment there"
        ><Crosshair size={11} />{mode ? 'Pinning' : 'Pin mode'}</button>
        <button className="rounded p-0.5 text-[var(--text-muted)] hover:text-[var(--text)]" onClick={() => useCommentsStore.getState().setPanelOpen(false)}><X size={13} /></button>
      </div>
      <div className="flex gap-1 px-3 pt-2 text-[11px]">
        {(['open', 'all'] as const).map((k) => (
          <button key={k} className={`rounded px-2 py-0.5 ${(k === 'all') === all ? 'bg-[var(--border)] text-[var(--text)]' : 'text-[var(--text-muted)]'}`} onClick={() => setAll(k === 'all')}>{k === 'open' ? 'Open' : 'All'}</button>
        ))}
        <span className="ml-auto text-[var(--text-muted)]">C at the playhead</span>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {list.length === 0 && <div className="pt-6 text-center text-[12px] text-[var(--text-muted)]">No {all ? '' : 'open '}comments. Press C to pin one at the playhead.</div>}
        {list.map((c) => <Card key={c.id} c={c} file={file} bpb={bpb} focused={c.id === focusId} />)}
      </div>
    </div>
  )
}

/** Everything comment-shaped that floats over the editor. */
export function CommentsLayer() {
  const file = useCommentsStore((s) => s.file)
  const [host, setHost] = useState<HTMLElement | null>(null)
  useEffect(() => setHost(document.body), [])
  if (!file || !host) return null
  return createPortal(<><Composer /><Panel /></>, host)
}

/** The chip in the scene tabs: open-comment count; click = panel, Shift-click = comment mode. */
export function CommentsChip() {
  const file = useCommentsStore((s) => s.file)
  const open = useCommentsStore((s) => (s.doc?.comments ?? []).filter(isLive).length)
  const review = useCommentsStore((s) => (s.doc?.comments ?? []).filter((c) => c.status === 'review').length)
  const mode = useCommentsStore((s) => s.mode)
  if (!file) return null
  return (
    <button
      className={`flex h-6 items-center gap-1 rounded-md px-2 text-[11px] ${mode ? 'bg-amber-500/20 text-amber-300' : 'text-[var(--text-muted)] hover:bg-[var(--border)] hover:text-[var(--text)]'}`}
      onClick={(e) => {
        const s = useCommentsStore.getState()
        if (e.shiftKey) s.setMode(!s.mode)
        else s.setPanelOpen(!s.panelOpen)
      }}
      title="Comments (click) · comment mode (Shift+click, or Shift+C) · C pins one at the playhead"
      data-testid="comments-chip"
    >
      <MessageSquare size={12} className={open ? 'text-amber-400' : ''} />
      <span>{open}</span>
      {review > 0 && <span className="rounded bg-violet-500/30 px-1 text-violet-200" title="Claude replied - review">{review}</span>}
    </button>
  )
}
