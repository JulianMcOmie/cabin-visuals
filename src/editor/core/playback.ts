import * as Tone from 'tone'
import { getAudioEngine } from './audio/AudioEngine'
import { shouldLoopWrap, type LoopRegion } from './loopRegion'
import { effectiveBpm } from './playbackRate'

type BeatChangeCallback = (beat: number) => void

interface EngineCallbacks {
  onBeatChange: BeatChangeCallback
  getBpm: () => number
  getBeatsPerBar: () => number
  getMaxBeat: () => number
  getLoopRegion: () => LoopRegion | null
  getPlaybackRate: () => number
  onEnd: () => void
}

// Shared schedule lookahead (seconds): the transport and every audio player are
// armed at the same audio-clock `when`, so they stay sample-aligned. 50ms (up
// from 20ms) gives the N-player arming loop comfortable margin against downbeat
// jitter.
const AUDIO_LOOKAHEAD = 0.05

// Tone's transport position cannot go negative, but musical beats can: audio
// dragged into the pickup region starts before bar 0. A large constant origin
// (transport bar 1024 = musical bar 0) maps every reachable negative beat onto
// a positive transport position. Constant on purpose - deriving the offset from
// the live pickup would move the mapping under a playing transport every time a
// drag grows the pickup.
const TRANSPORT_ORIGIN_BARS = 1024

/**
 * The TRANSPORT engine: the Tone transport and the RAF beat clock - the sole
 * producer of the beat and of the shared `when` anchor. Audio playback lives in
 * the audio engine (core/audio/), which this hands (beat, when) at every
 * transport event; visuals live in core/visual/, reading the beat per frame.
 */
class PlaybackEngine {
  private rafId: number | null = null
  private callbacks: EngineCallbacks | null = null
  private playing = false
  private lastTrackedBeat: number | null = null
  private bpmDragging = false
  private blockDragging = false

  init(callbacks: EngineCallbacks) {
    this.callbacks = callbacks
  }

  async play(startBeat: number) {
    if (!this.callbacks) return
    await Tone.start()
    const bpm = this.callbacks.getBpm()
    const beatsPerBar = this.callbacks.getBeatsPerBar()
    const rate = this.rate()

    const transport = Tone.getTransport()
    transport.stop()
    transport.bpm.value = effectiveBpm(bpm, rate)

    // Position is the single source of truth - set it, don't add it back later.
    transport.position = beatToPosition(startBeat, beatsPerBar)

    // Arm transport + every audio block at the same audio-clock time.
    const when = Tone.now() + AUDIO_LOOKAHEAD
    transport.start(when)
    getAudioEngine().armAll(startBeat, when, bpm, beatsPerBar, rate)

    this.playing = true
    this.lastTrackedBeat = startBeat
    this.cancelBeatTracking()
    this.startBeatTracking()
  }

  pause() {
    Tone.getTransport().pause()
    getAudioEngine().stopAll()
    this.playing = false
    this.lastTrackedBeat = null
    this.cancelBeatTracking()
  }

  /** The current monitoring speed (1 when nothing has been wired yet). */
  private rate(): number {
    return this.callbacks?.getPlaybackRate() ?? 1
  }

  /** Live tempo change: future advancement changes, the position doesn't. Every
   *  audio block's beat window just moved (fixed seconds, new beat mapping), so
   *  re-arm while playing. Audio never time-stretches - it re-anchors.
   *  During a BPM drag the re-arm is deferred to endBpmDrag (see beginBpmDrag). */
  setBpm(bpm: number) {
    Tone.getTransport().bpm.value = effectiveBpm(bpm, this.rate())
    if (this.bpmDragging) return
    if (this.playing && this.callbacks) {
      const beatsPerBar = this.callbacks.getBeatsPerBar()
      const beat = positionToBeat(Tone.getTransport().position, beatsPerBar)
      const when = Tone.now() + AUDIO_LOOKAHEAD
      getAudioEngine().armAll(beat, when, bpm, beatsPerBar, this.rate())
    }
  }

  /**
   * Shift monitoring gear (½× / ¼× / back to 1×). Retunes the transport - so the
   * playhead, visuals and MIDI all crawl together - and re-arms audio at the new
   * rate, which is what makes the clips slow down (and drop in pitch) with them
   * instead of running on at natural speed against a slowed grid.
   *
   * The re-arm is REQUIRED, not just a refresh: a player's stop was scheduled in
   * wall-clock seconds computed at the old rate, so retuning alone would leave
   * every sounding clip ending in the wrong place. This is one discrete change
   * per click, the same shape as endBpmDrag's single re-arm - never a per-move
   * gesture, so it cannot stack (see beginBpmDrag).
   */
  setPlaybackRate(rate: number) {
    if (!this.callbacks) return
    Tone.getTransport().bpm.value = effectiveBpm(this.callbacks.getBpm(), rate)
    this.rearmAudio()
  }

  /** Let sounding audio ride out a BPM drag untouched: each move only retunes
   *  the transport - so the playhead and visuals track the new tempo live -
   *  while in-flight players, which are never synced to the transport and were
   *  armed against absolute audio-clock seconds, keep playing at their natural
   *  rate. The release re-arms once to re-anchor them.
   *
   *  The per-move re-arm is what has to go, not the sound: each armAll queues a
   *  fresh set of clip starts, and at pointermove rates they stack inside the
   *  lookahead window into a runaway gain sum (the BPM-drag "earrape"). One
   *  re-arm at release is the same one-shot seek() already performs safely.
   *
   *  The tradeoff: audio drifts out of alignment with the playhead for the
   *  length of the gesture, and re-anchoring at release is audible as a jump.
   *  Audio never time-stretches here - it re-anchors - so that seam is
   *  inherent; this just spends it once instead of on every move. */
  beginBpmDrag() {
    this.bpmDragging = true
  }

  /** End a BPM drag: re-arm once at the final tempo (no-op if not playing). */
  endBpmDrag() {
    this.bpmDragging = false
    this.rearmAudio()
  }

  /** Jump the (possibly playing) transport to a new beat, re-arming audio if live. */
  seek(beat: number) {
    if (!this.callbacks) return
    const bpm = this.callbacks.getBpm()
    const beatsPerBar = this.callbacks.getBeatsPerBar()
    Tone.getTransport().position = beatToPosition(beat, beatsPerBar)
    this.lastTrackedBeat = beat
    if (this.playing) {
      const when = Tone.now() + AUDIO_LOOKAHEAD
      getAudioEngine().armAll(beat, when, bpm, beatsPerBar, this.rate())
    }
  }

  /** Silence audio for the length of an audio-block drag - move or trim alike -
   *  the same trade the scrub makes. Every pointermove writes the block, and the
   *  store subscription re-arms every block on each write; those re-arms restart
   *  the same audio at nearly the same offset and stack inside the lookahead
   *  window into a runaway gain sum - the drag "earrape". The release re-arms
   *  once, exactly as endBpmDrag does. */
  beginBlockDrag() {
    this.blockDragging = true
    if (this.playing) getAudioEngine().stopAll()
  }

  /** End a block drag: re-arm once at the final position (no-op if not playing). */
  endBlockDrag() {
    this.blockDragging = false
    this.rearmAudio()
  }

  /** The AUDIBLE audio-block drag (sync mode): playback keeps sounding so the
   *  drag can be tuned by ear. Like beginBlockDrag this suppresses the store
   *  subscription's per-move re-arm (the earrape source) - but does NOT silence.
   *  Fresh audio arrives through the two safe, bounded channels instead: the
   *  loop wrap's seek() each pass, and the gesture's debounced forceRearm.
   *  Ended by the same endBlockDrag as the silent variant. */
  beginSyncDrag() {
    this.blockDragging = true
  }

  /** One deliberate re-arm DURING a sync drag (debounced by the caller - a
   *  single re-arm is safe, only per-pointermove stacks are not). */
  forceRearm() {
    if (!this.playing || !this.callbacks) return
    const bpm = this.callbacks.getBpm()
    const beatsPerBar = this.callbacks.getBeatsPerBar()
    const beat = positionToBeat(Tone.getTransport().position, beatsPerBar)
    const when = Tone.now() + AUDIO_LOOKAHEAD
    getAudioEngine().armAll(beat, when, bpm, beatsPerBar, this.rate())
  }

  /** Silence audio for the duration of a scrub. The transport keeps running so the
   *  playhead still follows the drag; each move uses scrubSeek (no re-arm) and the
   *  release calls seek() to resume. Re-arming on every move instead would stack
   *  many overlapping clip fragments within the lookahead window into a runaway
   *  gain sum - the scrub "earrape". */
  beginScrub() {
    if (this.playing) getAudioEngine().stopAll()
  }

  /** Move the playhead during a scrub WITHOUT re-arming audio (see beginScrub). */
  scrubSeek(beat: number) {
    if (!this.callbacks) return
    Tone.getTransport().position = beatToPosition(beat, this.callbacks.getBeatsPerBar())
    this.lastTrackedBeat = beat
  }

  /** Arm ONE block at the current position - the late-join path: a clip whose
   *  buffer finished loading after play() started (first play of a freshly
   *  hydrated project, or a failed fetch retried). Scoped to a single player so
   *  a burst of load completions can't stop/start clips that are already
   *  sounding; a per-clip arm never stacks starts of the same audio, so the
   *  drag-suppression concern doesn't apply beyond the usual blockDragging
   *  window. */
  rearmBlock(blockId: string) {
    if (!this.playing || !this.callbacks || this.blockDragging) return
    const bpm = this.callbacks.getBpm()
    const beatsPerBar = this.callbacks.getBeatsPerBar()
    const beat = positionToBeat(Tone.getTransport().position, beatsPerBar)
    const when = Tone.now() + AUDIO_LOOKAHEAD
    getAudioEngine().armOne(blockId, beat, when, bpm, beatsPerBar, this.rate())
  }

  /** Re-arm audio at the current position (block edits / mute toggles while playing).
   *  Suppressed mid-drag - that gesture's own release re-arms (see beginBlockDrag). */
  rearmAudio() {
    if (!this.playing || !this.callbacks || this.blockDragging) return
    const bpm = this.callbacks.getBpm()
    const beatsPerBar = this.callbacks.getBeatsPerBar()
    const beat = positionToBeat(Tone.getTransport().position, beatsPerBar)
    const when = Tone.now() + AUDIO_LOOKAHEAD
    getAudioEngine().armAll(beat, when, bpm, beatsPerBar, this.rate())
  }

  private startBeatTracking() {
    const tick = () => {
      if (!this.callbacks) return
      const { onBeatChange, getBeatsPerBar, getMaxBeat, getLoopRegion, onEnd } = this.callbacks
      const beat = positionToBeat(Tone.getTransport().position, getBeatsPerBar())
      const previousBeat = this.lastTrackedBeat ?? beat
      this.lastTrackedBeat = beat
      const maxBeat = getMaxBeat()

      // Loop-region wrap, checked before the end-of-timeline stop so a region
      // ending at maxBeat loops instead of stopping. This lives only in the
      // live RAF tick - export drives beats through the beat override and
      // never runs this loop, so exports walk straight through the region.
      const region = getLoopRegion()
      if (region && shouldLoopWrap(previousBeat, beat, region)) {
        this.seek(region.startBeat)
        onBeatChange(region.startBeat)
        // Same zombie guard as below: an onBeatChange subscriber may pause().
        if (!this.playing) return
        this.rafId = requestAnimationFrame(tick)
        return
      }

      if (beat >= maxBeat) {
        Tone.getTransport().stop()
        getAudioEngine().stopAll()
        this.playing = false
        this.lastTrackedBeat = null
        onBeatChange(maxBeat)
        onEnd()
        return
      }

      onBeatChange(beat)
      // An onBeatChange subscriber may pause() DURING this tick (the tutorial's
      // pass-the-block watcher does). That cancels rafId, but this callback is
      // already running - rescheduling unconditionally would resurrect the loop
      // as a zombie that pins currentBeat to the paused transport's position
      // every frame (scrubbing appears locked until the next play).
      if (!this.playing) return
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

/** Musical beat -> Tone transport position "bars:beats:sixteenths" (origin-shifted). */
function beatToPosition(beat: number, beatsPerBar: number): string {
  const shifted = Math.max(0, beat + TRANSPORT_ORIGIN_BARS * beatsPerBar)
  const bars = Math.floor(shifted / beatsPerBar)
  const beats = shifted % beatsPerBar
  return `${bars}:${beats}:0`
}

/** Tone transport position -> absolute musical beat (with sub-beat precision). */
function positionToBeat(position: unknown, beatsPerBar: number): number {
  const [bars, beats, sixteenths] = String(position).split(':').map(Number)
  return (bars || 0) * beatsPerBar + (beats || 0) + (sixteenths || 0) / 4
    - TRANSPORT_ORIGIN_BARS * beatsPerBar
}

let _engine: PlaybackEngine | null = null

export function getPlaybackEngine(): PlaybackEngine {
  if (!_engine) _engine = new PlaybackEngine()
  return _engine
}
