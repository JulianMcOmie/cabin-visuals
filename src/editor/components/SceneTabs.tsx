'use client'

import { Plus, X } from 'lucide-react'
import { useProjectStore } from '../store/ProjectStore'
import { useUIStore } from '../store/UIStore'

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

  return (
    <div className="h-8 flex flex-shrink-0 items-end gap-0 border-y border-[var(--border)] bg-[var(--bg-panel)] px-2 select-none">
      {sceneOrder.map((id) => {
        const scene = scenes[id]
        if (!scene) return null
        const active = id === activeSceneId
        return (
          <div key={id} className={`group relative flex h-7 items-center border-x border-t ${active ? 'border-[var(--border-strong)] bg-[var(--bg-panel-raised)] text-[var(--text)]' : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-3)]'}`}>
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
                if (e.shiftKey) {
                  if (visualCount > 1 && window.confirm(`Delete ${scene.name}?`)) deleteScene(id)
                } else {
                  const copyId = duplicateScene(id)
                  if (copyId) select(copyId)
                }
              }}
              title={scene.isMain ? 'Final director composition' : 'Double-click to rename · Right-click to duplicate · Shift-right-click to delete'}
              className="h-full px-3 text-[11px] font-medium cursor-pointer"
            >
              {scene.name}
            </button>
            {!scene.isMain && visualCount > 1 && active && (
              <button
                onClick={() => deleteScene(id)}
                title={`Delete ${scene.name}`}
                className="mr-1 rounded p-0.5 text-[var(--text-muted)] hover:text-[var(--warn)] cursor-pointer"
              >
                <X size={10} />
              </button>
            )}
            {active && <div className="absolute inset-x-0 bottom-0 h-0.5 bg-[var(--accent)]" />}
          </div>
        )
      })}
      <button onClick={create} title="Add scene" className="mb-1 ml-1 flex h-6 w-6 items-center justify-center rounded text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text)] cursor-pointer">
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
    </div>
  )
}
