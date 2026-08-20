'use client'

import { memo, useEffect, useRef, useState, type CSSProperties } from 'react'
import { AudioLines, LayoutTemplate, Music4, Plus } from 'lucide-react'
import { useUIStore } from '../../store/UIStore'
import { PLAYHEAD_TRIANGLE_HALF } from '../../constants'
import { importMidiFiles, showMediaNotice } from '../MediaFileDropLayer'
import { loadAudioTrack } from '../../utils/loadAudioTrack'

/**
 * What an empty scene says instead of nothing.
 *
 * The state it replaced was one sentence - "No tracks yet. Click + to add a
 * track, then right-click a lane to draw blocks." - which narrated a button
 * already on screen and then taught a gesture the user could not yet perform
 * (there is no lane to right-click until a track exists). Both problems are
 * structural, so the fix is too: every line here is a BUTTON that does the
 * thing it names, and the blocks lesson moves out entirely - it belongs to the
 * empty TRACK, not the empty scene.
 *
 * The rows are the four real ways into a scene, not just the mechanical one.
 * Three of them (MIDI, audio, templates) already worked and were never
 * mentioned, which is why an empty timeline read as a dead end.
 *
 * Design lab: the option set and the headline candidates were mocked as
 * artifacts first (Notion's every-line-is-a-button list, Linear's ranked
 * primary). Shipped shape: parked at the top of the lane region by bar 1,
 * first row promoted, no keyboard chips - nothing binds an add-track key
 * today and a chip that lies is worse than no chip. If one is ever bound,
 * the row has room for it.
 *
 * Motion (the `.empty-scene-*` rules in globals.css): each row drifts in from
 * the left on its own beat, 105ms apart. The exit is why this component owns
 * its own presence instead of being a plain `&&` in TimelineArea - the moment
 * a track lands, `empty` goes false, and a conditional render would rip the
 * cluster out with no chance to fade. It stays mounted for EXIT_MS and then
 * unmounts itself.
 *
 * Deliberately NOT framer-motion/AnimatePresence, which the project has: its
 * animations never complete when the tab is hidden (no rAF), so AnimatePresence
 * holds the exiting child mounted FOREVER there - a documented past bug, see
 * components/CLAUDE.md. A timeout fires either way, so this always unmounts.
 */

/** Must match the `.empty-scene-exit` animation duration in globals.css. */
const EXIT_MS = 200

type Action = {
  key: string
  label: string
  icon: typeof Plus
  run: () => void
}

export const EmptySceneActions = memo(function EmptySceneActions({
  empty,
  labelWidth,
  isMain,
  onAddTrack,
}: {
  /** Whether the scene has no tracks. Owned by the caller, but this component
   *  outlives a false to play its exit - see EXIT_MS above. */
  empty: boolean
  /** Left inset of the lane region: the cluster sits at the top-left of the
   *  lanes, not over the frozen label column. */
  labelWidth: number
  /** Main composes the other scenes, so its first track is a Scene composition
   *  instrument rather than an object - the row says what it will actually do,
   *  which is put a scene on screen. */
  isMain: boolean
  onAddTrack: () => void
}) {
  const requestLibraryTab = useUIStore((s) => s.requestLibraryTab)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const pendingKindRef = useRef<'midi' | 'audio'>('midi')

  // Presence lags `empty` by the exit animation. Mounting straight into
  // `empty` (rather than an effect) means the entrance plays on the first
  // paint, with no frame of fully-opaque list before the animation starts.
  const [present, setPresent] = useState(empty)
  useEffect(() => {
    if (empty) {
      setPresent(true)
      return
    }
    const timer = setTimeout(() => setPresent(false), EXIT_MS)
    return () => clearTimeout(timer)
  }, [empty])

  // One input, re-pointed per use: `accept` is set immediately before the
  // click so the OS dialog filters to the kind that was asked for.
  function pickFiles(kind: 'midi' | 'audio') {
    const input = fileInputRef.current
    if (!input) return
    pendingKindRef.current = kind
    input.accept = kind === 'midi' ? '.mid,.midi' : 'audio/*,.wav,.mp3,.aif,.aiff,.m4a,.flac,.ogg,.opus'
    input.value = ''
    input.click()
  }

  function onFilesChosen(files: File[]) {
    if (files.length === 0) return
    if (pendingKindRef.current === 'midi') {
      // Same pipeline as an OS drop: parse → importMidiTracks → select.
      importMidiFiles(files)
      return
    }
    void (async () => {
      for (const file of files) {
        try {
          await loadAudioTrack(file)
        } catch (err) {
          console.error('Failed to load chosen audio file', file.name, err)
          showMediaNotice(`Couldn't load ${file.name}`)
        }
      }
    })()
  }

  const actions: Action[] = [
    {
      key: 'track',
      label: isMain ? 'Add a scene' : 'Add a track',
      icon: Plus,
      run: onAddTrack,
    },
    { key: 'midi', label: 'Import a MIDI file', icon: Music4, run: () => pickFiles('midi') },
    { key: 'audio', label: 'Load audio', icon: AudioLines, run: () => pickFiles('audio') },
    {
      key: 'template',
      label: 'Start from a template',
      icon: LayoutTemplate,
      run: () => requestLibraryTab('templates'),
    },
  ]

  // Fully gone: `empty` went false and the exit has played out.
  if (!present) return null

  return (
    // Parked at the top-left of the lane region - where bar 1 begins and where
    // the first track will land - rather than centered in the void. The list
    // reads as the start of the arrangement instead of a floating dialog.
    //
    // Anchored to the lane's left EDGE, not to musical bar 1: this is a
    // viewport-space overlay, so it deliberately doesn't chase horizontal
    // scroll or the audio pickup (an empty scene can still sit beside
    // project-level audio that leads bar 0). It marks where you start, not a
    // position on the timeline.
    //
    // The wrapper stays pointer-transparent so scrubbing and loop drags still
    // reach the lanes everywhere the cluster isn't; only the cluster itself
    // takes the pointer.
    <div
      className="pointer-events-none absolute inset-y-0 right-0 z-20 flex items-start justify-start pt-5"
      style={{ left: labelWidth + PLAYHEAD_TRIANGLE_HALF }}
    >
      {/* The headline and every row are DIRECT children of the animated
          element, so one `> *` rule staggers all five - hence `mb` on the
          headline instead of nesting the rows in their own gap-3 wrapper.
          `--i` is the child's place in the waterfall. */}
      <div
        className={`pointer-events-auto flex flex-col items-start gap-px pl-4 ${
          empty ? 'empty-scene-enter' : 'empty-scene-exit'
        }`}
      >
        <p
          className="mb-[11px] text-[15px] font-semibold tracking-[-0.01em] text-[var(--text)]"
          style={{ '--i': 0 } as CSSProperties}
        >
          Let&apos;s start composing
        </p>
        {actions.map(({ key, label, icon: Icon, run }, i) => (
          <button
            key={key}
            type="button"
            onClick={run}
            style={{ '--i': i + 1 } as CSSProperties}
            className={`group flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[13.5px] transition-colors cursor-pointer ${
              i === 0
                ? 'bg-[var(--accent)]/[0.07] font-medium text-[var(--text)] hover:bg-[var(--accent)]/[0.15]'
                : 'text-[var(--text-3)] hover:bg-[rgba(233,237,244,0.055)] hover:text-[var(--text)]'
            }`}
          >
            <Icon
              size={15}
              className={`flex-shrink-0 transition-colors ${
                i === 0 ? 'text-[var(--accent)]' : 'text-[var(--text-muted)] group-hover:text-[var(--accent)]'
              }`}
            />
            <span className="whitespace-nowrap">{label}</span>
          </button>
        ))}
      </div>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          onFilesChosen(Array.from(e.target.files ?? []))
          e.target.value = ''
        }}
      />
    </div>
  )
})
