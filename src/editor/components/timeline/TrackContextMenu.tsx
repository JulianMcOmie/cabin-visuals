import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronRight, Check } from 'lucide-react'
import { useProjectStore } from '../../store/ProjectStore'
import { getInstrument } from '../../instruments'
import { isNumberParam } from '../../instruments/types'
import { moverInputParamDefs, moverRegistry, getMover } from '../../core/visual/movers/registry'

/**
 * A submenu panel that keeps itself on-screen: it renders top-aligned to its
 * parent row, measures before paint, and shifts up by however much it would
 * overflow the viewport's bottom. A submenu can be much taller than the main
 * menu (one row per instrument param), so it needs its own clamping — the main
 * menu fitting is no guarantee the submenu does.
 */
function SubMenu({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [shift, setShift] = useState(0)
  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect()
    if (!r) return
    const overflow = r.bottom - (window.innerHeight - 8)
    if (overflow > 0) setShift(-Math.min(overflow, Math.max(0, r.top - 8)))
  }, [])
  return (
    <div
      ref={ref}
      style={{ top: shift }}
      className="absolute left-full -ml-1 min-w-[150px] py-1 rounded-md border border-zinc-700 bg-[#202024] shadow-lg shadow-black/50"
    >
      {children}
    </div>
  )
}

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
  const addMoverTrack = useProjectStore((s) => s.addMoverTrack)

  const [openSub, setOpenSub] = useState<'ability' | 'automation' | 'mover' | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  // Near the viewport's bottom/right edge the menu flips/clamps instead of
  // running off-screen. Measured before paint so it never flashes misplaced.
  // (Submenus clamp themselves — see SubMenu.)
  const [placement, setPlacement] = useState<{ left: number; top: number }>({ left: x, top: y })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    const up = y + height > window.innerHeight - 8 && y - height >= 8
    setPlacement({
      left: Math.max(8, Math.min(x, window.innerWidth - width - 8)),
      top: up ? y - height : Math.min(y, Math.max(8, window.innerHeight - height - 8)),
    })
  }, [x, y])

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
  const dimDef = track.type === 'mover' ? getMover(track.moverId) : undefined
  const abilities = def?.abilities ?? []
  // Only numeric params can be automated (keyframes interpolate a number).
  const params = track.type === 'mover' && dimDef
    ? moverInputParamDefs(dimDef).filter(isNumberParam)
    : (def?.params ?? []).filter(isNumberParam)
  const movers = def ? Object.values(moverRegistry) : []
  const childTracks = track.childIds.map((cid) => tracks[cid])
  const addedAbilities = new Set(childTracks.filter((c) => c?.type === 'ability').map((c) => c!.abilityKey))
  const automatedParams = new Set(childTracks.filter((c) => c?.type === 'automation').map((c) => c!.targetParam))

  const hasAny = abilities.length > 0 || params.length > 0 || movers.length > 0

  return (
    <div
      ref={ref}
      className="fixed z-50 min-w-[168px] py-1 rounded-md border border-zinc-700 bg-[#202024] text-xs shadow-lg shadow-black/50 select-none"
      style={{ left: placement.left, top: placement.top }}
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
            <SubMenu>
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
            </SubMenu>
          )}
        </div>
      )}

      {movers.length > 0 && (
        <div className="relative" onMouseEnter={() => setOpenSub('mover')} onMouseLeave={() => setOpenSub(null)}>
          <div className="flex items-center justify-between px-3 py-1.5 text-zinc-200 hover:bg-zinc-700/60 cursor-default">
            <span>Add mover track</span>
            <ChevronRight size={12} className="text-zinc-500" />
          </div>
          {openSub === 'mover' && (
            <SubMenu>
              {movers.map((d) => (
                <button
                  key={d.id}
                  onClick={() => { addMoverTrack(trackId, d.id, d.label); onClose() }}
                  className="w-full flex items-center justify-between gap-2 px-3 py-1.5 text-left text-zinc-200 hover:bg-zinc-700/60"
                >
                  <span className="truncate">{d.label}</span>
                </button>
              ))}
            </SubMenu>
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
            <SubMenu>
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
            </SubMenu>
          )}
        </div>
      )}
    </div>
  )
}
