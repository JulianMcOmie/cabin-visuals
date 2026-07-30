'use client'

import { useEffect, useRef, useState, type DragEvent as ReactDragEvent } from 'react'
import Link from 'next/link'
import { Image as ImageIcon } from 'lucide-react'
import { CabinLogo } from '../../components/CabinLogo'
import { SiteHeader } from '../../components/SiteHeader'
import { ProfileMenu } from '../../components/ProfileMenu'
import { useProjectStore } from '../store/ProjectStore'
import { photoCapError, photoPadRoom, startPhotoUpload } from '../core/photo/photoUploads'
import { dragCarriesFiles, isPhotoFile } from '../core/mediaFileKinds'
import { usePlan } from '../../billing/usePlan'
import { track } from '../../analytics/analytics'

/**
 * The photo-template intermediate page (Crazy Edit): the sibling of
 * LyricSetupScreen's add-your-song step. The template is built from Photo Slot
 * tracks that show labeled placeholders until they hold pictures - this step
 * lets the user pour a batch of photos into every slot in one go before the
 * editor opens. Strictly optional: the skip door (styled like the lyric
 * page's no-song-handy Borderline line) goes straight to the editor with the
 * placeholders showing.
 *
 * Each file uploads ONCE (one ref) and the ref is shared by every slot
 * track's bank - the slots cut through the same pool at their own counters,
 * exactly like the source template's numbered pictures.
 */

type Phase =
  | { kind: 'pick' }
  | { kind: 'adding'; done: number; total: number }
  | { kind: 'error'; message: string }

/** Progress bar: determinate with a value, indeterminate sweep without. */
function ProgressBar({ value, className = 'w-64' }: { value?: number; className?: string }) {
  return (
    <div className={`relative h-1.5 overflow-hidden rounded-full bg-[var(--bg-elevated)] ${className}`}>
      {value !== undefined ? (
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-[var(--accent)] transition-[width] duration-200"
          style={{ width: `${Math.round(Math.max(0.02, Math.min(1, value)) * 100)}%` }}
        />
      ) : (
        <div className="absolute inset-y-0 w-1/3 rounded-full bg-[var(--accent)] motion-safe:animate-[lyric-progress-sweep_1.2s_ease-in-out_infinite]" />
      )}
    </div>
  )
}

export function PhotoSetupScreen({
  onClose,
  projectLoading,
}: {
  onClose: () => void
  projectLoading: boolean
}) {
  const [phase, setPhase] = useState<Phase>({ kind: 'pick' })
  const fileInputRef = useRef<HTMLInputElement>(null)
  const runningRef = useRef(false)
  const { isPro } = usePlan()

  /** Add the batch: mint one ref per file, append it to EVERY slot bank. */
  const run = async (files: File[]) => {
    if (runningRef.current) return
    runningRef.current = true
    try {
      const s = useProjectStore.getState()
      const slotIds = Object.values(s.tracks)
        .filter((t) => t.instrumentId === 'photoSlot')
        .map((t) => t.id)
      if (slotIds.length === 0) {
        onClose() // not a photo template after all - nothing to fill
        return
      }
      // Free-plan bank cap applies per track; the batch is trimmed as a whole
      // so every slot ends up with the same pool.
      const existing = useProjectStore.getState().tracks[slotIds[0]]?.photoPads?.length ?? 0
      const room = photoPadRoom(existing, isPro)
      const usable = files.slice(0, Math.max(0, room))
      let added = 0
      for (const file of usable) {
        setPhase({ kind: 'adding', done: added, total: usable.length })
        const cap = photoCapError(file)
        if (cap) continue
        const ref = await startPhotoUpload(file) // resolves at mint; upload continues in the editor
        if (!ref) continue
        const store = useProjectStore.getState()
        for (const id of slotIds) {
          const pads = store.tracks[id]?.photoPads ?? []
          store.setTrackPhotoPads(id, [...pads, { ref }])
        }
        added++
      }
      if (added === 0) throw new Error('None of those files could be added - try JPG or PNG photos.')
      track('photo_setup_filled', { photos: added, slots: slotIds.length })
      onClose()
    } catch (err) {
      runningRef.current = false
      setPhase({ kind: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }

  // Photos can arrive before the project document has hydrated - queue them
  // until it lands (the same guard the lyric page uses for early songs).
  const pendingRef = useRef<File[] | null>(null)
  const addPhotos = (files: File[]) => {
    if (files.length === 0) return
    setPhase({ kind: 'adding', done: 0, total: files.length })
    if (projectLoading) pendingRef.current = files
    else void run(files)
  }
  useEffect(() => {
    if (projectLoading || !pendingRef.current) return
    const files = pendingRef.current
    pendingRef.current = null
    void run(files)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectLoading])

  // Drag-over indicator, same look as the lyric page. Depth counter absorbs
  // enter/leave noise from crossing child boundaries.
  const [dragActive, setDragActive] = useState(false)
  const dragDepthRef = useRef(0)
  const isFileDrag = (e: ReactDragEvent) => dragCarriesFiles(e.dataTransfer)

  const onDrop = (e: ReactDragEvent) => {
    e.preventDefault()
    dragDepthRef.current = 0
    setDragActive(false)
    addPhotos(Array.from(e.dataTransfer.files).filter(isPhotoFile))
  }

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
            <ImageIcon size={13} /> drop your photos
          </span>
        </div>
      )}

      <div className="flex flex-1 min-h-0 flex-col items-center justify-center overflow-y-auto px-4 text-center sm:px-6">
        <div className="flex w-full max-w-[460px] flex-col items-center gap-7 rounded-lg border border-[var(--border)] bg-[var(--bg-panel)] px-5 py-8 sm:px-8 sm:py-10">
          <CabinLogo className="h-16 w-auto sm:h-24" />

          {phase.kind === 'pick' ? (
            <>
              <div>
                <h1 className="m-0 text-[22px] font-bold tracking-[-0.02em]">Add your photos</h1>
                <p className="mx-auto mt-2 mb-0 max-w-[380px] text-[13px] leading-relaxed text-[var(--text-3)]">
                  The edit cuts through your pictures - every photo slot in the template fills with what you add here.
                </p>
              </div>
              <div className="flex w-full flex-col items-center gap-2.5 rounded-lg border border-dashed border-[var(--border-strong)] px-6 py-10">
                <ImageIcon size={20} className="text-[var(--text-muted)]" />
                <span className="text-xs text-[var(--text-muted)]">Drop photos anywhere on this page</span>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="mt-1.5 flex h-9 items-center justify-center rounded bg-[var(--accent)] px-5 text-[13px] font-bold text-[var(--on-accent)] transition-colors hover:bg-[var(--accent-hover)] cursor-pointer"
                >
                  Browse files
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,.jpg,.jpeg,.png,.webp,.gif"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    const files = Array.from(e.target.files ?? [])
                    e.target.value = ''
                    addPhotos(files)
                  }}
                />
              </div>
              {/* The optional-step door: same quiet styling as the lyric page's
                  no-song-handy Borderline line. */}
              <button
                onClick={onClose}
                className="-mt-3 text-[12px] text-[var(--text-3)] transition-colors hover:text-[var(--text)] cursor-pointer"
              >
                No photos handy? <span className="font-semibold text-[var(--text-2)]">Skip for now</span> - the slots keep their placeholders
              </button>
              <Link
                href="/projects"
                className="text-[12px] text-[var(--text-muted)] transition-colors hover:text-[var(--text)] cursor-pointer"
              >
                ← Back to projects
              </Link>
            </>
          ) : phase.kind === 'error' ? (
            <>
              <p className="mx-auto m-0 max-w-[380px] text-[13px] leading-relaxed text-[#d68383]">{phase.message}</p>
              <button
                onClick={() => setPhase({ kind: 'pick' })}
                className="flex h-9 items-center justify-center rounded bg-[var(--accent)] px-5 text-[13px] font-bold text-[var(--on-accent)] transition-colors hover:bg-[var(--accent-hover)] cursor-pointer"
              >
                Try again
              </button>
              <button
                onClick={onClose}
                className="mt-5 text-[12px] text-[var(--text-muted)] transition-colors hover:text-[var(--text)] cursor-pointer"
              >
                Open the editor anyway
              </button>
            </>
          ) : (
            <>
              <div>
                <h1 className="m-0 text-[22px] font-bold tracking-[-0.02em]">Filling the slots…</h1>
                <p className="mx-auto mt-2 mb-0 max-w-[380px] text-[13px] leading-relaxed text-[var(--text-3)]">
                  Adding photo {Math.min(phase.done + 1, phase.total)} of {phase.total} - uploads finish in the background.
                </p>
              </div>
              <ProgressBar
                value={phase.total > 0 ? phase.done / phase.total : undefined}
                className="w-full max-w-[280px]"
              />
            </>
          )}
        </div>
      </div>
    </div>
  )
}
