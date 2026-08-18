'use client'

import { useEffect, useRef, useState, type DragEvent as ReactDragEvent } from 'react'
import { InstantLink as Link } from '../../components/instantNavigation'
import { Check, FileMusic, Music } from 'lucide-react'
import { CabinLogo } from '../../components/CabinLogo'
import { SiteHeader } from '../../components/SiteHeader'
import { ProfileMenu } from '../../components/ProfileMenu'
import { useProjectStore } from '../store/ProjectStore'
import { parseMidiFile } from '../core/midiImport'
import { dragCarriesFiles, mediaKindOfFile } from '../core/mediaFileKinds'
import { loadAudioTrack } from '../utils/loadAudioTrack'
import { track } from '../../analytics/analytics'

/**
 * The Midi Roll template's intermediate page: the sibling of LyricSetupScreen's
 * add-your-song step and PhotoSetupScreen's add-your-photos step. The template
 * ships a styled 'Midi Roll' track playing a placeholder pattern - this step
 * lets the user drop the MIDI file the video is FOR (the notes land on that
 * track via refillMidiRollTrack, styling kept) plus the song it plays, before
 * the editor opens. Strictly optional: the skip door goes straight to the
 * editor with the demo pattern still rolling.
 */

export function MidiSetupScreen({
  onClose,
  projectLoading,
}: {
  onClose: () => void
  projectLoading: boolean
}) {
  const [midiName, setMidiName] = useState<string | null>(null)
  const [songName, setSongName] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  /** Route a dropped batch: MIDI restyles onto the template's roll track,
   *  audio lands through the one shared load pipeline. Anything else is
   *  ignored - this page only has the two slots. */
  const run = async (files: File[]) => {
    setError(null)
    let sawUsable = false
    for (const file of files) {
      const kind = mediaKindOfFile(file)
      if (kind === 'midi') {
        try {
          const imported = parseMidiFile(await file.arrayBuffer())
          const s = useProjectStore.getState()
          // The refill contract: the template's styled 'Midi Roll' track takes
          // the notes. A missing track (renamed, deleted) falls back to a
          // plain import so the file is never silently dropped.
          const id = s.refillMidiRollTrack(imported) ?? s.importMidiTracks(imported)[0] ?? null
          if (!id) throw new Error('That MIDI file has no notes in it.')
          setMidiName(file.name)
          track('midi_setup_midi_added', { tracks: imported.length })
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err))
        }
        sawUsable = true
      } else if (kind === 'audio') {
        // Fire-and-forget like the editor's own drops: the track lands
        // immediately, decode + upload trail behind into the editor.
        void loadAudioTrack(file).catch((err) => {
          setError(err instanceof Error ? err.message : String(err))
          setSongName(null)
        })
        setSongName(file.name)
        track('midi_setup_song_added', {})
        sawUsable = true
      }
    }
    if (!sawUsable && files.length > 0) {
      setError('Drop a MIDI file (.mid) or an audio file - other files have no slot here.')
    }
  }

  // Files can arrive before the project document has hydrated - queue them
  // until it lands (the same guard the lyric and photo pages use).
  const pendingRef = useRef<File[]>([])
  const addFiles = (files: File[]) => {
    if (files.length === 0) return
    if (projectLoading) pendingRef.current = [...pendingRef.current, ...files]
    else void run(files)
  }
  useEffect(() => {
    if (projectLoading || pendingRef.current.length === 0) return
    const files = pendingRef.current
    pendingRef.current = []
    void run(files)
  }, [projectLoading])

  // Drag-over indicator, same look as the sibling pages. Depth counter absorbs
  // enter/leave noise from crossing child boundaries.
  const [dragActive, setDragActive] = useState(false)
  const dragDepthRef = useRef(0)
  const isFileDrag = (e: ReactDragEvent) => dragCarriesFiles(e.dataTransfer)

  const onDrop = (e: ReactDragEvent) => {
    e.preventDefault()
    dragDepthRef.current = 0
    setDragActive(false)
    addFiles(Array.from(e.dataTransfer.files))
  }

  /** One slot row: what it wants, and whether it is filled. */
  const Slot = ({ icon, label, hint, fileName }: { icon: React.ReactNode; label: string; hint: string; fileName: string | null }) => (
    <div className="flex w-full items-center gap-3 rounded border border-[var(--border)] bg-[var(--bg-elevated)] px-4 py-3 text-left">
      <span className={fileName ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'}>
        {fileName ? <Check size={16} /> : icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold">{label}</div>
        <div className="truncate text-[11px] text-[var(--text-muted)]">{fileName ?? hint}</div>
      </div>
    </div>
  )

  return (
    <div
      className="relative flex h-screen w-screen flex-col bg-[var(--bg-page)] text-[var(--text)]"
      onDragEnter={(e) => {
        if (!isFileDrag(e)) return
        e.preventDefault()
        dragDepthRef.current++
        setDragActive(true)
      }}
      onDragOver={(e) => {
        if (!isFileDrag(e)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
      }}
      onDragLeave={(e) => {
        if (!isFileDrag(e)) return
        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
        if (dragDepthRef.current === 0) setDragActive(false)
      }}
      onDrop={onDrop}
    >
      <SiteHeader>
        <Link href="/projects" className="px-3 text-[13px] text-[var(--text-3)] transition-colors hover:text-[var(--text)] cursor-pointer">
          Projects
        </Link>
        <ProfileMenu />
      </SiteHeader>

      {dragActive && (
        <div className="pointer-events-none absolute inset-2 z-30 flex items-center justify-center rounded border border-dashed border-[var(--accent)] bg-[var(--accent)]/10">
          <span className="flex items-center gap-1.5 rounded bg-[var(--bg-panel)]/85 px-3 py-1.5 font-mono text-[11px] text-[var(--accent)]">
            <FileMusic size={13} /> drop your MIDI or song
          </span>
        </div>
      )}

      <div className="flex flex-1 min-h-0 flex-col items-center justify-center overflow-y-auto px-4 text-center sm:px-6">
        <div className="flex w-full max-w-[460px] flex-col items-center gap-7 rounded-lg border border-[var(--border)] bg-[var(--bg-panel)] px-5 py-8 sm:px-8 sm:py-10">
          <CabinLogo className="h-16 w-auto sm:h-24" />

          <div>
            <h1 className="m-0 text-[22px] font-bold tracking-[-0.02em]">Add your MIDI and song</h1>
            <p className="mx-auto mt-2 mb-0 max-w-[380px] text-[13px] leading-relaxed text-[var(--text-3)]">
              Your MIDI notes become the roll - drop the .mid file the music was made from, and the song itself to play under it.
            </p>
          </div>

          <div className="flex w-full flex-col items-center gap-2.5 rounded-lg border border-dashed border-[var(--border-strong)] px-6 py-6">
            <Slot
              icon={<FileMusic size={16} />}
              label="MIDI file"
              hint="Replaces the demo pattern on the roll"
              fileName={midiName}
            />
            <Slot
              icon={<Music size={16} />}
              label="Song (optional)"
              hint="The audio the MIDI plays along with"
              fileName={songName}
            />
            <span className="mt-1 text-xs text-[var(--text-muted)]">Drop files anywhere on this page</span>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="mt-0.5 flex h-9 items-center justify-center rounded bg-[var(--accent)] px-5 text-[13px] font-bold text-[var(--on-accent)] transition-colors hover:bg-[var(--accent-hover)] cursor-pointer"
            >
              Browse files
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*,audio/midi,.mid,.midi"
              multiple
              className="hidden"
              onChange={(e) => {
                const files = Array.from(e.target.files ?? [])
                e.target.value = ''
                addFiles(files)
              }}
            />
            {error && <p className="m-0 max-w-[340px] text-[12px] leading-relaxed text-[#d68383]">{error}</p>}
          </div>

          {midiName || songName ? (
            <button
              onClick={onClose}
              className="-mt-3 flex h-9 items-center justify-center rounded bg-[var(--accent)] px-5 text-[13px] font-bold text-[var(--on-accent)] transition-colors hover:bg-[var(--accent-hover)] cursor-pointer"
            >
              Open the editor →
            </button>
          ) : (
            /* The optional-step door: same quiet styling as the sibling pages. */
            <button
              onClick={onClose}
              className="-mt-3 text-[12px] text-[var(--text-3)] transition-colors hover:text-[var(--text)] cursor-pointer"
            >
              No files handy? <span className="font-semibold text-[var(--text-2)]">Skip for now</span> - the roll keeps its demo pattern
            </button>
          )}
          <Link
            href="/projects"
            className="text-[12px] text-[var(--text-muted)] transition-colors hover:text-[var(--text)] cursor-pointer"
          >
            ← Back to projects
          </Link>
        </div>
      </div>
    </div>
  )
}
