import { execFileSync } from 'child_process'
import fs from 'fs'
import type { ProjectDocument } from '../../../src/persistence/types'
import { refToFile } from './paths'

// Audio for clips and renders: the project's audio tracks, mixed by ffmpeg with
// the same placement the editor uses (block start bar, trim in/out, gain), then
// cut to the rendered range.

export function probeDuration(file: string): number {
  const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file], { encoding: 'utf8' })
  const d = Number(out.trim())
  if (!Number.isFinite(d)) throw new Error(`ffprobe could not read a duration from ${file}`)
  return d
}

export interface AudioMix {
  /** ffmpeg input args (-i ... per source). */
  inputs: string[]
  /** -filter_complex graph producing [aout]. */
  filter: string
}

/**
 * The mix for [fromSec, fromSec + durSec) of the timeline, or null when the
 * project has no playable audio. `firstInput` is the ffmpeg input index the
 * first audio source will get (video is usually input 0).
 */
export function audioMix(doc: ProjectDocument, project: string, fromSec: number, durSec: number, firstInput = 1): AudioMix | null {
  const secPerBar = (60 / doc.bpm) * doc.beatsPerBar
  const inputs: string[] = []
  const chains: string[] = []
  let k = 0
  for (const id of doc.audioRootTrackIds) {
    const t = doc.audioTracks[id]
    if (!t || t.muted) continue
    for (const b of t.audioBlocks ?? []) {
      const file = refToFile(project, b.clipRef)
      if (!file || !fs.existsSync(file)) continue
      const startSec = b.startBar * secPerBar
      const len = Math.max(0, b.trimEnd - b.trimStart)
      // the part of this block inside the rendered window
      const s = Math.max(fromSec, startSec)
      const e = Math.min(fromSec + durSec, startSec + len)
      if (e <= s) continue
      const srcIn = b.trimStart + (s - startSec)
      const delayMs = Math.round((s - fromSec) * 1000)
      inputs.push('-i', file)
      const idx = firstInput + k
      chains.push(`[${idx}:a]atrim=start=${srcIn.toFixed(4)}:duration=${(e - s).toFixed(4)},asetpts=PTS-STARTPTS,volume=${b.gain ?? 1},adelay=${delayMs}|${delayMs}[a${k}]`)
      k++
    }
  }
  if (k === 0) return null
  const mix = k === 1 ? `[a0]apad,atrim=duration=${durSec.toFixed(4)}[aout]` : `${Array.from({ length: k }, (_, i) => `[a${i}]`).join('')}amix=inputs=${k}:normalize=0,apad,atrim=duration=${durSec.toFixed(4)}[aout]`
  return { inputs, filter: [...chains, mix].join(';') }
}
