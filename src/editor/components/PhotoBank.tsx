'use client'

import { useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Image as ImageIcon, Plus, X } from 'lucide-react'
import { useProjectStore } from '../store/ProjectStore'
import { usePhotoStore } from '../store/PhotoStore'
import { getPhotoPlayableUrl } from '../core/photo/photoSource'
import {
  PHOTO_FREE_MAX_PADS,
  addPhotosToTrack,
  cleanOrphanPhoto,
  photoPadRoom,
  retryPhotoUploadTracked,
} from '../core/photo/photoUploads'
import { usePlan } from '../../billing/usePlan'
import type { Track } from '../types'

// The Photo instrument's bank: a straight multi-upload list. No moment picker -
// a still image has no timeline, so a photo is simply appended. Each row shows a
// small thumbnail, the filename, reorder up/down, and remove; the upload button
// and a drop zone both just append (single and multi files alike). Each photo is
// one row in the MIDI editor. The simplified sibling of VideoClipBank.

/** Cap an in-flight upload's shown progress at 99%: the last bytes and the
 *  server round-trip are unpredictable, so 100% would sit there looking stuck.
 *  A finished upload drops out of the registry, so the badge vanishes at 99. */
function savingPercent(progress: number): number {
  return Math.min(99, Math.round(progress * 100))
}

/** A tiny thumbnail over the photo's playable URL (object URL for session bytes,
 *  signed URL for hydrated). Resolves per ref; revokes nothing (object URLs are
 *  owned by photoSource, signed URLs are fire-and-forget). */
function PhotoThumb({ refId }: { refId: string }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    void getPhotoPlayableUrl(refId)
      .then((u) => {
        if (!cancelled) setUrl(u)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [refId])
  return (
    <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center overflow-hidden rounded bg-[var(--bg-elevated)]">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="h-full w-full object-cover" />
      ) : (
        <ImageIcon size={11} className="text-[var(--text-muted)]" />
      )}
    </span>
  )
}

export function PhotoBank({ track }: { track: Track }) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)
  // Drag affordance: any file drag in the window shows the drop cue on the
  // bank; hovering the bank itself brightens it. Hover uses a depth counter -
  // dragenter/leave fire at every CHILD boundary, and toggling on the raw
  // events flickers as the drag crosses rows.
  const [fileDragActive, setFileDragActive] = useState(false)
  const [dropHover, setDropHover] = useState(false)
  const hoverDepthRef = useRef(0)
  const setTrackPhotoPads = useProjectStore((s) => s.setTrackPhotoPads)
  const photoClips = usePhotoStore((s) => s.photoClips)
  const uploads = usePhotoStore((s) => s.uploads)
  const { isPro } = usePlan()

  const pads = track.photoPads ?? []
  // Free plans cap the bank; Pro never hits a limit.
  const atPadLimit = photoPadRoom(pads.length, isPro) <= 0

  /** Append files as photos - the one entry point (button, single drop, multi
   *  drop all land here; a still image has no moment to pick). */
  const add = (files: File[]) => {
    setError(null)
    void addPhotosToTrack(track.id, files, isPro, setError)
  }

  const onFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    e.target.value = '' // re-selecting the same file must still fire onChange
    if (files.length > 0) add(files)
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    hoverDepthRef.current = 0
    setDropHover(false)
    const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith('image/'))
    if (files.length > 0) add(files)
  }

  // Window-level file-drag detection (dragenter/leave are per-element and
  // noisy, so a depth counter decides "a file drag is happening at all").
  useEffect(() => {
    let depth = 0
    const isFileDrag = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')
    const onEnter = (e: DragEvent) => {
      if (!isFileDrag(e)) return
      depth++
      setFileDragActive(true)
    }
    const onLeave = (e: DragEvent) => {
      if (!isFileDrag(e)) return
      depth = Math.max(0, depth - 1)
      if (depth === 0) setFileDragActive(false)
    }
    const onSettle = () => {
      depth = 0
      hoverDepthRef.current = 0
      setFileDragActive(false)
      setDropHover(false)
    }
    window.addEventListener('dragenter', onEnter)
    window.addEventListener('dragleave', onLeave)
    window.addEventListener('drop', onSettle)
    window.addEventListener('dragend', onSettle)
    return () => {
      window.removeEventListener('dragenter', onEnter)
      window.removeEventListener('dragleave', onLeave)
      window.removeEventListener('drop', onSettle)
      window.removeEventListener('dragend', onSettle)
    }
  }, [])

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= pads.length) return
    const next = pads.slice()
    ;[next[i], next[j]] = [next[j], next[i]]
    setTrackPhotoPads(track.id, next)
  }

  const remove = (i: number) => {
    const removed = pads[i]
    setTrackPhotoPads(track.id, pads.filter((_, k) => k !== i))
    cleanOrphanPhoto(removed.ref)
  }

  return (
    <div
      className={`relative mb-5 rounded ${dropHover ? 'bg-[var(--accent)]/10' : ''}`}
      onDragEnter={(e) => {
        if (!Array.from(e.dataTransfer.types).includes('Files')) return
        e.preventDefault()
        hoverDepthRef.current++
        setDropHover(true)
      }}
      onDragOver={(e) => {
        if (!Array.from(e.dataTransfer.types).includes('Files')) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
      }}
      onDragLeave={() => {
        hoverDepthRef.current = Math.max(0, hoverDepthRef.current - 1)
        if (hoverDepthRef.current === 0) setDropHover(false)
      }}
      onDrop={onDrop}
    >
      {fileDragActive && (
        <div
          className={`pointer-events-none absolute -inset-1.5 z-10 flex items-center justify-center rounded border border-dashed transition-colors ${
            dropHover ? 'border-[var(--accent)] bg-[var(--accent)]/15' : 'border-[var(--border-strong)] bg-[var(--bg-panel)]/70'
          }`}
        >
          <span className={`flex items-center gap-1.5 font-mono text-[11px] ${dropHover ? 'text-[var(--accent)]' : 'text-[var(--text-3)]'}`}>
            <Plus size={13} /> drop photos to add
          </span>
        </div>
      )}

      <p className="mb-3 text-[10px] font-semibold tracking-[0.06em] text-[var(--text-muted)] select-none">PHOTOS</p>
      {pads.length === 0 && (
        <p className="mb-2 text-[11px] text-[var(--text-muted)]">
          Upload or drop photos, then draw notes in the MIDI editor to cut between them.
        </p>
      )}
      {pads.map((pad, i) => {
        const source = photoClips[pad.ref]
        const up = uploads[pad.ref]
        return (
          <div
            key={`${pad.ref}-${i}`}
            className="mb-1 flex items-center gap-2 rounded border border-[var(--border)] bg-[var(--bg-app)] px-2 py-1.5"
          >
            <span className="w-5 flex-shrink-0 font-mono text-[10px] text-[var(--accent)]">{i + 1}</span>
            <PhotoThumb refId={pad.ref} />
            <span className="min-w-0 flex-1 truncate text-[11px] text-[var(--text-2)]" title={source?.fileName ?? pad.ref}>
              {source?.fileName ?? 'missing photo'}
            </span>
            {up && (up.status === 'saving' ? (
              <span className="flex-shrink-0 font-mono text-[9px] text-[var(--accent)]" title="Uploading in the background">
                ↑{savingPercent(up.progress)}%
              </span>
            ) : (
              <button
                onClick={() => retryPhotoUploadTracked(pad.ref)}
                className="flex-shrink-0 cursor-pointer font-mono text-[9px] font-bold text-[var(--warn)]"
                title={`${up.error ?? 'Upload failed'} - click to retry`}
              >
                !
              </button>
            ))}
            <button onClick={() => move(i, -1)} disabled={i === 0} className="flex-shrink-0 text-[var(--text-muted)] hover:text-[var(--text-2)] disabled:opacity-30 cursor-pointer disabled:cursor-default" aria-label="Move photo up"><ArrowUp size={11} /></button>
            <button onClick={() => move(i, 1)} disabled={i === pads.length - 1} className="flex-shrink-0 text-[var(--text-muted)] hover:text-[var(--text-2)] disabled:opacity-30 cursor-pointer disabled:cursor-default" aria-label="Move photo down"><ArrowDown size={11} /></button>
            <button onClick={() => remove(i)} className="flex-shrink-0 text-[var(--text-muted)] hover:text-[var(--warn)] cursor-pointer" aria-label="Remove photo"><X size={11} /></button>
          </div>
        )
      })}

      <button
        onClick={() => fileInputRef.current?.click()}
        disabled={atPadLimit}
        className="mt-1 flex h-7 w-full items-center justify-center gap-1.5 rounded border border-dashed border-[var(--border)] text-[11px] text-[var(--text-3)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text)] disabled:opacity-50 cursor-pointer disabled:cursor-default"
      >
        <Plus size={11} />
        {atPadLimit ? `${PHOTO_FREE_MAX_PADS}-photo free limit` : 'Upload photos'}
      </button>
      {error && <p className="mt-1.5 text-[11px] text-[var(--warn)]">{error}</p>}
      <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={onFileInput} />
    </div>
  )
}
