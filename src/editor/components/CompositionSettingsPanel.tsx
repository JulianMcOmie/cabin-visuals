import { ArrowDown, ArrowUp, Check } from 'lucide-react'
import { useProjectStore } from '../store/ProjectStore'
import { compositionDef } from '../core/directors'
import { COMPOSITION_OPACITY_PARAM } from '../core/directors/types'
import { orderedSceneBindings } from '../core/directors/sceneBindings'
import { ParamControl } from '../userInterfaceRenderers'
import type { Track } from '../types'

/**
 * Settings for a composition track ON MAIN (the former inline director panel,
 * extracted verbatim): shared opacity + the def's params, then the def-shaped
 * scene surface - a single scene picker for targetsSingleScene (crop), a
 * reorderable scene list for the partition composers (cut / radialCut), or a
 * read-only MIDI-row list. A plain dispatched component like the Envelope and
 * Automation panels, NOT a userInterfaceRenderers entry: its subject is scene
 * bindings, which aren't params.
 *
 * TrackEditor dispatches here only when the active scene isMain - a crop
 * track in a visual scene takes the ordinary object path instead, which is
 * exactly the dual-surface split (compose on Main, mask in a scene).
 */
export function CompositionSettingsPanel({ track }: { track: Track }) {
  const setTrackParam = useProjectStore((s) => s.setTrackParam)
  const setTrackStringParam = useProjectStore((s) => s.setTrackStringParam)
  const setSceneBindings = useProjectStore((s) => s.setSceneBindings)

  const def = compositionDef(track.instrumentId)
  const scenes = useProjectStore.getState().scenes
  const sceneOrder = useProjectStore.getState().sceneOrder
  const rows = def?.midiRows(track, scenes, sceneOrder) ?? []
  const bindings = orderedSceneBindings(track, scenes, sceneOrder)
  const cutCount = Math.min(bindings.length, Math.max(1, Math.round(track.params?.sceneCount ?? 3)))
  const defId = def?.id
  const isPartitionComposer = defId === 'cut' || defId === 'radialCut'
  const partitionLabel = defId === 'radialCut' ? 'Ring' : 'Cut'
  const moveBinding = (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction
    if (nextIndex < 0 || nextIndex >= bindings.length) return
    const ordered = bindings.slice()
    ;[ordered[index], ordered[nextIndex]] = [ordered[nextIndex], ordered[index]]
    setSceneBindings(track.id, ordered)
  }
  return (
    <>
      <p className="mb-3 text-[10px] font-semibold tracking-[0.06em] text-[var(--text-muted)] select-none">DIRECTOR</p>
      <p className="mb-4 text-[11px] leading-relaxed text-[var(--text-2)]">
        {def?.panelSummary
          ?? (def?.targetsSingleScene
            ? `${def?.name ?? 'This director'} renders one scene into Main. Its MIDI rows choose which pieces of that scene are visible.`
            : `${def?.name ?? 'Unknown director'} renders scene sources into Main. Its MIDI rows choose the scene inputs.`)}
      </p>
      <ParamControl
        param={COMPOSITION_OPACITY_PARAM}
        numValue={track.params?.opacity}
        strValue={undefined}
        onNum={(v) => setTrackParam(track.id, 'opacity', v)}
      />
      {(def?.params.length ?? 0) > 0 && def!.params.map((p) => (
        <ParamControl
          key={p.key}
          param={p}
          numValue={track.params?.[p.key]}
          strValue={track.stringParams?.[p.key]}
          onNum={(v) => setTrackParam(track.id, p.key, v)}
          onStr={(v) => setTrackStringParam(track.id, p.key, v)}
        />
      ))}
      {def?.targetsSingleScene && (() => {
        const visualSceneIds = sceneOrder.filter((id) => scenes[id] && !scenes[id].isMain)
        const targetSceneId = bindings[0]?.sceneId
        return (
          <>
            <p className="mb-2 text-[10px] font-semibold tracking-[0.06em] text-[var(--text-muted)] select-none">SCENE</p>
            <div className="space-y-1">
              {visualSceneIds.map((sceneId) => (
                <button
                  key={sceneId}
                  onClick={() => setSceneBindings(track.id, [{ pitch: bindings[0]?.pitch ?? 60, sceneId }])}
                  className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[11px] cursor-pointer ${sceneId === targetSceneId ? 'bg-[var(--bg-elevated)] text-[var(--text)]' : 'text-[var(--text-2)] hover:bg-[var(--bg-elevated)]'}`}
                >
                  <span className="min-w-0 flex-1 truncate">{scenes[sceneId]?.name}</span>
                  {sceneId === targetSceneId && <Check size={11} />}
                </button>
              ))}
            </div>
            {visualSceneIds.length === 0 && (
              <p className="text-[10px] leading-relaxed text-[var(--text-muted)]">No visual scenes yet - add one first.</p>
            )}
            {def?.sceneChoiceNote && (
              <p className="mt-3 mb-4 text-[10px] leading-relaxed text-[var(--text-muted)]">{def.sceneChoiceNote}</p>
            )}
          </>
        )
      })()}
      {isPartitionComposer ? (
        <>
          <p className="mb-2 text-[10px] font-semibold tracking-[0.06em] text-[var(--text-muted)] select-none">SCENE ORDER</p>
          <div className="space-y-1">
            {bindings.map((binding, index) => (
              <div key={binding.sceneId} className={`flex items-center gap-2 rounded bg-[var(--bg-elevated)] px-2 py-1 text-[11px] ${index >= cutCount ? 'opacity-45' : ''}`}>
                <span className="w-10 flex-shrink-0 font-mono text-[10px] text-[var(--text-muted)]">{index < cutCount ? `${partitionLabel} ${index + 1}` : 'Unused'}</span>
                <span className="min-w-0 flex-1 truncate text-[var(--text-2)]">{scenes[binding.sceneId]?.name}</span>
                <span className="font-mono text-[var(--text-muted)]">{binding.pitch}</span>
                <button onClick={() => moveBinding(index, -1)} disabled={index === 0} aria-label={`Move ${scenes[binding.sceneId]?.name} earlier`} className="disabled:opacity-25 hover:text-[var(--text)] cursor-pointer disabled:cursor-default"><ArrowUp size={11} /></button>
                <button onClick={() => moveBinding(index, 1)} disabled={index === bindings.length - 1} aria-label={`Move ${scenes[binding.sceneId]?.name} later`} className="disabled:opacity-25 hover:text-[var(--text)] cursor-pointer disabled:cursor-default"><ArrowDown size={11} /></button>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[10px] leading-relaxed text-[var(--text-muted)]">Each active {partitionLabel.toLowerCase()} has one MIDI row. The scene exists in its partition only while that row&rsquo;s note is held.</p>
        </>
      ) : def?.hideMidiRowsInSettings ? null : (
        <>
          <p className="mb-2 text-[10px] font-semibold tracking-[0.06em] text-[var(--text-muted)] select-none">MIDI ROWS</p>
          <div className="space-y-1">
            {rows.map((row) => (
              <div key={row.pitch} className="flex items-center justify-between rounded bg-[var(--bg-elevated)] px-2 py-1 text-[11px]">
                <span className="text-[var(--text-2)]">{row.label}</span>
                <span className="font-mono text-[var(--text-muted)]">{row.pitch}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  )
}
