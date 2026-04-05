import * as Tone from 'tone';
import { Project, AudioData, Track } from './types';
import { resolveProject, ResolvedTrack } from './resolution';
import { getInstrument, AudioInstance } from '@daw/instruments';
import { getAudioFile, createAudioBlobUrl, revokeAudioBlobUrl } from '@daw/services/audioStorage';

export type PlaybackState = 'stopped' | 'playing' | 'paused';

export interface PlaybackCallbacks {
  onBeatChange?: (beat: number) => void;
  onStateChange?: (state: PlaybackState) => void;
  onLoop?: () => void;
}

// Track audio instances (keyed by trackId)
interface TrackAudioState {
  instrumentId: string;
  instance: AudioInstance;
}

// Audio player management for audio file playback (keyed by blockId)
interface AudioPlayerState {
  player: Tone.Player;
  blobUrl: string;
}

// Lookahead configuration for tight audio-visual sync
// Lower values = tighter sync but more CPU usage
const AUDIO_LOOKAHEAD_SECONDS = 0.05; // 50ms lookahead for audio scheduling

export class PlaybackEngine {
  private trackAudioStates: Map<string, TrackAudioState> = new Map();
  private audioPlayers: Map<string, AudioPlayerState> = new Map();
  private state: PlaybackState = 'stopped';
  private animationFrame: number | null = null;
  private callbacks: PlaybackCallbacks = {};
  private parts: Tone.Part[] = [];
  private loopRetriggerParts: Tone.Part[] = [];
  private project: Project | null = null;
  private isInitialized = false;
  private loopStartBeat: number | null = null;
  private loopEndBeat: number | null = null;
  private playbackSpeed: number = 1;

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    await Tone.start();

    // Configure Tone.js lookahead for tighter sync
    Tone.getContext().lookAhead = AUDIO_LOOKAHEAD_SECONDS;

    this.isInitialized = true;
  }

  setCallbacks(callbacks: PlaybackCallbacks): void {
    this.callbacks = callbacks;
  }

  async play(project: Project): Promise<void> {
    await this.playFrom(project, 0);
  }

  async playFrom(project: Project, startBeat: number): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    // Clean up any existing playback without resetting beat position
    this.cleanupPlayback();

    this.project = project;
    this.state = 'playing';
    this.callbacks.onStateChange?.('playing');

    // Set BPM (scaled by playback speed)
    Tone.getTransport().bpm.value = project.bpm * this.playbackSpeed;

    // Set starting position before scheduling
    const bars = Math.floor(startBeat / project.beatsPerBar);
    const beats = startBeat % project.beatsPerBar;
    Tone.getTransport().position = `${bars}:${beats}:0`;

    // Resolve project to get all playable events
    const resolvedTracks = resolveProject(project);

    // Create audio instances for each track
    this.createTrackAudioInstances(resolvedTracks);

    // Schedule all events (including audio tracks)
    await this.scheduleEvents(resolvedTracks, project);

    // Ensure all audio buffers are loaded before starting
    await Tone.loaded();

    // Start transport
    Tone.getTransport().start();

    // Start any audio that should already be playing at this position
    if (startBeat > 0) {
      this.startAudioAtPosition(startBeat, project.beatsPerBar);
    }

    // Start beat tracking
    this.startBeatTracking(project);
  }

  private createTrackAudioInstances(resolvedTracks: ResolvedTrack[]): void {
    // Dispose any existing instances first
    this.disposeTrackAudioInstances();

    for (const resolved of resolvedTracks) {
      if (!resolved.instrumentId) continue;

      const instrument = getInstrument(resolved.instrumentId);
      if (!instrument?.hasAudio || !instrument.createAudio) continue;

      // Create audio instance using instrument's createAudio method with track settings
      const instance = instrument.createAudio(resolved.instrumentSettings ?? {});
      this.trackAudioStates.set(resolved.trackId, {
        instrumentId: resolved.instrumentId,
        instance,
      });
    }
  }

  private disposeTrackAudioInstances(): void {
    for (const state of this.trackAudioStates.values()) {
      state.instance.dispose();
    }
    this.trackAudioStates.clear();
  }

  private cleanupPlayback(): void {
    // Stop transport
    Tone.getTransport().stop();

    // Stop all audio players
    this.stopAudioPlayers();

    // Clear loop retrigger parts first so they don't accumulate between loop drags/updates
    this.clearLoopAudioRetriggerParts();

    // Dispose all parts
    for (const part of this.parts) {
      part.dispose();
    }
    this.parts = [];

    // Reset loop tracking
    this.loopStartBeat = null;
    this.loopEndBeat = null;

    // Stop beat tracking
    if (this.animationFrame !== null) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
  }

  private async scheduleEvents(resolvedTracks: ResolvedTrack[], project: Project): Promise<void> {
    const totalBeats = project.totalBars * project.beatsPerBar;

    // Clear any existing audio players from previous playback
    this.clearAudioPlayers();

    for (const resolved of resolvedTracks) {
      if (!resolved.instrumentId) continue;

      const instrument = getInstrument(resolved.instrumentId);
      if (!instrument) continue;

      // Handle audio file playback tracks (audioPlayer instrument)
      if (resolved.instrumentId === 'audioPlayer') {
        await this.scheduleAudioTrack(resolved.trackId, project);
        continue;
      }

      // Skip if instrument doesn't have audio or scheduleNote
      if (!instrument.hasAudio || !instrument.scheduleNote) continue;

      // Get the audio instance for this track
      const audioState = this.trackAudioStates.get(resolved.trackId);
      if (!audioState) continue;

      // Filter events within bounds and not within blackout regions
      const blackoutRegions = resolved.blackoutRegions ?? [];
      const isBlackedOut = (beatTime: number): boolean =>
        blackoutRegions.some(r => beatTime >= r.startBeat && beatTime < r.endBeat);

      const partEvents = resolved.output.events
        .filter(event => event.startTimeInBeats < totalBeats && !isBlackedOut(event.startTimeInBeats))
        .map(event => ({
          time: `${Math.floor(event.startTimeInBeats / project.beatsPerBar)}:${event.startTimeInBeats % project.beatsPerBar}`,
          event,
        }));

      if (partEvents.length === 0) continue;

      // Create a Tone.Part for this track - handles lookahead scheduling automatically
      const part = new Tone.Part((time, { event }) => {
        instrument.scheduleNote!(audioState.instance, event, time);
      }, partEvents);

      part.start(0);
      part.loop = true;
      part.loopEnd = `${project.totalBars}:0`;

      this.parts.push(part);
    }

    // Schedule automation lanes
    for (const resolved of resolvedTracks) {
      if (!resolved.automationLanes?.length || !resolved.instrumentId) continue;

      const instrument = getInstrument(resolved.instrumentId);
      if (!instrument?.updateParam) continue;

      const audioState = this.trackAudioStates.get(resolved.trackId);
      if (!audioState) continue;

      for (const lane of resolved.automationLanes) {
        if (lane.keyframes.length === 0) continue;

        const partEvents = lane.keyframes.map((kf, i) => ({
          time: `${Math.floor(kf.beatTime / project.beatsPerBar)}:${kf.beatTime % project.beatsPerBar}`,
          value: kf.value,
          // For interpolation: include next keyframe info
          nextValue: lane.interpolate && i < lane.keyframes.length - 1 ? lane.keyframes[i + 1].value : undefined,
          nextTime: lane.interpolate && i < lane.keyframes.length - 1 ? lane.keyframes[i + 1].beatTime : undefined,
          currentTime: kf.beatTime,
        }));

        const part = new Tone.Part((time, data) => {
          if (lane.interpolate && data.nextValue !== undefined && data.nextTime !== undefined) {
            // Schedule instant set + ramp to next value
            instrument.updateParam!(audioState.instance, lane.paramKey, data.value);
            const durationBeats = data.nextTime - data.currentTime;
            const durationSeconds = (durationBeats / project.bpm) * 60;
            // Use setTimeout to approximate ramp (Tone.js rampTo on raw values)
            // For more precision, instruments can implement rampTo internally
            // For now, set the value at each keyframe
          } else {
            instrument.updateParam!(audioState.instance, lane.paramKey, data.value);
          }
        }, partEvents);

        part.start(0);
        part.loop = true;
        part.loopEnd = `${project.totalBars}:0`;
        this.parts.push(part);
      }
    }

    // Configure transport loop
    Tone.getTransport().loop = true;
    Tone.getTransport().loopEnd = `${project.totalBars}:0`;
    Tone.getTransport().loopStart = 0;
  }

  private isAudioTrackSkipped(track: Track, project: Project): boolean {
    if (track.muted) return true;
    // Check solo among siblings
    const siblingIds = track.parentId
      ? project.tracks[track.parentId]?.childIds ?? []
      : project.rootTracks;
    const anySoloed = siblingIds.some(id => project.tracks[id]?.solo);
    if (anySoloed && !track.solo) return true;
    return false;
  }

  private async scheduleAudioTrack(trackId: string, project: Project): Promise<void> {
    const track = project.tracks[trackId];
    if (!track || this.isAudioTrackSkipped(track, project)) return;

    for (const block of track.blocks) {
      if (!block.audioData) continue;

      try {
        // Get or create the player for this block
        const playerState = await this.getOrCreateAudioPlayer(block.id, block.audioData);

        // Skip if audio couldn't be loaded
        if (!playerState) {
          console.warn(`Skipping audio block ${block.id} - audio not found`);
          continue;
        }

        const { player } = playerState;

        // Calculate timing
        const startTime = `${block.startBar}:0:0`;
        const endBar = block.startBar + block.durationBars;
        const endTime = `${endBar}:0:0`;

        const audioOffset = block.audioOffset ?? 0;

        // Configure looping
        if (block.loop) {
          player.loop = true;
          player.loopStart = audioOffset;
          player.loopEnd = block.audioData.duration;
        } else {
          player.loop = false;
        }

        // Schedule player start
        const startPart = new Tone.Part((time) => {
          // Stop first in case it's already playing (from loop)
          player.stop(time);
          player.start(time, audioOffset);
        }, [{ time: startTime }]);

        startPart.start(0);
        startPart.loop = true;
        startPart.loopEnd = `${project.totalBars}:0`;
        this.parts.push(startPart);

        // Schedule player stop at block end
        const stopPart = new Tone.Part((time) => {
          player.stop(time);
        }, [{ time: endTime }]);

        stopPart.start(0);
        stopPart.loop = true;
        stopPart.loopEnd = `${project.totalBars}:0`;
        this.parts.push(stopPart);

      } catch (error) {
        console.error(`Error scheduling audio block ${block.id}:`, error);
      }
    }
  }

  private async getOrCreateAudioPlayer(blockId: string, audioData: AudioData): Promise<AudioPlayerState | null> {
    // Return existing player if available
    if (this.audioPlayers.has(blockId)) {
      return this.audioPlayers.get(blockId)!;
    }

    // Load audio from IndexedDB
    const stored = await getAudioFile(audioData.storageId);
    if (!stored) {
      console.error(`Audio file not found in storage: ${audioData.storageId}`);
      return null;
    }

    // Create blob URL for the player
    const blobUrl = createAudioBlobUrl(stored.blob);

    // Create and load player
    const player = new Tone.Player(blobUrl).toDestination();
    player.volume.value = -6; // Match synth levels
    player.playbackRate = this.playbackSpeed;

    // Wait for buffer to load
    await Tone.loaded();

    const state: AudioPlayerState = { player, blobUrl };
    this.audioPlayers.set(blockId, state);
    return state;
  }

  private stopAudioPlayers(): void {
    for (const { player } of this.audioPlayers.values()) {
      player.stop();
    }
  }

  private clearAudioPlayers(): void {
    for (const { player, blobUrl } of this.audioPlayers.values()) {
      player.stop();
      player.dispose();
      revokeAudioBlobUrl(blobUrl);
    }
    this.audioPlayers.clear();
  }

  private startBeatTracking(project: Project): void {
    const update = () => {
      if (this.state !== 'playing') return;

      const position = Tone.getTransport().position;
      const [bars, beats, sixteenths] = String(position).split(':').map(Number);
      // Include sixteenths for smooth sub-beat movement
      const currentBeat = (bars || 0) * project.beatsPerBar + (beats || 0) + (sixteenths || 0) / 4;

      // Transport handles loop wrapping natively, so just report the position directly
      this.callbacks.onBeatChange?.(currentBeat);

      this.animationFrame = requestAnimationFrame(update);
    };

    this.animationFrame = requestAnimationFrame(update);
  }

  stop(): void {
    this.state = 'stopped';
    this.callbacks.onStateChange?.('stopped');

    // Stop transport
    Tone.getTransport().stop();
    Tone.getTransport().position = 0;

    // Stop all audio players immediately
    this.stopAudioPlayers();

    // Remove loop retrigger parts before disposing the rest
    this.clearLoopAudioRetriggerParts();

    // Dispose all parts
    for (const part of this.parts) {
      part.dispose();
    }
    this.parts = [];

    // Dispose track audio instances
    this.disposeTrackAudioInstances();

    // Stop beat tracking
    if (this.animationFrame !== null) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }

    this.callbacks.onBeatChange?.(0);
  }

  pause(): void {
    if (this.state !== 'playing') return;

    this.state = 'paused';
    this.callbacks.onStateChange?.('paused');
    Tone.getTransport().pause();

    // Stop audio players (they'll be re-triggered on resume via transport)
    this.stopAudioPlayers();

    if (this.animationFrame !== null) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
  }

  resume(): void {
    if (this.state !== 'paused' || !this.project) return;

    this.state = 'playing';
    this.callbacks.onStateChange?.('playing');
    Tone.getTransport().start();
    this.startBeatTracking(this.project);
  }

  getState(): PlaybackState {
    return this.state;
  }

  getCurrentBeat(): number {
    if (!this.project) return 0;

    const position = Tone.getTransport().position;
    // Position format is "bars:beats:sixteenths" - must include sixteenths for sub-beat precision
    const [bars, beats, sixteenths] = String(position).split(':').map(Number);
    // 4 sixteenths per beat in standard time
    return (bars || 0) * this.project.beatsPerBar + (beats || 0) + (sixteenths || 0) / 4;
  }

  setBpm(bpm: number): void {
    Tone.getTransport().bpm.value = bpm * this.playbackSpeed;
  }

  setPlaybackSpeed(speed: number): void {
    this.playbackSpeed = speed;

    // Update transport BPM with speed factor
    if (this.project) {
      Tone.getTransport().bpm.value = this.project.bpm * speed;
    }

    // Update all active audio players' playback rate
    for (const { player } of this.audioPlayers.values()) {
      player.playbackRate = speed;
    }
  }

  seekTo(beat: number, beatsPerBar: number): void {
    const bars = Math.floor(beat / beatsPerBar);
    const beats = beat % beatsPerBar;

    // Stop audio players so they can be re-triggered at the new position
    this.stopAudioPlayers();

    Tone.getTransport().position = `${bars}:${beats}:0`;

    // If playing, start any audio blocks that should be active at this position
    if (this.state === 'playing' && this.project) {
      this.startAudioAtPosition(beat, beatsPerBar);
    }

    this.callbacks.onBeatChange?.(beat);
  }

  private startAudioAtPosition(beat: number, beatsPerBar: number): void {
    if (!this.project) return;

    const bpm = this.project.bpm;
    const secondsPerBeat = 60 / bpm;

    for (const trackId of Object.keys(this.project.tracks)) {
      const track = this.project.tracks[trackId];
      if (!track || track.instrumentId !== 'audioPlayer' || this.isAudioTrackSkipped(track, this.project)) continue;

      for (const block of track.blocks) {
        if (!block.audioData) continue;

        const blockStartBeat = block.startBar * beatsPerBar;
        const blockEndBeat = (block.startBar + block.durationBars) * beatsPerBar;

        // Check if the seek position is within this block
        if (beat >= blockStartBeat && beat < blockEndBeat) {
          const playerState = this.audioPlayers.get(block.id);
          if (!playerState) continue;

          // Calculate offset into the audio file
          const blockAudioOffset = block.audioOffset ?? 0;
          const beatsIntoBlock = beat - blockStartBeat;
          const secondsIntoBlock = beatsIntoBlock * secondsPerBeat;

          // Handle looping audio - wrap the offset
          let seekOffset = blockAudioOffset + secondsIntoBlock;
          if (block.loop && block.audioData.duration > 0) {
            const loopLength = block.audioData.duration - blockAudioOffset;
            if (loopLength > 0) {
              seekOffset = blockAudioOffset + (secondsIntoBlock % loopLength);
            }
          }

          // Start playback from the calculated offset
          playerState.player.start(Tone.now(), seekOffset);
        }
      }
    }
  }

  setLoopRegion(startBeat: number | null, endBeat: number | null, beatsPerBar: number): void {
    const transport = Tone.getTransport();

    if (startBeat === null || endBeat === null || startBeat === endBeat) {
      // Clear loop region - restore full project loop
      this.loopStartBeat = null;
      this.loopEndBeat = null;
      this.clearLoopAudioRetriggerParts();
      if (this.project) {
        transport.loopStart = 0;
        transport.loopEnd = `${this.project.totalBars}:0`;
      }
      return;
    }

    const isSameRegion = this.loopStartBeat === startBeat && this.loopEndBeat === endBeat;
    this.loopStartBeat = startBeat;
    this.loopEndBeat = endBeat;

    // Set custom loop region
    const startBars = Math.floor(startBeat / beatsPerBar);
    const startBeats = startBeat % beatsPerBar;
    const endBars = Math.floor(endBeat / beatsPerBar);
    const endBeats = endBeat % beatsPerBar;

    transport.loopStart = `${startBars}:${startBeats}:0`;
    transport.loopEnd = `${endBars}:${endBeats}:0`;

    // No-op if loop bounds didn't change (common during pointermove with quantized values)
    if (isSameRegion) return;

    // Loop bounds changed: replace previous retriggers instead of appending endlessly.
    this.clearLoopAudioRetriggerParts();

    // Schedule audio re-triggering at loop start point so audio blocks
    // that start before the loop region still play when the loop wraps
    this.scheduleLoopAudioRetrigger(startBeat, beatsPerBar);
  }

  private clearLoopAudioRetriggerParts(): void {
    if (this.loopRetriggerParts.length === 0) return;

    const retriggerSet = new Set(this.loopRetriggerParts);
    for (const part of this.loopRetriggerParts) {
      part.dispose();
    }
    this.loopRetriggerParts = [];
    this.parts = this.parts.filter((part) => !retriggerSet.has(part));
  }

  private scheduleLoopAudioRetrigger(loopStartBeat: number, beatsPerBar: number): void {
    if (!this.project) return;

    const loopStartBars = Math.floor(loopStartBeat / beatsPerBar);
    const loopStartBeats = loopStartBeat % beatsPerBar;
    const loopStartTime = `${loopStartBars}:${loopStartBeats}:0`;

    for (const trackId of Object.keys(this.project.tracks)) {
      const track = this.project.tracks[trackId];
      if (!track || track.instrumentId !== 'audioPlayer' || this.isAudioTrackSkipped(track, this.project)) continue;

      for (const block of track.blocks) {
        if (!block.audioData) continue;

        const blockStartBeat = block.startBar * beatsPerBar;
        const blockEndBeat = (block.startBar + block.durationBars) * beatsPerBar;

        // If block spans the loop start point (starts before loop start, ends after it),
        // schedule a re-trigger at loop start
        if (blockStartBeat < loopStartBeat && blockEndBeat > loopStartBeat) {
          const playerState = this.audioPlayers.get(block.id);
          if (!playerState) continue;

          const blockAudioOffset = block.audioOffset ?? 0;
          const beatsIntoBlock = loopStartBeat - blockStartBeat;
          const secondsPerBeat = 60 / this.project.bpm;
          const secondsIntoBlock = beatsIntoBlock * secondsPerBeat;

          let seekOffset = blockAudioOffset + secondsIntoBlock;
          if (block.loop && block.audioData.duration > 0) {
            const loopLength = block.audioData.duration - blockAudioOffset;
            if (loopLength > 0) {
              seekOffset = blockAudioOffset + (secondsIntoBlock % loopLength);
            }
          }

          // Schedule audio restart at loop start
          const retriggerPart = new Tone.Part((time) => {
            playerState.player.stop(time);
            playerState.player.start(time, seekOffset);
          }, [{ time: loopStartTime }]);

          retriggerPart.start(0);
          retriggerPart.loop = true;
          retriggerPart.loopEnd = `${this.project.totalBars}:0`;
          this.loopRetriggerParts.push(retriggerPart);
          this.parts.push(retriggerPart);
        }
      }
    }
  }

  dispose(): void {
    this.stop();

    // Clear audio players
    this.clearAudioPlayers();

    this.isInitialized = false;
  }
}

// Singleton instance
let playbackEngine: PlaybackEngine | null = null;

export function getPlaybackEngine(): PlaybackEngine {
  if (!playbackEngine) {
    playbackEngine = new PlaybackEngine();
  }
  return playbackEngine;
}

export function disposePlaybackEngine(): void {
  if (playbackEngine) {
    playbackEngine.dispose();
    playbackEngine = null;
  }
}
