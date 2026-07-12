import { beginSaveVideo, retryVideoUpload, removeVideo } from './videoSource'
import { useVideoStore } from '../../store/VideoStore'
import { useProjectStore } from '../../store/ProjectStore'

// The one video upload pipeline: validate a file, register its clip in the
// catalog, and persist its bytes in the background while VideoStore.uploads
// reports progress/failure to whoever is rendering (the clip bank's rows, the
// moment picker's banner). Both entry points come through here - the
// VideoClipBank (button, drop on the bank) and files dropped straight onto
// the tracks timeline - so the two flows are literally the same code.

// Free plans cap the pad bank; Pro tracks hold as many clips as they like.
export const FREE_MAX_PADS = 8

/** How many more clips may land on a bank of `count` pads (Infinity for Pro). */
export function padRoom(count: number, isPro: boolean): number {
  return isPro ? Infinity : FREE_MAX_PADS - count
}
// Per-plan caps on the SOURCE file (the only thing uploaded). Picking moments
// out of it is free. PRO_MAX_MB must equal the bucket's file_size_limit
// (migration 0004): callers reject oversized files instantly; the bucket
// backstops. (Like all plan gating, the free cap is client-side only.)
export const FREE_MAX_MB = 50
export const PRO_MAX_MB = 250

/** The user-facing rejection for an over-cap file, or null if it fits. */
export function capError(file: File, isPro: boolean): string | null {
  const maxMb = isPro ? PRO_MAX_MB : FREE_MAX_MB
  if (file.size <= maxMb * 1024 * 1024) return null
  const mb = Math.round(file.size / (1024 * 1024))
  return isPro
    ? `${file.name} is ${mb} MB - sources are capped at ${PRO_MAX_MB} MB. Compress it first.`
    : `${file.name} is ${mb} MB - free sources are capped at ${FREE_MAX_MB} MB. Upgrade to Pro for ${PRO_MAX_MB} MB, or compress it first.`
}

// Free plans also cap TOTAL video stored in a project; Pro is unlimited total.
// (Per-upload caps above still apply to Pro.)
export const FREE_TOTAL_BYTES = 1024 ** 3 // 1 GiB

/** Sum of every catalogued clip's source bytes. Legacy/unknown sizes (clips
 *  saved before VideoClip.bytes existed) count as 0. */
export function totalVideoBytes(): number {
  return Object.values(useVideoStore.getState().videoClips).reduce((sum, clip) => sum + (clip.bytes ?? 0), 0)
}

/**
 * The user-facing rejection when adding `file` would push a FREE project past
 * its 1 GB total, or null if it fits (Pro has no total cap).
 *
 * This is per-PROJECT client-side accounting: the catalog only knows the clips
 * of the currently open project, so this bounds one project, not the account.
 * A true per-account storage quota needs a server-side check (out of scope).
 */
export function totalCapError(file: File, isPro: boolean): string | null {
  if (isPro) return null // Pro: unlimited total video storage.
  if (totalVideoBytes() + file.size <= FREE_TOTAL_BYTES) return null
  const gb = (totalVideoBytes() / 1024 ** 3).toFixed(1)
  return `This project already has ${gb} GB of video - the free plan holds 1 GB total. Upgrade to Pro for unlimited video storage.`
}

/** Probe duration + dimensions from the file before it enters the catalog. */
export function probeVideo(file: File): Promise<{ duration: number; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const el = document.createElement('video')
    const url = URL.createObjectURL(file)
    el.preload = 'metadata'
    el.onloadedmetadata = () => {
      const meta = { duration: el.duration, width: el.videoWidth, height: el.videoHeight }
      URL.revokeObjectURL(url)
      resolve(meta)
    }
    el.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Could not read this video file'))
    }
    el.src = url
  })
}

// Uploads whose bytes are still POSTing, and refs whose orphan-cleanup must
// wait for their upload to settle (deleting a path that's still POSTing would
// race). Module-level so every entry point shares one truth.
const inFlight = new Set<string>()
const cleanupOnSettle = new Set<string>()

/** Is `ref` still used by any pad on any track? */
export function sourceStillUsed(ref: string): boolean {
  return Object.values(useProjectStore.getState().tracks).some((t) => (t.videoPads ?? []).some((p) => p.ref === ref))
}

/** Drop a source's clip + bytes if nothing references it anymore. Safe to call
 *  any time: cleanup of a still-POSTing ref is deferred until it settles. */
export function cleanOrphanSource(ref: string): void {
  if (sourceStillUsed(ref)) return
  if (inFlight.has(ref)) {
    cleanupOnSettle.add(ref)
    return
  }
  useVideoStore.getState().removeClip(ref)
  removeVideo(ref)
}

/**
 * Validate + begin persisting one file. Resolves with the minted ref (usable
 * IMMEDIATELY - local bytes back it) or null if it couldn't start. The upload
 * itself reports through VideoStore.uploads and settles in the background.
 * `onError` (optional) receives user-facing failure text - couldn't start, or
 * the background upload died while its clips are still in use.
 */
export async function startVideoUpload(file: File, onError?: (message: string) => void): Promise<string | null> {
  try {
    const meta = await probeVideo(file)
    let refBox: string | null = null
    const { ref, completion } = await beginSaveVideo(file, (progress) => {
      if (refBox) useVideoStore.getState().patchUpload(refBox, { progress })
    })
    refBox = ref
    useVideoStore.getState().addClip({ ref, fileName: file.name, bytes: file.size, ...meta })
    useVideoStore.getState().patchUpload(ref, { progress: 0, status: 'saving', error: null })
    inFlight.add(ref)
    void completion
      .then(
        () => useVideoStore.getState().patchUpload(ref, null), // durable
        (err) => {
          const message =
            (err as { message?: string } | null)?.message ?? (err instanceof Error ? err.message : 'Upload failed')
          console.error('Video upload failed:', message, err)
          useVideoStore.getState().patchUpload(ref, { status: 'failed', error: message })
          if (sourceStillUsed(ref)) {
            onError?.(`Upload of ${file.name} failed - its clips won't survive a reload. Click one of its clips to retry.`)
          }
        },
      )
      .then(() => {
        inFlight.delete(ref)
        if (cleanupOnSettle.delete(ref)) cleanOrphanSource(ref)
      })
    return ref
  } catch (err) {
    const message =
      (err as { message?: string } | null)?.message ?? (err instanceof Error ? err.message : 'Could not read this video')
    console.error('Video save failed to start:', message, err)
    onError?.(message)
    return null
  }
}

/** Re-run a failed upload from the locally-held bytes, through the registry. */
export function retryVideoUploadTracked(ref: string): void {
  useVideoStore.getState().patchUpload(ref, { status: 'saving', progress: 0, error: null })
  inFlight.add(ref)
  void retryVideoUpload(ref, (progress) => useVideoStore.getState().patchUpload(ref, { progress }))
    .then(
      () => useVideoStore.getState().patchUpload(ref, null),
      (err) => {
        const message = err instanceof Error ? err.message : 'Upload failed'
        console.error('Video upload retry failed:', message, err)
        useVideoStore.getState().patchUpload(ref, { status: 'failed', error: message })
      },
    )
    .then(() => {
      inFlight.delete(ref)
      if (cleanupOnSettle.delete(ref)) cleanOrphanSource(ref)
    })
}

/**
 * The multi-file path: land each file as one pad starting at 0s on `trackId`,
 * uploading in the background. Used by multi-file drops on the clip bank and
 * by video files dropped straight onto the tracks timeline.
 */
export async function addVideoClipsToTrack(
  trackId: string,
  files: File[],
  isPro: boolean,
  onError?: (message: string) => void,
): Promise<void> {
  for (const file of files) {
    const current = useProjectStore.getState().tracks[trackId]?.videoPads ?? []
    if (padRoom(current.length, isPro) <= 0) {
      onError?.(`Free plans hold up to ${FREE_MAX_PADS} clips per track (Pro is unlimited) - some files were skipped`)
      break
    }
    const cap = capError(file, isPro)
    if (cap) {
      onError?.(cap)
      continue
    }
    // Per-PROJECT total-storage cap (free = 1 GB). Each file already added this
    // loop is in the catalog, so totalVideoBytes() grows as we go - the check is
    // naturally cumulative across a multi-file add.
    const totalCap = totalCapError(file, isPro)
    if (totalCap) {
      onError?.(totalCap)
      continue
    }
    const ref = await startVideoUpload(file, onError) // resolves at mint, not upload end
    if (!ref) continue // probe failure - error already surfaced
    const fresh = useProjectStore.getState().tracks[trackId]?.videoPads ?? []
    useProjectStore.getState().setTrackVideoPads(trackId, [...fresh, { ref, inPoint: 0 }])
  }
}
