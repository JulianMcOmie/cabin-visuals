// The container seam: encoded chunks in, an .mp4 blob out. mp4-muxer with an
// in-memory target - the finished file lives in RAM until download, which is
// fine at these sizes (~90 MB/min at 12 Mbps); the named escape hatch for huge
// projects is FileSystemWritableFileStreamTarget, one constructor swap away.

import { Muxer, ArrayBufferTarget } from 'mp4-muxer'

export interface Mp4WriterOptions {
  width: number
  height: number
  /** Present = the file gets an AAC audio track (chunks fed via addAudioChunk). */
  audio?: { sampleRate: number; numberOfChannels: number }
}

export class Mp4Writer {
  private muxer: Muxer<ArrayBufferTarget>

  constructor(opts: Mp4WriterOptions) {
    this.muxer = new Muxer({
      target: new ArrayBufferTarget(),
      video: { codec: 'avc', width: opts.width, height: opts.height },
      audio: opts.audio ? { codec: 'aac', sampleRate: opts.audio.sampleRate, numberOfChannels: opts.audio.numberOfChannels } : undefined,
      // moov atom up front so the file streams/scrubs immediately when posted.
      fastStart: 'in-memory',
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
    return new Blob([this.muxer.target.buffer], { type: 'video/mp4' })
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
