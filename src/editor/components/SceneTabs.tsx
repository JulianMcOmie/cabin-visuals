'use client'

import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { Copy, Trash2 } from 'lucide-react'
import { useProjectStore } from '../store/ProjectStore'
import { useUIStore } from '../store/UIStore'

/** Flat right-click menu for a scene tab: duplicate or delete. (What the canvas
 *  shows is the transport strip's VIEW chip now, not a menu item here - so Main,
 *  which can do neither, gets no menu at all.) Styled like the shared NestedMenu
 *  shell (backdrop-to-close, Esc, stands down editor surfaces). */
function SceneTabMenu({ x, y, canDelete, onDuplicate, onDelete, onClose }: {
  x: number
  y: number
  canDelete: boolean
  onDuplicate: () => void
  onDelete: () => void
  onClose: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  useEffect(() => {
    useUIStore.getState().setModalOpen(true)
    return () => useUIStore.getState().setModalOpen(false)
  }, [])
  const left = Math.min(x, (typeof window !== 'undefined' ? window.innerWidth : 9999) - 160)
  return (
    <>
      <div
        className="fixed inset-0 z-50"
        onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onClose() }}
        onPointerDown={(e) => e.stopPropagation()}
        onContextMenu={(e) => { e.preventDefault(); onClose() }}
      />
      <div
        className="fixed z-50 min-w-[140px] py-1 rounded-md border border-zinc-700 bg-[#202024] text-xs shadow-lg shadow-black/50 select-none"
        style={{ left, top: y }}
        onContextMenu={(e) => e.preventDefault()}
      >
        <button
          onClick={() => { onDuplicate(); onClose() }}
          className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-zinc-200 hover:bg-zinc-700/60 cursor-pointer"
        >
          <Copy size={12} /> Duplicate
        </button>
        <button
          onClick={() => { if (canDelete) { onDelete(); onClose() } }}
          disabled={!canDelete}
          className={`w-full flex items-center gap-2 px-3 py-1.5 text-left ${canDelete ? 'text-red-400 hover:bg-red-500/15 cursor-pointer' : 'text-red-400/40 cursor-default'}`}
        >
          <Trash2 size={12} /> Delete
        </button>
      </div>
    </>
  )
}

// Track positions per slider. Fine enough that a drag feels continuous, coarse
// enough that one arrow key is a visible step.
const ZOOM_POSITIONS = 240

/**
 * The zoom sliders' axis cues. Something has to say which slider is which at
 * rest, but lucide's UnfoldHorizontal/UnfoldVertical spent ~6 strokes each -
 * arrowheads plus a centre bar - which was most of the control's ink, and at
 * 11px the arrowheads muddy into blobs.
 *
 * These say it in two strokes, and say it about the QUANTITY rather than the
 * gesture: the GAP between the marks is the thing the slider sets. Uprights for
 * a beat's width, rules for a track row's height - which is also what the
 * timeline underneath is made of. Axis-aligned hairlines stay crisp at this
 * size where diagonal arrowheads cannot.
 *
 * Options were explored at /dev/timeline-zoom-lab.
 */
function BeatWidthGlyph() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
      <path d="M1.5 1v8M8.5 1v8" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
    </svg>
  )
}

function RowHeightGlyph() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
      <path d="M1 1.5h8M1 8.5h8" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
    </svg>
  )
}

/**
 * One timeline zoom slider: an icon that says which way it stretches, then a
 * filled track in the same language as the inspector's ParamSlider (3px rule,
 * dampened-blue fill, 9px square thumb) - so the toolbar and the panels look
 * like one instrument rather than two.
 *
 * The track is LOGARITHMIC, because zoom is multiplicative: 4 → 8 px/beat is
 * the same gesture as 40 → 80. Linearly, the levels anyone actually works at
 * were squeezed into the first fifth of the travel - unusable for fine tuning,
 * and it left the fill looking permanently empty at the default zoom.
 */
function ZoomSlider({ icon, label, value, min, max, unit, onChange }: {
  icon: ReactNode
  label: string
  value: number
  min: number
  max: number
  /** Spoken value for assistive tech - the raw slider positions are meaningless. */
  unit: string
  onChange: (value: number) => void
}) {
  const decades = Math.log(max / min)
  const position = Math.round((Math.log(value / min) / decades) * ZOOM_POSITIONS)
  const valueAt = (pos: number) => min * Math.exp((pos / ZOOM_POSITIONS) * decades)

  const commit = (pos: number) => {
    const next = Math.round(valueAt(pos))
    // Whole-pixel rounding can swallow a step near the low end, which makes the
    // arrow keys look dead; move a single unit instead of nothing.
    const moved = next === value ? value + Math.sign(pos - position) : next
    onChange(Math.max(min, Math.min(max, moved)))
  }

  return (
    <label title={label} className="group/zoom flex items-center gap-1.5">
      <span className="flex-shrink-0 text-[var(--text-muted)] group-hover/zoom:text-[var(--text-3)]">
        {icon}
      </span>
      <input
        type="range"
        min={0}
        max={ZOOM_POSITIONS}
        value={position}
        aria-label={label}
        aria-valuetext={`${value} ${unit}`}
        onChange={(e) => commit(Number(e.target.value))}
        style={{ '--fill': `${(position / ZOOM_POSITIONS) * 100}%` } as CSSProperties}
        className="slider-console w-16 cursor-pointer"
      />
    </label>
  )
}

export function SceneTabs() {
  // Tabs show scene NAMES and main-ness only. Subscribing to the scenes record
  // itself would re-render the tab strip on every track edit anywhere (its
  // identity changes per edit); this string fingerprint re-renders exactly on
  // rename / add / remove / reorder.
  const scenesKey = useProjectStore((s) => s.sceneOrder.map((id) => `${id}:${s.scenes[id]?.name}:${s.scenes[id]?.isMain}`).join('|'))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const scenes = useMemo(() => useProjectStore.getState().scenes, [scenesKey])
  const sceneOrder = useProjectStore((s) => s.sceneOrder)
  const activeSceneId = useProjectStore((s) => s.activeSceneId)
  const setActiveScene = useProjectStore((s) => s.setActiveScene)
  const addScene = useProjectStore((s) => s.addScene)
  const renameScene = useProjectStore((s) => s.renameScene)
  const duplicateScene = useProjectStore((s) => s.duplicateScene)
  const deleteScene = useProjectStore((s) => s.deleteScene)
  const visualCount = sceneOrder.filter((id) => !scenes[id]?.isMain).length
  const pixelsPerBeat = useUIStore((s) => s.tracksPixelsPerBeat)
  const setTracksPixelsPerBeat = useUIStore((s) => s.setTracksPixelsPerBeat)
  const tracksRowHeight = useUIStore((s) => s.tracksRowHeight)
  const setTracksRowHeight = useUIStore((s) => s.setTracksRowHeight)

  // The tab you click is the one you edit. What the canvas shows is the
  // transport strip's VIEW chip, which names the viewed scene itself - so the
  // tabs carry no viewing marker of their own.
  const select = (id: string) => {
    useUIStore.getState().setEditingBlock(null)
    useUIStore.getState().setSelectedTrackId(null)
    useUIStore.getState().setSelectedBlockIds(new Set())
    setActiveScene(id)
  }

  const create = () => {
    const id = addScene()
    select(id)
  }

  // Right-click menu (duplicate / delete), positioned at the cursor.
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null)
  const menuScene = menu ? scenes[menu.id] : null

  return (
    // Slightly translucent (the /85) so the workspace's ambient light passes
    // through the seam between visualizer and timeline instead of stopping at
    // an opaque bar - the strip sits exactly on that boundary.
    <div className="flex h-[64px] flex-shrink-0 items-center gap-8 overflow-x-auto no-scrollbar border-t border-[rgba(255,255,255,0.06)] bg-[var(--bg-app)]/85 px-6 select-none" role="tablist" aria-label="Scenes">
      {sceneOrder.map((id, index) => {
        const scene = scenes[id]
        if (!scene) return null
        const active = id === activeSceneId
        return (
          <button
            key={id}
            role="tab"
            aria-selected={active}
            onClick={() => select(id)}
            onDoubleClick={() => {
              if (scene.isMain) return
              const name = window.prompt('Scene name', scene.name)
              if (name) renameScene(id, name)
            }}
            onContextMenu={(e) => {
              e.preventDefault()
              // Main can't be duplicated or deleted, so it has no menu.
              if (!scene.isMain) setMenu({ x: e.clientX, y: e.clientY, id })
            }}
            title={scene.isMain ? 'The final composition - composes the other scenes into the exported frame' : 'Double-click to rename · Right-click for options'}
            className={`group flex flex-shrink-0 items-baseline gap-2.5 border-b-2 pb-1 cursor-pointer ${
              active ? 'border-[var(--accent)]' : 'border-transparent'
            }`}
          >
            <span className={`font-mono text-[10.5px] leading-none ${active ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'}`}>
              {String(index + 1).padStart(2, '0')}
            </span>
            <span
              className={`max-w-44 truncate text-[22px] italic leading-none [font-family:var(--font-display)] ${
                active
                  ? 'text-[var(--accent)]'
                  : 'text-[rgba(233,237,244,0.32)] group-hover:text-[var(--accent-hover)]'
              }`}
            >
              {scene.name}
            </span>
          </button>
        )
      })}
      <button
        onClick={create}
        title="Add scene"
        className="flex-shrink-0 pb-1 text-[17px] italic leading-none [font-family:var(--font-display)] text-[var(--text-muted)] hover:text-[var(--accent)] cursor-pointer"
      >
        + new scene
      </button>
      <div className="ml-auto flex min-w-0 items-center gap-1">
        {/* Which scene the canvas shows is the eye on the tabs now, not a second
            row of scene names here. Aspect and timeline sizing stay. */}

        {/* Timeline zoom lives here so it never covers track content. The two
            sliders share one pill: they are one control ("how big is the
            timeline"), not two unrelated settings. */}
        <div className="ml-1 flex h-6 flex-shrink-0 items-center gap-2.5 rounded-full bg-white/[0.03] px-2.5 hover:bg-white/[0.06]">
          <ZoomSlider
            icon={<BeatWidthGlyph />}
            label="Horizontal zoom - beat width"
            value={pixelsPerBeat}
            min={2}
            max={100}
            unit="pixels per beat"
            onChange={setTracksPixelsPerBeat}
          />
          <div className="h-3 w-px flex-shrink-0 bg-[var(--border)]" aria-hidden="true" />
          <ZoomSlider
            icon={<RowHeightGlyph />}
            label="Vertical zoom - track height"
            value={tracksRowHeight}
            min={28}
            max={200}
            unit="pixels per row"
            onChange={setTracksRowHeight}
          />
        </div>
      </div>

      {menu && menuScene && (
        <SceneTabMenu
          x={menu.x}
          y={menu.y}
          canDelete={!menuScene.isMain && visualCount > 1}
          onDuplicate={() => {
            const copyId = duplicateScene(menu.id)
            if (copyId) select(copyId)
          }}
          onDelete={() => deleteScene(menu.id)}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  )
}
