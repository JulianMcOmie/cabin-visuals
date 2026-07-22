// The container seam: encoded chunks in, an .mp4 blob out. The muxer streams
// into ChunkedBlobStore rather than one in-memory ArrayBuffer: constant-quality
// exports of grain-heavy projects crossed the GB mark and died on the old
// ArrayBufferTarget's contiguous allocation ("Array buffer allocation failed").
// Frozen 32 MB parts become Blobs - which Chrome backs with disk storage - so
// peak RAM stays flat no matter how big the file gets.

import { Muxer, StreamTarget } from 'mp4-muxer'

/** Sequential output accumulates here; a full buffer freezes into a Blob part. */
const FREEZE_CHUNK = 32 * 1024 * 1024
/** The first bytes stay mutable: with fastStart: false the muxer's only
 *  non-sequential write is the mdat size patch at finalize, a few dozen bytes
 *  into the file. */
const MUTABLE_HEAD = 64 * 1024

/**
 * A write-mostly-sequential byte store assembled into one Blob at the end.
 * Accepts the position-addressed writes mp4-muxer's StreamTarget emits:
 * appends at the current end (the normal case), rewrites inside the still-open
 * tail buffer, and rewrites inside the mutable head. A write into a frozen
 * part would corrupt the file silently, so it throws instead - with
 * fastStart: false that never happens.
 */
export class ChunkedBlobStore {
  private readonly freezeChunk: number
  private head = new Uint8Array(MUTABLE_HEAD)
  private parts: Blob[] = []
  private pending: Uint8Array
  private pendingStart = MUTABLE_HEAD
  private pendingLen = 0
  private totalEnd = 0

  constructor(freezeChunk = FREEZE_CHUNK) {
    this.freezeChunk = freezeChunk
    this.pending = new Uint8Array(freezeChunk)
  }

  write(data: Uint8Array, position: number): void {
    this.totalEnd = Math.max(this.totalEnd, position + data.length)
    // The slice that falls inside the mutable head.
    if (position < MUTABLE_HEAD) {
      const n = Math.min(position + data.length, MUTABLE_HEAD) - position
      this.head.set(data.subarray(0, n), position)
      if (n === data.length) return
      data = data.subarray(n)
      position += n
    }
    const tailEnd = this.pendingStart + this.pendingLen
    if (position < tailEnd) {
      // Rewrite inside the open tail buffer only - frozen parts are immutable.
      if (position < this.pendingStart || position + data.length > tailEnd) {
        throw new Error(`mp4 write at ${position} touches a frozen chunk`)
      }
      this.pending.set(data, position - this.pendingStart)
      return
    }
    if (position !== tailEnd) {
      throw new Error(`non-contiguous mp4 write at ${position} (stream end ${tailEnd})`)
    }
    // Sequential append, spilling full buffers into disk-backed Blob parts.
    // (new Blob(...) snapshots the bytes, so the buffer is safe to reuse.)
    let offset = 0
    while (offset < data.length) {
      const n = Math.min(this.freezeChunk - this.pendingLen, data.length - offset)
      this.pending.set(data.subarray(offset, offset + n), this.pendingLen)
      this.pendingLen += n
      offset += n
      if (this.pendingLen === this.freezeChunk) {
        this.parts.push(new Blob([this.pending]))
        this.pendingStart += this.freezeChunk
        this.pendingLen = 0
      }
    }
  }

  toBlob(): Blob {
    return new Blob(
      [
        this.head.subarray(0, Math.min(this.totalEnd, MUTABLE_HEAD)),
        ...this.parts,
        this.pending.subarray(0, this.pendingLen),
      ],
      { type: 'video/mp4' },
    )
  }
}

export interface Mp4WriterOptions {
  width: number
  height: number
  /** Present = the file gets an AAC audio track (chunks fed via addAudioChunk). */
  audio?: { sampleRate: number; numberOfChannels: number }
}

export class Mp4Writer {
  private muxer: Muxer<StreamTarget>
  private store = new ChunkedBlobStore()

  constructor(opts: Mp4WriterOptions) {
    this.muxer = new Muxer({
      target: new StreamTarget({ onData: (data, position) => this.store.write(data, position) }),
      video: { codec: 'avc', width: opts.width, height: opts.height },
      audio: opts.audio ? { codec: 'aac', sampleRate: opts.audio.sampleRate, numberOfChannels: opts.audio.numberOfChannels } : undefined,
      // moov at the END of the file: the streaming store can't relocate it to
      // the front the way the old in-memory fastStart did. Local players and
      // every upload target are unaffected; only progressive HTTP playback of
      // the raw file would care, and socials re-encode regardless.
      fastStart: false,
    })
  }

  addVideoChunk(chunk: EncodedVideoChunk, meta?: EncodedVideoChunkMetadata): void {
    this.muxer.addVideoChunk(chunk, meta)
  }

  addAudioChunk(chunk: EncodedAudioChunk, meta?: EncodedAudioChunkMetadata): void {
    this.muxer.addAudioChunk(chunk, meta)
  }

  finalize(): Blob {
    this.muxer.finalize()
    return this.store.toBlob()
  }
}

/** Hand the finished file to the browser's download pipeline. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName.endsWith('.mp4') ? fileName : `${fileName}.mp4`
  a.click()
  // Give the download a beat to grab the URL before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
