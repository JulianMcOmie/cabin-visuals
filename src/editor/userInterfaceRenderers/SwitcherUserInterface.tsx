'use client'

// The switcher rack's console. Its subject is a DECISION - which devices the
// lane is allowed to run - so the panel is one segmented control, a sentence
// saying what that choice means, and the rows it applies to.
//
// Two things here are deliberate. The mode's description is rendered rather
// than left to the option labels, because "Toggle" and "Latch" are not
// self-explanatory and one of them carries a real hazard the user should meet
// before they hit it, not after (see SWITCHER_MODE_HINTS). And the copy CEILING
// is stated rather than hidden: a Gate rack of splitters mounts the product of
// their fan-outs, which is the number that explains why a rack got slow, and
// the engine already knows it.
//
// Its accent is the TRACK's own colour, not an identityColors constant - the
// same call WordFormationUserInterface makes, and for the same reason: a rack is
// told apart by which one you play, not by a definition it names.

import { useMemo } from 'react'
import { useProjectStore } from '../store/ProjectStore'
import { switcherChildTracks, switcherCopyCeiling } from '../core/visual/resolve'
import { orderedSwitcherBindings } from '../core/switcherBindings'
import {
  SWITCHER_MODE_HINTS,
  SWITCHER_MODE_PARAM,
  switcherExclusive,
} from '../core/visualCopies/switcher'
import { resolveTrackDisplayColor } from '../utils/trackDisplayColor'
import { Console } from './console/Console'
import { Segmented } from './console/Segmented'

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const noteName = (pitch: number) => `${NOTE_NAMES[pitch % 12]}${Math.floor(pitch / 12) - 1}`

export function SwitcherUserInterface({ trackId }: { trackId: string }) {
  const track = useProjectStore((s) => s.tracks[trackId])
  const setTrackParam = useProjectStore((s) => s.setTrackParam)
  // A string fingerprint keeps this off the whole-`tracks` subscription the
  // render budget forbids in an always-mounted component; the panel is not one,
  // but the rule is cheap to keep and the memo needs a stable key anyway.
  const fingerprint = useProjectStore((s) =>
    (s.tracks[trackId]?.childIds ?? [])
      .map((cid) => `${cid}:${s.tracks[cid]?.name ?? ''}:${s.tracks[cid]?.muted ? 'm' : ''}`)
      .join('|'))
  const mode = Math.round(track?.params?.[SWITCHER_MODE_PARAM.key] ?? SWITCHER_MODE_PARAM.default)

  const rack = useMemo(() => {
    const project = useProjectStore.getState()
    const t = project.tracks[trackId]
    if (!t) return { rows: [] as { id: string; name: string; color: string; pitch: number; muted: boolean }[], ceiling: 1 }
    const children = switcherChildTracks(t, project)
    const pitchByChild = new Map(
      orderedSwitcherBindings(t, children.map((c) => c.id)).map((b) => [b.childTrackId, b.pitch]),
    )
    return {
      rows: children.map((child) => ({
        id: child.id,
        name: child.name,
        color: resolveTrackDisplayColor(child),
        pitch: pitchByChild.get(child.id) ?? 0,
        muted: child.muted,
      })),
      ceiling: switcherCopyCeiling(t, project),
    }
    // Both deps are real inputs the linter cannot see, because the body reads
    // the document through getState() rather than through props: `fingerprint`
    // is what changes when the rack's devices do, and the ceiling depends on
    // `mode` (an exclusive rack reaches only its largest device, not the
    // product).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackId, fingerprint, mode])

  if (!track) return null
  const accent = resolveTrackDisplayColor(track)

  return (
    <Console accent={accent}>
      <div className="px-4 pb-4 pt-3">
        <Segmented
          options={SWITCHER_MODE_PARAM.options}
          value={mode}
          onChange={(v) => setTrackParam(trackId, SWITCHER_MODE_PARAM.key, v)}
          name="Mode"
          testId="switcher-mode"
        />
        <p className="mt-2 text-[11px] leading-[1.45] text-zinc-500">
          {SWITCHER_MODE_HINTS[mode]}
        </p>

        {rack.rows.length === 0 ? (
          <p className="mt-4 text-[11px] leading-[1.45] text-zinc-500">
            Drag anything into this rack — instruments, groups, movers, splitters,
            colorizers — or add a device from its right-click menu. Each becomes a
            row of the lane.
          </p>
        ) : (
          <>
            <div className="mt-4 flex flex-col gap-[3px]">
              {rack.rows.map((row) => (
                <div
                  key={row.id}
                  className="flex items-center gap-2 rounded-[5px] border border-white/[0.06] bg-black/25 px-2 py-[5px]"
                >
                  <span
                    className="h-[9px] w-[9px] flex-none rounded-[2px]"
                    style={{ background: row.color, opacity: row.muted ? 0.3 : 1 }}
                  />
                  <span className={`truncate text-[12px] ${row.muted ? 'text-white/30' : 'text-white/75'}`}>
                    {row.name}
                  </span>
                  <span className="ml-auto flex-none font-mono text-[10px] text-white/30">
                    {row.muted ? 'muted' : noteName(row.pitch)}
                  </span>
                </div>
              ))}
            </div>
            <p className="mt-3 text-[11px] leading-[1.45] text-zinc-500">
              {switcherExclusive(mode)
                ? `One device at a time, so this rack mounts up to ${rack.ceiling} ${rack.ceiling === 1 ? 'copy' : 'copies'} — its largest.`
                : `Every device can run at once, so this rack mounts up to ${rack.ceiling} ${rack.ceiling === 1 ? 'copy' : 'copies'}.`}
            </p>
            <p className="mt-1 text-[11px] leading-[1.45] text-zinc-600">
              An empty lane runs everything: wrapping devices in a rack changes nothing
              until you play it.
            </p>
          </>
        )}
      </div>
    </Console>
  )
}
