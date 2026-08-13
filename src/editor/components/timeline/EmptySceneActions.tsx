'use client'

import { useRef } from 'react'
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
 */

type Action = {
  key: string
  label: string
  icon: typeof Plus
  run: () => void
}

export function EmptySceneActions({
  labelWidth,
  isMain,
  onAddTrack,
}: {
  /** Left inset of the lane region: the cluster centers over the lanes, not
   *  over the whole timeline, so the frozen label column doesn't drag it off
   *  the work surface. */
  labelWidth: number
  /** Main composes the other scenes, so its first track is a Scene Switcher
   *  rather than an object - the row says what it will actually add. */
  isMain: boolean
  onAddTrack: () => void
}) {
  const requestLibraryTab = useUIStore((s) => s.requestLibraryTab)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const pendingKindRef = useRef<'midi' | 'audio'>('midi')

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
      label: isMain ? 'Add a scene switcher' : 'Add a track',
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
      <div className="pointer-events-auto flex flex-col items-start gap-3 pl-4">
        <p className="text-[15px] font-semibold tracking-[-0.01em] text-[var(--text)]">
          Let&apos;s start composing
        </p>
        <div className="flex flex-col gap-px">
          {actions.map(({ key, label, icon: Icon, run }, i) => (
            <button
              key={key}
              type="button"
              onClick={run}
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
}
