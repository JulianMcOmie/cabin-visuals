'use client'

import { memo, useMemo, type RefObject } from 'react'
import { PLAYHEAD_TRIANGLE_HALF } from '../constants'
import { useProjectStore } from '../store/ProjectStore'
import { useCommentsStore, STATUS_COLOR } from './commentsStore'
import { useSongAnalysis } from './songAnalysis'
import { seekTo } from './useCommentSync'

// The song strip, under the timeline ruler: the song's named sections (the
// document's markers - `cabin sections`), its energy and chord roots (from
// `cabin analyze`, file sessions), and the review comments pinned along it.
// Positioned exactly like the ruler: TimelineArea translates `contentRef` with
// the lane scroll, and x = beat · pixelsPerBeat past the pickup.

const NOTE = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const PALETTE = ['#38bdf8', '#a78bfa', '#f472b6', '#fb923c', '#34d399', '#facc15', '#60a5fa', '#e879f9']
export const SONG_STRIP_HEIGHT = 24

interface Props {
  contentRef: RefObject<HTMLDivElement | null>
  barWidthPx: number
  timelineWidthPx: number
  pickupPx: number
  labelWidth: number
}

export const SongStrip = memo(function SongStrip({ contentRef, barWidthPx, timelineWidthPx, pickupPx, labelWidth }: Props) {
  const markers = useProjectStore((s) => s.markers)
  const bpb = useProjectStore((s) => s.beatsPerBar)
  const file = useCommentsStore((s) => s.file)
  const comments = useCommentsStore((s) => s.doc?.comments)
  const song = useSongAnalysis(file)
  const ppb = barWidthPx / bpb

  const energyPath = useMemo(() => {
    if (!song) return null
    const h = SONG_STRIP_HEIGHT
    const pts: string[] = [`M0 ${h}`]
    song.energy.forEach((e, b) => pts.push(`L${(b + 0.5) * ppb} ${h - 1 - Math.min(1, e * 1.6) * (h * 0.62)}`))
    pts.push(`L${song.energy.length * ppb} ${h} Z`)
    return pts.join(' ')
  }, [song, ppb])

  if (!markers.length && !file) return null

  return (
    <div className="relative flex border-b border-[var(--border)] bg-[#06070b]" style={{ height: SONG_STRIP_HEIGHT }} data-testid="song-strip">
      <div className="flex-shrink-0 border-r border-[var(--border)] px-2 text-[9px] uppercase leading-[24px] tracking-[0.12em] text-[var(--text-3)]" style={{ width: labelWidth }}>
        Song
      </div>
      <div className="relative flex-1 overflow-clip">
        <div ref={contentRef} className="absolute inset-y-0" style={{ left: PLAYHEAD_TRIANGLE_HALF, width: timelineWidthPx }}>
          <div
            className="absolute inset-y-0"
            style={{ left: pickupPx, right: 0 }}
            onPointerDown={(e) => {
              if (e.button !== 0) return
              const rect = e.currentTarget.getBoundingClientRect()
              seekTo(Math.max(0, (e.clientX - rect.left) / ppb))
            }}
          >
            {energyPath && (
              <svg className="pointer-events-none absolute left-0 top-0" width={song!.energy.length * ppb} height={SONG_STRIP_HEIGHT}>
                <path d={energyPath} fill="rgba(148,163,184,0.16)" stroke="rgba(148,163,184,0.35)" strokeWidth={0.75} />
              </svg>
            )}
            {markers.map((m, i) => {
              const color = m.color ?? PALETTE[i % PALETTE.length]
              return (
                <div
                  key={m.id}
                  className="absolute top-0 flex h-[12px] items-center overflow-hidden border-l px-1 text-[9px] font-medium leading-none"
                  style={{ left: m.from * barWidthPx, width: Math.max(2, (m.to - m.from) * barWidthPx), borderColor: color, color, background: `${color}22` }}
                  title={`${m.name}: bars ${m.from}–${m.to}`}
                  onPointerDown={(e) => { e.stopPropagation(); seekTo(m.from * bpb) }}
                >
                  <span className="truncate">{m.name}</span>
                </div>
              )
            })}
            {song && ppb >= 3 && song.chords.map(([beat, root], i) => {
              const next = song.chords[i + 1]?.[0] ?? beat + 64
              if (root < 0 || (next - beat) * ppb < 16) return null
              return (
                <span key={i} className="pointer-events-none absolute bottom-[1px] text-[8.5px] leading-none text-slate-400/70" style={{ left: beat * ppb + 2 }}>
                  {NOTE[root]}
                </span>
              )
            })}
            {comments?.map((c) => (
              <button
                key={c.id}
                className="absolute top-[12px] h-[11px] min-w-[11px] rounded-[3px] px-[2px] text-[8px] font-bold leading-[11px] text-black"
                style={{
                  left: c.beat * ppb - 5,
                  width: c.endBeat !== undefined ? Math.max(11, (c.endBeat - c.beat) * ppb) : undefined,
                  background: STATUS_COLOR[c.status],
                  opacity: c.status === 'resolved' || c.status === 'wontfix' ? 0.45 : 1,
                }}
                title={`${c.id} [${c.status}] ${c.author}: ${c.text}`}
                onPointerDown={(e) => { e.stopPropagation(); seekTo(c.beat); useCommentsStore.getState().focus(c.id) }}
              >
                {c.id.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
})
