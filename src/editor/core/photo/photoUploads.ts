import { beginSavePhoto, retryPhotoUpload, removePhoto } from './photoSource'
import { usePhotoStore } from '../../store/PhotoStore'
import { useProjectStore } from '../../store/ProjectStore'

// The one photo upload pipeline: validate a file, register its clip in the
// catalog, and persist its bytes in the background while PhotoStore.uploads
// reports progress/failure to whoever is rendering (the photo bank's rows).
// Both entry points come through here - the PhotoBank (button, drop on the
// bank) and multi-file appends - so the flows are literally the same code.
// The still-image sibling of core/video/videoUploads.ts.

// Free plans cap the photo bank; Pro tracks hold as many photos as they like.
// Deliberately not imported from videoUploads - the Photo instrument owns its
// own copy of the rule so the two can diverge without surprise.
export const PHOTO_FREE_MAX_PADS = 8

/** How many more photos may land on a bank of `count` pads (Infinity for Pro). */
export function photoPadRoom(count: number, isPro: boolean): number {
  return isPro ? Infinity : PHOTO_FREE_MAX_PADS - count
}

// One per-file cap, both plans: a still image is small, so there is no Pro/free
// split. PHOTO_MAX_MB must equal the bucket's file_size_limit (migration 0005):
// callers reject oversized files instantly; the bucket backstops.
export const PHOTO_MAX_MB = 25

/** The user-facing rejection for an over-cap file, or null if it fits. */
export function photoCapError(file: File): string | null {
  if (file.size <= PHOTO_MAX_MB * 1024 * 1024) return null
  const mb = Math.round(file.size / (1024 * 1024))
  return `${file.name} is ${mb} MB - photos are capped at ${PHOTO_MAX_MB} MB. Compress it first.`
}

/** Probe dimensions from the file before it enters the catalog. */
export function probePhoto(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const el = document.createElement('img')
    const url = URL.createObjectURL(file)
    el.onload = () => {
      const meta = { width: el.naturalWidth, height: el.naturalHeight }
      URL.revokeObjectURL(url)
      resolve(meta)
    }
    el.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Could not read this image file'))
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
export function photoStillUsed(ref: string): boolean {
  return Object.values(useProjectStore.getState().tracks).some((t) => (t.photoPads ?? []).some((p) => p.ref === ref))
}

/** Drop a photo's clip + bytes if nothing references it anymore. Safe to call
 *  any time: cleanup of a still-POSTing ref is deferred until it settles. */
export function cleanOrphanPhoto(ref: string): void {
  if (photoStillUsed(ref)) return
  if (inFlight.has(ref)) {
    cleanupOnSettle.add(ref)
    return
  }
  usePhotoStore.getState().removeClip(ref)
  removePhoto(ref)
}

/**
 * Validate + begin persisting one file. Resolves with the minted ref (usable
 * IMMEDIATELY - local bytes back it) or null if it couldn't start. The upload
 * itself reports through PhotoStore.uploads and settles in the background.
 * `onError` (optional) receives user-facing failure text - couldn't start, or
 * the background upload died while its pads are still in use.
 */
export async function startPhotoUpload(file: File, onError?: (message: string) => void): Promise<string | null> {
  try {
    const meta = await probePhoto(file)
    let refBox: string | null = null
    const { ref, completion } = await beginSavePhoto(file, (progress) => {
      if (refBox) usePhotoStore.getState().patchUpload(refBox, { progress })
    })
    refBox = ref
    usePhotoStore.getState().addClip({ ref, fileName: file.name, ...meta })
    usePhotoStore.getState().patchUpload(ref, { progress: 0, status: 'saving', error: null })
    inFlight.add(ref)
    void completion
      .then(
        () => usePhotoStore.getState().patchUpload(ref, null), // durable
        (err) => {
          const message =
            (err as { message?: string } | null)?.message ?? (err instanceof Error ? err.message : 'Upload failed')
          console.error('Photo upload failed:', message, err)
          usePhotoStore.getState().patchUpload(ref, { status: 'failed', error: message })
          if (photoStillUsed(ref)) {
            onError?.(`Upload of ${file.name} failed - it won't survive a reload. Click the photo to retry.`)
          }
        },
      )
      .then(() => {
        inFlight.delete(ref)
        if (cleanupOnSettle.delete(ref)) cleanOrphanPhoto(ref)
      })
    return ref
  } catch (err) {
    const message =
      (err as { message?: string } | null)?.message ?? (err instanceof Error ? err.message : 'Could not read this image')
    console.error('Photo save failed to start:', message, err)
    onError?.(message)
    return null
  }
}

/** Re-run a failed upload from the locally-held bytes, through the registry. */
export function retryPhotoUploadTracked(ref: string): void {
  usePhotoStore.getState().patchUpload(ref, { status: 'saving', progress: 0, error: null })
  inFlight.add(ref)
  void retryPhotoUpload(ref, (progress) => usePhotoStore.getState().patchUpload(ref, { progress }))
    .then(
      () => usePhotoStore.getState().patchUpload(ref, null),
      (err) => {
        const message = err instanceof Error ? err.message : 'Upload failed'
        console.error('Photo upload retry failed:', message, err)
        usePhotoStore.getState().patchUpload(ref, { status: 'failed', error: message })
      },
    )
    .then(() => {
      inFlight.delete(ref)
      if (cleanupOnSettle.delete(ref)) cleanOrphanPhoto(ref)
    })
}

/**
 * Append each file as one pad on `trackId`, uploading in the background. Used
 * by both the single-file and multi-file paths on the photo bank - a photo has
 * no moment to pick, so a fresh upload is simply appended.
 */
export async function addPhotosToTrack(
  trackId: string,
  files: File[],
  isPro: boolean,
  onError?: (message: string) => void,
): Promise<void> {
  for (const file of files) {
    const current = useProjectStore.getState().tracks[trackId]?.photoPads ?? []
    if (photoPadRoom(current.length, isPro) <= 0) {
      onError?.(`Free plans hold up to ${PHOTO_FREE_MAX_PADS} photos per track (Pro is unlimited) - some files were skipped`)
      break
    }
    const cap = photoCapError(file)
    if (cap) {
      onError?.(cap)
      continue
    }
    const ref = await startPhotoUpload(file, onError) // resolves at mint, not upload end
    if (!ref) continue // probe failure - error already surfaced
    const fresh = useProjectStore.getState().tracks[trackId]?.photoPads ?? []
    useProjectStore.getState().setTrackPhotoPads(trackId, [...fresh, { ref }])
  }
}
