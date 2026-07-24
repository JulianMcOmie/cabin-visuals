'use client'

import { useEffect, useState } from 'react'
import { Plus, Copy, Trash2 } from 'lucide-react'
import { useProjectStore } from '../store/ProjectStore'
import { useUIStore } from '../store/UIStore'

/** Flat right-click menu for a scene tab: duplicate or delete. Styled like the
 *  shared NestedMenu shell (backdrop-to-close, Esc, stands down editor surfaces). */
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

export function SceneTabs() {
  const scenes = useProjectStore((s) => s.scenes)
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
    <div className="h-8 flex flex-shrink-0 items-stretch gap-0 border-y border-[var(--border)] bg-[var(--bg-panel)] select-none">
      {sceneOrder.map((id) => {
        const scene = scenes[id]
        if (!scene) return null
        const active = id === activeSceneId
        return (
          <div key={id} className={`group relative flex w-24 flex-shrink-0 items-stretch border-r border-[var(--border-subtle)] transition-colors ${
            active
              ? 'bg-[var(--bg-app)] text-[var(--text)] font-semibold shadow-[inset_0_-2px_0_var(--accent)]'
              : 'bg-transparent text-[var(--text-muted)] font-medium hover:text-[var(--text-2)]'
          }`}>
            <button
              onClick={() => select(id)}
              onDoubleClick={() => {
                if (scene.isMain) return
                const name = window.prompt('Scene name', scene.name)
                if (name) renameScene(id, name)
              }}
              onContextMenu={(e) => {
                if (scene.isMain) return
                e.preventDefault()
                setMenu({ x: e.clientX, y: e.clientY, id })
              }}
              title={scene.isMain ? 'Final director composition' : 'Double-click to rename · Right-click for options'}
              className="flex-1 min-w-0 h-full px-3 text-[11px] text-center truncate cursor-pointer"
            >
              {scene.name}
            </button>
          </div>
        )
      })}
      <button onClick={create} title="Add scene" className="ml-1 flex h-6 w-6 items-center justify-center self-center rounded text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text)] cursor-pointer">
        <Plus size={13} />
      </button>
      {/* Timeline zoom sliders - live here (not floated over the lanes) so they
          never cover track content. They drive the tracks view's zoom state. */}
      <div className="ml-auto flex items-center gap-2.5 self-center pr-1">
        <div className="flex items-center gap-1.5" title="Horizontal zoom">
          <span className="text-[10px] text-zinc-600">H</span>
          <input
            type="range"
            min={2}
            max={100}
            value={pixelsPerBeat}
            onChange={(e) => setTracksPixelsPerBeat(Number(e.target.value))}
            className="slider-square w-14 cursor-pointer"
          />
        </div>
        <div className="flex items-center gap-1.5" title="Vertical zoom">
          <span className="text-[10px] text-zinc-600">V</span>
          <input
            type="range"
            min={28}
            max={200}
            value={tracksRowHeight}
            onChange={(e) => setTracksRowHeight(Number(e.target.value))}
            className="slider-square w-14 cursor-pointer"
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
