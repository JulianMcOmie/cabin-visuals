import * as Tone from 'tone'
import type { AudioBlock, Track } from '../../types'
import { getBuffer } from './waveform'
import { blockPlacement } from './placement'

// The audio engine: everything that makes sound, behind one door. A module
// singleton beside the transport (core/playback.ts) and the visual engine
// (core/visual/), consuming the beat DISCRETELY: players are armed at transport
// events (play / seek / bpm change) and Tone's own clock carries them between -
// no per-frame work.
//
// The one guardrail: this engine has NO clock of its own. `when` - the Web
// Audio spec's name for an absolute audio-clock timestamp (seconds since the
// AudioContext started) - is always computed by the transport and passed in.
// One shared anchor is what keeps N players and the transport sample-aligned;
// this file never calls Tone.now() to schedule.

interface Entry {
  player: Tone.Player
  /** The clip the player's buffer was built from - rebuilt if the block is retargeted. */
  ref: string
  loaded: boolean
}

/** A block plus its track's audibility (mute/solo folded in at gather time). */
interface ScheduledBlock {
  block: AudioBlock
  audible: boolean
}

class AudioEngine {
  private entries = new Map<string, Entry>()
  private blocks: ScheduledBlock[] = []
  private masterGain: Tone.Gain | null = null

  // Modest headroom: overlapping clips sum at the destination and can clip.
  // Also the future seam for per-block gain / fades.
  private gain(): Tone.Gain {
    if (!this.masterGain) this.masterGain = new Tone.Gain(0.85).toDestination()
    return this.masterGain
  }

  /**
   * Hand the engine the current audio tracks. Reconciles the per-block player
   * pool (dispose orphans, create newcomers) and folds mute/solo into each
   * block's audibility - the same semantics the visual engine applies to hide
   * objects. Buffers load lazily (loadClips) but are kicked off here too, so a
   * block insert pre-decodes before play() ever needs it.
   */
  setBlocks(audioTracks: Track[]) {
    const anySolo = audioTracks.some((t) => t.solo)
    this.blocks = []
    const live = new Set<string>()
    for (const t of audioTracks) {
      const audible = !t.muted && !(anySolo && !t.solo)
      for (const b of t.audioBlocks ?? []) {
        this.blocks.push({ block: b, audible })
        live.add(b.id)
      }
    }
    for (const [id, e] of this.entries) {
      if (!live.has(id)) {
        e.player.dispose()
        this.entries.delete(id)
      }
    }
    void this.loadClips()
  }

  /** Ensure every block has a player with a decoded buffer (decode-once per ref). */
  async loadClips(): Promise<void> {
    await Promise.all(
      this.blocks.map(async ({ block }) => {
        const existing = this.entries.get(block.id)
        if (existing && existing.ref === block.clipRef) return
        existing?.player.dispose()
        const entry: Entry = { player: new Tone.Player().connect(this.gain()), ref: block.clipRef, loaded: false }
        this.entries.set(block.id, entry)
        try {
          const buffer = await getBuffer(block.clipRef)
          // The block may have been retargeted/deleted while decoding.
          if (this.entries.get(block.id) !== entry) return
          entry.player.buffer = new Tone.ToneAudioBuffer(buffer)
          entry.loaded = true
        } catch (err) {
          console.error('Failed to load audio clip', block.clipRef, err)
        }
      }),
    )
  }

  /**
   * Arm one player at a transport event. The three-case beat⟷second math lives
   * in placement.ts (shared with the offline export render - they cannot
   * diverge); play, seek, and the bpm re-arm all come through here.
   */
  private armBlock(sb: ScheduledBlock, atBeat: number, when: number, bpm: number, beatsPerBar: number) {
    const entry = this.entries.get(sb.block.id)
    if (!entry || !entry.loaded) return
    const { player } = entry

    player.stop(when)
    if (!sb.audible) return

    const p = blockPlacement(sb.block, atBeat, bpm, beatsPerBar)
    if (!p) return // past - leave idle
    player.start(when + p.delaySec, p.offset, p.duration)
  }

  /** Re-window every block at `atBeat`, all against the same `when` anchor. */
  armAll(atBeat: number, when: number, bpm: number, beatsPerBar: number) {
    for (const sb of this.blocks) this.armBlock(sb, atBeat, when, bpm, beatsPerBar)
  }

  /** Silence everything (pause / end of project). */
  stopAll(when?: number) {
    for (const e of this.entries.values()) {
      if (when === undefined) e.player.stop()
      else e.player.stop(when)
    }
  }
}

let _audioEngine: AudioEngine | null = null

export function getAudioEngine(): AudioEngine {
  if (!_audioEngine) _audioEngine = new AudioEngine()
  return _audioEngine
}
