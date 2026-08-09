'use client'

import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { Plus, Copy, Trash2, Eye, UnfoldHorizontal, UnfoldVertical } from 'lucide-react'
import { useProjectStore } from '../store/ProjectStore'
import { useUIStore } from '../store/UIStore'

/** Flat right-click menu for a scene tab: view it on the canvas, duplicate, or
 *  delete. Styled like the shared NestedMenu shell (backdrop-to-close, Esc,
 *  stands down editor surfaces). */
function SceneTabMenu({ x, y, isViewed, canDuplicate, canDelete, onView, onDuplicate, onDelete, onClose }: {
  x: number
  y: number
  /** This scene is already the one on the canvas - the item stays as a marker. */
  isViewed: boolean
  /** Main cannot be duplicated or deleted; its menu is the view item alone. */
  canDuplicate: boolean
  canDelete: boolean
  onView: () => void
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
          onClick={() => { if (!isViewed) onView(); onClose() }}
          disabled={isViewed}
          className={`w-full flex items-center gap-2 px-3 py-1.5 text-left ${
            isViewed ? 'text-zinc-400 cursor-default' : 'text-zinc-200 hover:bg-zinc-700/60 cursor-pointer'
          }`}
        >
          <Eye size={12} /> {isViewed ? 'Viewing this scene' : 'View this scene'}
        </button>
        {(canDuplicate || canDelete) && <div className="my-1 h-px bg-zinc-700" aria-hidden="true" />}
        {canDuplicate && (
          <button
            onClick={() => { onDuplicate(); onClose() }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-zinc-200 hover:bg-zinc-700/60 cursor-pointer"
          >
            <Copy size={12} /> Duplicate
          </button>
        )}
        {canDuplicate && (
          <button
            onClick={() => { if (canDelete) { onDelete(); onClose() } }}
            disabled={!canDelete}
            className={`w-full flex items-center gap-2 px-3 py-1.5 text-left ${canDelete ? 'text-red-400 hover:bg-red-500/15 cursor-pointer' : 'text-red-400/40 cursor-default'}`}
          >
            <Trash2 size={12} /> Delete
          </button>
        )}
      </div>
    </>
  )
}

// Track positions per slider. Fine enough that a drag feels continuous, coarse
// enough that one arrow key is a visible step.
const ZOOM_POSITIONS = 240

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
      <span className="flex-shrink-0 text-[var(--text-muted)] transition-colors group-hover/zoom:text-[var(--text-3)]">
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

interface SceneTabsProps {
  previewSceneId: string
  onPreviewSceneChange: (sceneId: string) => void
}

export function SceneTabs({ previewSceneId, onPreviewSceneChange }: SceneTabsProps) {
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

  // Editing a scene and watching a scene are separate choices now: the tab you
  // click is the one you edit, and the eye stays wherever you put it (Main
  // until you move it). Nothing follows anything.
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

  // Right-click menu (view / duplicate / delete), positioned at the cursor.
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null)
  const menuScene = menu ? scenes[menu.id] : null

  return (
    // Slightly translucent (the /85) so the workspace's ambient light passes
    // through the seam between visualizer and timeline instead of stopping at
    // an opaque bar - the strip sits exactly on that boundary.
    <div className="h-8 flex flex-shrink-0 items-center gap-1 border-y border-[rgba(255,255,255,0.06)] bg-[var(--bg-app)]/85 px-2 select-none">
      {sceneOrder.map((id) => {
        const scene = scenes[id]
        if (!scene) return null
        const active = id === activeSceneId
        const viewed = id === previewSceneId
        return (
          <div key={id} className="relative flex flex-shrink-0">
            <button
              onClick={() => select(id)}
              onDoubleClick={() => {
                if (scene.isMain) return
                const name = window.prompt('Scene name', scene.name)
                if (name) renameScene(id, name)
              }}
              onContextMenu={(e) => {
                e.preventDefault()
                setMenu({ x: e.clientX, y: e.clientY, id })
              }}
              title={`${scene.isMain ? 'Final director composition' : 'Double-click to rename'} · Right-click for options${
                viewed ? ' · shown on the canvas' : ''
              }`}
              className={`flex h-6 min-w-14 max-w-36 items-center gap-1.5 rounded-full px-3 text-[11px] transition-colors cursor-pointer ${
                active
                  ? 'bg-[var(--bg-elevated)] text-[var(--text)] font-semibold'
                  : 'bg-transparent text-[var(--text-muted)] font-medium hover:bg-white/[0.05] hover:text-[var(--text-2)]'
              }`}
            >
              {/* The eye marks the scene the canvas is showing, which is not
                  necessarily the one being edited. */}
              {viewed && <Eye size={11} className="flex-shrink-0 text-[var(--text-2)]" aria-label="Shown on the canvas" />}
              <span className="truncate">{scene.name}</span>
            </button>
          </div>
        )
      })}
      <button onClick={create} title="Add scene" className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-[var(--text-muted)] transition-colors hover:bg-white/[0.06] hover:text-[var(--text)] cursor-pointer">
        <Plus size={13} />
      </button>
      <div className="ml-auto flex min-w-0 items-center gap-1">
        {/* Which scene the canvas shows is the eye on the tabs now, not a second
            row of scene names here. Aspect and timeline sizing stay. */}

        {/* Timeline zoom lives here so it never covers track content. The two
            sliders share one pill: they are one control ("how big is the
            timeline"), not two unrelated settings. */}
        <div className="ml-1 flex h-6 flex-shrink-0 items-center gap-2.5 rounded-full bg-white/[0.03] px-2.5 transition-colors hover:bg-white/[0.06]">
          <ZoomSlider
            icon={<UnfoldHorizontal size={11} strokeWidth={2} />}
            label="Horizontal zoom - beat width"
            value={pixelsPerBeat}
            min={2}
            max={100}
            unit="pixels per beat"
            onChange={setTracksPixelsPerBeat}
          />
          <div className="h-3 w-px flex-shrink-0 bg-[var(--border)]" aria-hidden="true" />
          <ZoomSlider
            icon={<UnfoldVertical size={11} strokeWidth={2} />}
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
          isViewed={menu.id === previewSceneId}
          canDuplicate={!menuScene.isMain}
          canDelete={!menuScene.isMain && visualCount > 1}
          onView={() => onPreviewSceneChange(menu.id)}
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
