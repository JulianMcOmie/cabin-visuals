'use client'

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { FileAudio, FileMusic, Film, Image as ImageIcon } from 'lucide-react'
import { useProjectStore } from '../store/ProjectStore'
import { useUIStore } from '../store/UIStore'
import { OBJECT_TRACK_COLOR } from '../utils/trackColors'
import { selectNewTrack } from '../utils/selection'
import { loadAudioTrack } from '../utils/loadAudioTrack'
import { addVideoClipsToTrack, capError, FREE_TOTAL_BYTES, totalVideoBytes } from '../core/video/videoUploads'
import { addPhotosToTrack } from '../core/photo/photoUploads'
import { parseMidiFile, isMidiFileName, isMidiMimeType } from '../core/midiImport'
import { getInstrument } from '../instruments'
import { usePlan } from '../../billing/usePlan'

/**
 * OS-file drops for the WHOLE editor: audio, MIDI, video, and photo files can
 * land anywhere - the header, the canvas, the library, the timeline - and add
 * tracks exactly like the old tracks-section drop did (each audio file its own
 * track; video files as ONE Video track; photos appended to a photo track;
 * .mid parsed into tracks). Listeners live on window, the overlay is a fixed
 * layer, so there are no dead zones or gutters where the drop indicator stalls.
 *
 * The photo/video clip BANKS keep their own more-specific drop zones; their
 * handlers stopPropagation so a drop there never double-lands here.
 */

// ── Transient notice (module-level: the timeline's MIDI import button reports
//    through the same slot) ─────────────────────────────────────────────────

type Notice = { message: string; tone: 'warn' | 'info' }
let currentNotice: Notice | null = null
let noticeTimer: ReturnType<typeof setTimeout> | null = null
const noticeListeners = new Set<() => void>()
const emitNotice = () => noticeListeners.forEach((l) => l())

export function showMediaNotice(message: string, tone: 'warn' | 'info' = 'warn'): void {
  currentNotice = { message, tone }
  emitNotice()
  if (noticeTimer) clearTimeout(noticeTimer)
  noticeTimer = setTimeout(() => { currentNotice = null; emitNotice() }, 8000)
}

function subscribeNotice(l: () => void): () => void {
  noticeListeners.add(l)
  return () => noticeListeners.delete(l)
}

// ── File handling (moved verbatim in behavior from TimelineArea) ─────────────

/** .mid files → new tracks through the pure parser + one store write, shared
 *  by the timeline's import button and OS drops. Routed by extension, not MIME
 *  type - browsers report 'audio/midi', 'audio/mid', or nothing. */
export function importMidiFiles(files: File[]): void {
  void (async () => {
    const createdIds: string[] = []
    let trackCount = 0
    let noteCount = 0
    let outsideCount = 0
    // The default instrument's declared vocabulary. Out-of-range notes still
    // import (the document keeps full pitch); the summary just counts them.
    const mapped = new Set(getInstrument('cube')?.midiRows?.map((r) => r.pitch) ?? [])
    for (const file of files) {
      let imported
      try {
        imported = parseMidiFile(await file.arrayBuffer())
      } catch {
        showMediaNotice(`Couldn't read ${file.name}`)
        continue
      }
      if (imported.length === 0) {
        showMediaNotice(`No notes in ${file.name}`)
        continue
      }
      createdIds.push(...useProjectStore.getState().importMidiTracks(imported))
      for (const t of imported) {
        trackCount++
        noteCount += t.notes.length
        if (mapped.size > 0) outsideCount += t.notes.filter((n) => !mapped.has(n.pitch)).length
      }
    }
    if (createdIds.length === 0) return
    selectNewTrack(createdIds[0])
    const summary = `${trackCount} ${trackCount === 1 ? 'track' : 'tracks'} · ${noteCount} ${noteCount === 1 ? 'note' : 'notes'}`
    showMediaNotice(outsideCount > 0 ? `${summary} · ${outsideCount} outside Cube's range` : summary, 'info')
  })()
}

// Image drops append to a photo track rather than making a new one each time -
// the selected track if it's a photo instrument, else the first photo track in
// the project, else a fresh one.
function addPhotoFiles(files: File[], isPro: boolean) {
  const { tracks, rootTrackIds } = useProjectStore.getState()
  const selectedId = useUIStore.getState().selectedTrackId
  const isPhotoTrack = (id: string | null | undefined) => !!id && tracks[id]?.instrumentId === 'photo'
  let targetId = isPhotoTrack(selectedId) ? selectedId! : rootTrackIds.find(isPhotoTrack)
  if (!targetId) {
    targetId = crypto.randomUUID()
    useProjectStore.getState().addTrack({
      id: targetId,
      name: 'Photo',
      type: 'base',
      instrumentId: 'photo',
      color: OBJECT_TRACK_COLOR,
      muted: false,
      solo: false,
      blocks: [],
      childIds: [],
    })
  }
  selectNewTrack(targetId)
  void addPhotosToTrack(targetId, files, isPro, showMediaNotice)
}

function handleDroppedFiles(files: File[], isPro: boolean) {
  const isMidiFile = (f: File) => isMidiFileName(f.name) || isMidiMimeType(f.type)
  const midiFiles = files.filter(isMidiFile)
  if (midiFiles.length > 0) importMidiFiles(midiFiles)

  const audioFiles = files.filter((f) => !isMidiFile(f) && f.type.startsWith('audio/'))
  void (async () => {
    for (const file of audioFiles) {
      try {
        await loadAudioTrack(file)
      } catch (err) {
        console.error('Failed to load dropped audio file', file.name, err)
        showMediaNotice(`Couldn't load ${file.name}`)
      }
    }
  })()

  const videoFiles = files.filter((f) => f.type.startsWith('video/'))
  if (videoFiles.length > 0) {
    // An over-cap file cancels the whole video add (notify, add nothing) -
    // half-importing a drop is more confusing than rejecting it.
    const cap = videoFiles.map((f) => capError(f, isPro)).find((m) => m !== null)
    if (cap) {
      showMediaNotice(cap)
      return
    }
    // Free plans also cap TOTAL video per project (1 GB); Pro is unlimited.
    if (!isPro) {
      const dropBytes = videoFiles.reduce((sum, f) => sum + f.size, 0)
      if (totalVideoBytes() + dropBytes > FREE_TOTAL_BYTES) {
        const gb = (totalVideoBytes() / 1024 ** 3).toFixed(1)
        showMediaNotice(
          `This project already has ${gb} GB of video - the free plan holds 1 GB total. Upgrade to Pro for unlimited video storage.`,
        )
        return
      }
    }
    const id = crypto.randomUUID()
    useProjectStore.getState().addTrack({
      id,
      name: 'Video',
      type: 'base',
      instrumentId: 'video',
      color: OBJECT_TRACK_COLOR,
      muted: false,
      solo: false,
      blocks: [],
      childIds: [],
    })
    selectNewTrack(id)
    void addVideoClipsToTrack(id, videoFiles, isPro, showMediaNotice)
  }

  const photoFiles = files.filter((f) => f.type.startsWith('image/'))
  if (photoFiles.length > 0) addPhotoFiles(photoFiles, isPro)
}

// ── The layer ────────────────────────────────────────────────────────────────

type MediaKinds = { audio: boolean; video: boolean; midi: boolean; photo: boolean }

// MIDI is sniffed before the audio/ prefix - 'audio/midi' must not read as
// audio. Empty-type .mid drags stay invisible until drop (no filename here).
function mediaKindsOf(e: DragEvent): MediaKinds | null {
  if (!e.dataTransfer) return null
  let audio = false
  let video = false
  let midi = false
  let photo = false
  for (const it of Array.from(e.dataTransfer.items)) {
    if (it.kind !== 'file') continue
    if (isMidiMimeType(it.type)) midi = true
    else if (it.type.startsWith('audio/')) audio = true
    else if (it.type.startsWith('video/')) video = true
    else if (it.type.startsWith('image/')) photo = true
  }
  return audio || video || midi || photo ? { audio, video, midi, photo } : null
}

/** Mounted once in the editor root. */
export function MediaFileDropLayer() {
  const { isPro } = usePlan()
  const isProRef = useRef(isPro)
  isProRef.current = isPro
  const [hover, setHover] = useState<MediaKinds | null>(null)
  const depthRef = useRef(0)
  const notice = useSyncExternalStore(subscribeNotice, () => currentNotice, () => null)

  useEffect(() => {
    const enter = (e: DragEvent) => {
      const kinds = mediaKindsOf(e)
      if (!kinds) return
      e.preventDefault()
      depthRef.current++
      setHover(kinds)
    }
    const over = (e: DragEvent) => {
      if (!mediaKindsOf(e)) return
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    }
    const leave = (e: DragEvent) => {
      if (!mediaKindsOf(e)) return
      depthRef.current = Math.max(0, depthRef.current - 1)
      if (depthRef.current === 0) setHover(null)
    }
    const drop = (e: DragEvent) => {
      depthRef.current = 0
      setHover(null)
      if (!e.dataTransfer) return
      const files = Array.from(e.dataTransfer.files)
      if (files.length === 0) return
      e.preventDefault()
      handleDroppedFiles(files, isProRef.current)
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragover', over)
    window.addEventListener('dragleave', leave)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragover', over)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('drop', drop)
    }
  }, [])

  return (
    <>
      {hover && (
        <div className="pointer-events-none fixed inset-2 z-[95] flex items-center justify-center rounded border border-dashed border-[var(--accent)] bg-[var(--accent)]/10">
          <span className="flex items-center gap-1.5 rounded bg-[var(--bg-panel)]/85 px-3 py-1.5 font-mono text-[11px] text-[var(--accent)]">
            {hover.video ? <Film size={13} /> : hover.photo ? <ImageIcon size={13} /> : hover.midi ? <FileMusic size={13} /> : <FileAudio size={13} />}
            {[hover.audio, hover.video, hover.midi, hover.photo].filter(Boolean).length > 1
              ? 'drop files to add tracks'
              : hover.video
                ? 'drop videos to add a video track'
                : hover.photo
                  ? 'drop photos to add to the slideshow'
                  : hover.midi
                    ? 'drop MIDI to add tracks'
                    : 'drop audio to add tracks'}
          </span>
        </div>
      )}
      {notice && (
        <div className="fixed bottom-4 left-1/2 z-[96] -translate-x-1/2">
          <button
            onClick={() => { currentNotice = null; emitNotice() }}
            title="Dismiss"
            className={`max-w-[560px] cursor-pointer rounded border bg-[var(--bg-panel)] px-3 py-1.5 text-left text-[11px] leading-snug shadow-lg shadow-black/40 ${
              notice.tone === 'info'
                ? 'border-[var(--accent)] text-[var(--accent)]'
                : 'border-[var(--warn)] text-[var(--warn)]'
            }`}
          >
            {notice.message}
          </button>
        </div>
      )}
    </>
  )
}
