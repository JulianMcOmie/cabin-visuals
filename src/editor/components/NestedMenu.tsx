import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronRight, Check } from 'lucide-react'

export interface NestedMenuItem {
  id: string
  label: string
  /** Disabled rows keep their place in the list but ignore clicks. */
  disabled?: boolean
  /** Checked rows show a trailing checkmark (e.g. "already added"). */
  checked?: boolean
  /** Optional leading color dot (ability lanes use their lane color). */
  swatchColor?: string
}

export interface NestedMenuGroup {
  /** Passed back through onPick so the consumer knows which submenu the item came from. */
  key: string
  label: string
  items: NestedMenuItem[]
}

/**
 * A submenu panel that keeps itself on-screen: it renders top-aligned to its
 * parent row, measures before paint, and shifts up by however much it would
 * overflow the viewport's bottom. A submenu can be much taller than the main
 * menu (one row per item), so it needs its own clamping - the main menu
 * fitting is no guarantee the submenu does.
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

/**
 * Shared nested pop-up menu shell: a fixed-position main menu of group rows, each
 * opening a hover submenu of pickable items. One consumer per data set - the track
 * context menu and the effects picker both render through this. Groups with no
 * items are hidden; with none left the empty label shows instead.
 */
export function NestedMenu({
  x, y, groups, emptyLabel = 'Nothing to add', onPick, onClose,
}: {
  x: number
  y: number
  groups: NestedMenuGroup[]
  emptyLabel?: string
  onPick: (groupKey: string, itemId: string) => void
  onClose: () => void
}) {
  const [openSub, setOpenSub] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  // Near the viewport's bottom/right edge the menu flips/clamps instead of
  // running off-screen. Measured before paint so it never flashes misplaced.
  // (Submenus clamp themselves - see SubMenu.)
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

  const visible = groups.filter((g) => g.items.length > 0)

  return (
    <div
      ref={ref}
      className="fixed z-50 min-w-[168px] py-1 rounded-md border border-zinc-700 bg-[#202024] text-xs shadow-lg shadow-black/50 select-none"
      style={{ left: placement.left, top: placement.top }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {visible.length === 0 && <div className="px-3 py-1.5 text-zinc-500">{emptyLabel}</div>}

      {visible.map((group) => (
        <div
          key={group.key}
          className="relative"
          onMouseEnter={() => setOpenSub(group.key)}
          onMouseLeave={() => setOpenSub(null)}
        >
          <div className="flex items-center justify-between px-3 py-1.5 text-zinc-200 hover:bg-zinc-700/60 cursor-default">
            <span>{group.label}</span>
            <ChevronRight size={12} className="text-zinc-500" />
          </div>
          {openSub === group.key && (
            <SubMenu>
              {group.items.map((item) => (
                <button
                  key={item.id}
                  disabled={item.disabled}
                  onClick={() => { onPick(group.key, item.id); onClose() }}
                  className={`w-full flex items-center justify-between gap-2 px-3 py-1.5 text-left ${
                    item.disabled ? 'text-zinc-500 cursor-default' : 'text-zinc-200 hover:bg-zinc-700/60'
                  }`}
                >
                  <span className="flex items-center gap-1.5 min-w-0">
                    {item.swatchColor && (
                      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: item.swatchColor }} />
                    )}
                    <span className="truncate">{item.label}</span>
                  </span>
                  {item.checked && <Check size={11} className="flex-shrink-0" />}
                </button>
              ))}
            </SubMenu>
          )}
        </div>
      ))}
    </div>
  )
}
