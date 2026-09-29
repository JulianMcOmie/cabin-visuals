'use client'

import { useEffect } from 'react'
import { create } from 'zustand'
import { Eye, Undo2, X } from 'lucide-react'
import type { DocDiff } from '../../devtools/docDiff'
import { useHistoryStore } from '../store/HistoryStore'
import { useProjectStore } from '../store/ProjectStore'
import { useUIStore } from '../store/UIStore'

// When the file changes under the editor (the cabin CLI wrote it - usually
// Claude), dev/useFileSync.ts records the reload as ONE undo step and hands
// the diff here: a bar says what changed, Show lights the changed tracks (and
// scrolls to the first), Undo reverts it - and the file sync writes the revert
// back to project.json, so the CLI sees it too.

interface ReviewState {
  diff: DocDiff | null
  highlight: boolean
  changed: Set<string>
  show(diff: DocDiff): void
  setHighlight(on: boolean): void
  dismiss(): void
}

export const useReviewStore = create<ReviewState>((set) => ({
  diff: null,
  highlight: false,
  changed: new Set(),
  show: (diff) => set({ diff, highlight: false, changed: new Set(diff.tracks.map((t) => t.trackId)) }),
  setHighlight: (highlight) => set({ highlight }),
  dismiss: () => set({ diff: null, highlight: false, changed: new Set() }),
}))

function summary(d: DocDiff): string {
  const parts: string[] = []
  const added = d.tracks.reduce((n, t) => n + t.notesAdded.length, 0)
  const removed = d.tracks.reduce((n, t) => n + t.notesRemoved.length, 0)
  const params = d.tracks.filter((t) => t.paramsChanged.length).length
  const newTracks = d.tracks.filter((t) => t.change === 'added').length
  if (d.scenesAdded.length) parts.push(`${d.scenesAdded.length} new scene${d.scenesAdded.length > 1 ? 's' : ''}`)
  if (newTracks) parts.push(`${newTracks} new track${newTracks > 1 ? 's' : ''}`)
  if (added) parts.push(`+${added} notes`)
  if (removed) parts.push(`−${removed} notes`)
  if (params) parts.push(`params on ${params} track${params > 1 ? 's' : ''}`)
  if (d.bpm) parts.push(`tempo ${d.bpm[1]}`)
  return parts.join(' · ') || 'small changes'
}

export function ReviewBar() {
  const diff = useReviewStore((s) => s.diff)
  const highlight = useReviewStore((s) => s.highlight)
  useEffect(() => {
    if (!diff) return
    const t = setTimeout(() => { if (!useReviewStore.getState().highlight) useReviewStore.getState().dismiss() }, 20_000)
    return () => clearTimeout(t)
  }, [diff])
  if (!diff) return null
  const tracks = diff.tracks.length
  const show = () => {
    const rs = useReviewStore.getState()
    rs.setHighlight(!rs.highlight)
    const first = diff.tracks.find((t) => t.change !== 'removed')
    if (first && !rs.highlight) {
      const ps = useProjectStore.getState()
      if (ps.scenes[first.sceneId] && ps.activeSceneId !== first.sceneId) ps.setActiveScene(first.sceneId)
      useUIStore.getState().revealTrack(first.trackId)
    }
  }
  return (
    <div
      className="fixed bottom-4 left-1/2 z-[96] flex -translate-x-1/2 items-center gap-3 rounded-lg border border-violet-400/40 bg-[var(--bg-elevated)] px-3 py-2 text-[12px] text-[var(--text)] shadow-2xl"
      data-testid="review-bar"
    >
      <span className="h-2 w-2 rounded-full bg-violet-400" />
      <span><span className="text-violet-300">Claude</span> changed {tracks} track{tracks === 1 ? '' : 's'}: {summary(diff)}</span>
      <button className={`flex items-center gap-1 rounded px-2 py-0.5 ${highlight ? 'bg-violet-500/25 text-violet-200' : 'hover:bg-[var(--border)]'}`} onClick={show}><Eye size={12} />{highlight ? 'Showing' : 'Show'}</button>
      <button className="flex items-center gap-1 rounded px-2 py-0.5 hover:bg-[var(--border)]" onClick={() => { useHistoryStore.getState().undo(); useReviewStore.getState().dismiss() }}><Undo2 size={12} />Undo</button>
      <button className="rounded p-0.5 text-[var(--text-muted)] hover:text-[var(--text)]" onClick={() => useReviewStore.getState().dismiss()}><X size={12} /></button>
    </div>
  )
}
