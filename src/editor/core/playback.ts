import * as Tone from 'tone'
import { getPlayableUrl } from './audioSource'

type BeatChangeCallback = (beat: number) => void

interface EngineCallbacks {
  onBeatChange: BeatChangeCallback
  getBpm: () => number
  getBeatsPerBar: () => number
  getMaxBeat: () => number
  onEnd: () => void
}

// Shared schedule lookahead (seconds) so the transport and the audio player are
// armed at the same audio-clock time and stay sample-aligned.
const AUDIO_LOOKAHEAD = 0.02

class PlaybackEngine {
  private rafId: number | null = null
  private callbacks: EngineCallbacks | null = null
  private player: Tone.Player | null = null
  private playing = false
  /** The audio ref currently loaded into `player` (null = none). */
  clipRef: string | null = null

  init(callbacks: EngineCallbacks) {
    this.callbacks = callbacks
  }

  /**
   * Load (or swap, or clear) the audio clip. No-op if `ref` is already loaded.
   * Resolves once the buffer is decoded, so callers can await before play().
   */
  async loadAudio(ref: string | null) {
    if (ref === this.clipRef) return
    this.player?.dispose()
    this.player = null
    this.clipRef = ref
    if (!ref) return
    await Tone.start()
    const url = await getPlayableUrl(ref)
    this.player = new Tone.Player(url).toDestination()
    await Tone.loaded()
  }

  async play(startBeat: number) {
    if (!this.callbacks) return
    await Tone.start()
    const bpm = this.callbacks.getBpm()
    const beatsPerBar = this.callbacks.getBeatsPerBar()

    const transport = Tone.getTransport()
    transport.stop()
    transport.bpm.value = bpm

    // Position is the single source of truth — set it, don't add it back later.
    transport.position = beatToPosition(startBeat, beatsPerBar)

    // Arm transport + audio at the same audio-clock time. The audio's in-buffer
    // offset is computed explicitly (file 0:00 == timeline beat 0).
    const when = Tone.now() + AUDIO_LOOKAHEAD
    transport.start(when)
    if (this.player) {
      this.player.stop(when)
      this.player.start(when, startBeat * 60 / bpm)
    }

    this.playing = true
    this.cancelBeatTracking()
    this.startBeatTracking()
  }

  pause() {
    Tone.getTransport().pause()
    this.player?.stop()
    this.playing = false
    this.cancelBeatTracking()
  }

  /** Live tempo change — affects future advancement, keeps the current position. */
  setBpm(bpm: number) {
    Tone.getTransport().bpm.value = bpm
  }

  /** Jump the (possibly playing) transport to a new beat, re-arming audio if live. */
  seek(beat: number) {
    if (!this.callbacks) return
    const bpm = this.callbacks.getBpm()
    const beatsPerBar = this.callbacks.getBeatsPerBar()
    Tone.getTransport().position = beatToPosition(beat, beatsPerBar)
    if (this.playing && this.player) {
      const when = Tone.now() + AUDIO_LOOKAHEAD
      this.player.stop(when)
      this.player.start(when, beat * 60 / bpm)
    }
  }

  private startBeatTracking() {
    const tick = () => {
      if (!this.callbacks) return
      const { onBeatChange, getBeatsPerBar, getMaxBeat, onEnd } = this.callbacks
      const beat = positionToBeat(Tone.getTransport().position, getBeatsPerBar())
      const maxBeat = getMaxBeat()

      if (beat >= maxBeat) {
        Tone.getTransport().stop()
        this.player?.stop()
        this.playing = false
        onBeatChange(maxBeat)
        onEnd()
        return
      }

      onBeatChange(beat)
      this.rafId = requestAnimationFrame(tick)
    }
    this.rafId = requestAnimationFrame(tick)
  }

  private cancelBeatTracking() {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
  }
}

/** beat -> Tone transport position "bars:beats:sixteenths". */
function beatToPosition(beat: number, beatsPerBar: number): string {
  const bars = Math.floor(beat / beatsPerBar)
  const beats = beat % beatsPerBar
  return `${bars}:${beats}:0`
}

/** Tone transport position -> absolute beat (with sub-beat precision). */
function positionToBeat(position: unknown, beatsPerBar: number): number {
  const [bars, beats, sixteenths] = String(position).split(':').map(Number)
  return (bars || 0) * beatsPerBar + (beats || 0) + (sixteenths || 0) / 4
}

let _engine: PlaybackEngine | null = null

export function getPlaybackEngine(): PlaybackEngine {
  if (!_engine) _engine = new PlaybackEngine()
  return _engine
}
