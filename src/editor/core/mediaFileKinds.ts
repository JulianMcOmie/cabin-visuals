// Which KIND of media a file is, and whether a drag is carrying files at all.
// Every file-drop and file-picker path routes through here.
//
// Both questions have to be answered in a way that survives Safari, which is
// far stingier than Chrome about what it exposes:
//
//  - DURING a drag (dragenter/dragover) WebKit does not reveal per-file types:
//    `dataTransfer.items` is empty (or the items' `type` is ''), because the
//    page hasn't been given the drop yet. Deciding "this drag isn't media"
//    from MIME types therefore skips `preventDefault()`, and a drag the page
//    never accepted delivers no `drop` event at all - Safari just opens the
//    file. `dataTransfer.types` DOES contain 'Files', so that - and only that
//    - is the gate for "a drag is carrying files" (see dragCarriesFiles).
//    Kinds sniffed mid-drag are a nicety for the overlay's wording; treat
//    "couldn't tell" as "some file", never as "not for us".
//
//  - ON drop, `File.type` is '' for any extension macOS has no UTI → MIME
//    mapping for (which ones varies by OS version: .aif, .opus, .caf, .flac
//    have all shown up bare). Routing purely on `f.type.startsWith('audio/')`
//    silently discards real audio files, so the filename extension is the
//    fallback for every kind.
//
// Rule: trust the MIME type when it says something, the extension otherwise.

export type MediaKind = 'midi' | 'audio' | 'video' | 'photo'

// Extension tables are the Safari fallback, not the primary router - they only
// have to cover what a browser can plausibly be handed, not every codec.
const AUDIO_EXTENSIONS = ['mp3', 'm4a', 'm4b', 'aac', 'wav', 'wave', 'aif', 'aiff', 'aifc', 'flac', 'ogg', 'oga', 'opus', 'caf', 'wma', 'amr', 'mp2', 'weba']
const VIDEO_EXTENSIONS = ['mp4', 'm4v', 'mov', 'webm', 'mkv', 'avi', 'mpg', 'mpeg', 'ogv', '3gp', '3g2', 'wmv', 'flv', 'mts', 'm2ts', 'qt']
const PHOTO_EXTENSIONS = ['jpg', 'jpeg', 'jpe', 'png', 'gif', 'webp', 'avif', 'heic', 'heif', 'bmp', 'tif', 'tiff', 'ico', 'svg']

/** Lowercased extension without the dot; '' when the name has none. */
function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

/** .mid drops report 'audio/midi', 'audio/mid', or an empty type depending on
 *  the OS - the extension is the reliable router (checked before any audio/*
 *  branch so MIDI never falls into the audio pipeline). */
export function isMidiFileName(name: string): boolean {
  return /\.midi?$/i.test(name)
}

/** The MIME types a .mid drag exposes during dragover, where filenames aren't
 *  readable yet. Empty-type drags stay invisible until drop. */
export function isMidiMimeType(type: string): boolean {
  return type === 'audio/midi' || type === 'audio/mid'
}

/**
 * The kind a dropped/picked file belongs to, or null for something we have no
 * pipeline for. MIME type decides when it's informative; extension decides
 * when it isn't (Safari's bare `File.type`, see the note at the top).
 */
export function mediaKindOfFile(file: { name: string; type: string }): MediaKind | null {
  // MIDI first, always: 'audio/midi' would otherwise read as audio.
  if (isMidiFileName(file.name) || isMidiMimeType(file.type)) return 'midi'
  const mime = mediaKindOfMimeType(file.type)
  if (mime) return mime
  const ext = extensionOf(file.name)
  if (AUDIO_EXTENSIONS.includes(ext)) return 'audio'
  if (VIDEO_EXTENSIONS.includes(ext)) return 'video'
  if (PHOTO_EXTENSIONS.includes(ext)) return 'photo'
  return null
}

/**
 * The kind a MIME type alone implies - what a mid-drag `DataTransferItem` can
 * offer, where filenames are unreadable. null means "nothing to go on", NOT
 * "not media": Safari reports '' for every item mid-drag.
 */
export function mediaKindOfMimeType(type: string): MediaKind | null {
  if (isMidiMimeType(type)) return 'midi'
  if (type.startsWith('audio/')) return 'audio'
  if (type.startsWith('video/')) return 'video'
  if (type.startsWith('image/')) return 'photo'
  return null
}

/** True for a file (not text/link) drag. The ONE dependable mid-drag signal in
 *  every browser, and the only one Safari gives - gate `preventDefault()` on
 *  this, never on sniffed kinds. */
export function dragCarriesFiles(dt: DataTransfer | null): boolean {
  if (!dt) return false
  return Array.from(dt.types).includes('Files')
}

// Convenience predicates for the "keep only my kind" filters drop zones write.

export function isAudioFile(file: { name: string; type: string }): boolean {
  return mediaKindOfFile(file) === 'audio'
}

export function isVideoFile(file: { name: string; type: string }): boolean {
  return mediaKindOfFile(file) === 'video'
}

export function isPhotoFile(file: { name: string; type: string }): boolean {
  return mediaKindOfFile(file) === 'photo'
}
