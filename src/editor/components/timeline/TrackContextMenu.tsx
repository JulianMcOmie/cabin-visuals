import { useEffect, useRef, useState } from 'react'
import { ChevronRight, Check } from 'lucide-react'
import { useProjectStore } from '../../store/ProjectStore'
import { getInstrument } from '../../instruments'

interface TrackContextMenuProps {
  x: number
  y: number
  trackId: string
  onClose: () => void
}

/**
 * Right-click menu on a track's label. Two submenus, both scoped to the track's
 * instrument: "Add ability track" (reveals one of the instrument's declared ability
 * lanes — opt-in) above "Add automation track" (adds an automation child track driving
 * one of the instrument's params). Items already present are checked + disabled.
 */
export function TrackContextMenu({ x, y, trackId, onClose }: TrackContextMenuProps) {
  const track = useProjectStore((s) => s.tracks[trackId])
  const tracks = useProjectStore((s) => s.tracks)
  const addAbilityTrack = useProjectStore((s) => s.addAbilityTrack)
  const addAutomationTrack = useProjectStore((s) => s.addAutomationTrack)

  const [openSub, setOpenSub] = useState<'ability' | 'automation' | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  if (!track) return null
  const def = getInstrument(track.instrumentId)
  const abilities = def?.abilities ?? []
  const params = def?.params ?? []
  const childTracks = track.childIds.map((cid) => tracks[cid])
  const addedAbilities = new Set(childTracks.filter((c) => c?.type === 'ability').map((c) => c!.abilityKey))
  const automatedParams = new Set(childTracks.filter((c) => c?.type === 'automation').map((c) => c!.targetParam))

  const hasAny = abilities.length > 0 || params.length > 0

  return (
    <div
      ref={ref}
      className="fixed z-50 min-w-[168px] py-1 rounded-md border border-zinc-700 bg-[#202024] text-xs shadow-lg shadow-black/50 select-none"
      style={{ left: x, top: y }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {!hasAny && <div className="px-3 py-1.5 text-zinc-500">Nothing to add</div>}

      {abilities.length > 0 && (
        <div className="relative" onMouseEnter={() => setOpenSub('ability')} onMouseLeave={() => setOpenSub(null)}>
          <div className="flex items-center justify-between px-3 py-1.5 text-zinc-200 hover:bg-zinc-700/60 cursor-default">
            <span>Add ability track</span>
            <ChevronRight size={12} className="text-zinc-500" />
          </div>
          {openSub === 'ability' && (
            <div className="absolute left-full top-0 -ml-1 min-w-[150px] py-1 rounded-md border border-zinc-700 bg-[#202024] shadow-lg shadow-black/50">
              {abilities.map((a) => {
                const added = addedAbilities.has(a.key)
                return (
                  <button
                    key={a.key}
                    disabled={added}
                    onClick={() => { addAbilityTrack(trackId, a.key, a.label); onClose() }}
                    className={`w-full flex items-center justify-between gap-2 px-3 py-1.5 text-left ${
                      added ? 'text-zinc-500 cursor-default' : 'text-zinc-200 hover:bg-zinc-700/60'
                    }`}
                  >
                    <span className="flex items-center gap-1.5 min-w-0">
                      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: a.color ?? '#818cf8' }} />
                      <span className="truncate">{a.label}</span>
                    </span>
                    {added && <Check size={11} className="flex-shrink-0" />}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}

      {params.length > 0 && (
        <div className="relative" onMouseEnter={() => setOpenSub('automation')} onMouseLeave={() => setOpenSub(null)}>
          <div className="flex items-center justify-between px-3 py-1.5 text-zinc-200 hover:bg-zinc-700/60 cursor-default">
            <span>Add automation track</span>
            <ChevronRight size={12} className="text-zinc-500" />
          </div>
          {openSub === 'automation' && (
            <div className="absolute left-full top-0 -ml-1 min-w-[150px] py-1 rounded-md border border-zinc-700 bg-[#202024] shadow-lg shadow-black/50">
              {params.map((p) => {
                const added = automatedParams.has(p.key)
                return (
                  <button
                    key={p.key}
                    disabled={added}
                    onClick={() => { addAutomationTrack(trackId, p.key, p.label); onClose() }}
                    className={`w-full flex items-center justify-between gap-2 px-3 py-1.5 text-left ${
                      added ? 'text-zinc-500 cursor-default' : 'text-zinc-200 hover:bg-zinc-700/60'
                    }`}
                  >
                    <span className="truncate">{p.label}</span>
                    {added && <Check size={11} className="flex-shrink-0" />}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
