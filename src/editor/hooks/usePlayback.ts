import { useCallback, useEffect } from "react";
import { getPlaybackEngine } from '../core/playback';
import { getAudioEngine } from '../core/audio/AudioEngine';
import { useTimeStore } from '../store/TimeStore';
import { useProjectStore } from '../store/ProjectStore';
import type { Track } from '../types';

/** The current audio tracks (the engine folds mute/solo per track). */
function gatherAudioTracks(tracks: Record<string, Track>): Track[] {
  return Object.values(tracks).filter((t) => t.type === 'audio')
}

export function usePlayback() {
  // Selector on the stable action, NOT `useTimeStore()` bare: selectorless
  // zustand subscribes to the WHOLE store, re-rendering the caller on every
  // currentBeat tick (60/s while playing). Harmless when Header (already
  // beat-subscribed) was the only caller; catastrophic once EditorApp - the
  // editor's root - started calling this hook, re-rendering the entire tree
  // every frame of playback.
  const setIsPlaying = useTimeStore((s) => s.setIsPlaying);
  const engine = getPlaybackEngine();

  useEffect(() => {
    engine.init({
      onBeatChange: (beat) => useTimeStore.getState().setCurrentBeat(beat),
      getBpm: () => useProjectStore.getState().bpm,
      getBeatsPerBar: () => useProjectStore.getState().beatsPerBar,
      getMaxBeat: () => {
        const { totalBars, beatsPerBar } = useProjectStore.getState()
        return totalBars * beatsPerBar
      },
      getLoopRegion: () => useTimeStore.getState().loopRegion,
      onEnd: () => setIsPlaying(false),
    });

    // Seed the audio engine, then keep it fed: block/track edits reconcile the
    // player pool (and pre-decode on insert); while playing they also re-arm,
    // so dragging a block or toggling mute reschedules the audio live. The
    // subscription lives HERE (not in the audio engine) so the engine stays
    // store-free.
    const audio = getAudioEngine()
    let prev = gatherAudioTracks(useProjectStore.getState().tracks)
    audio.setBlocks(prev)
    const unsubAudio = useProjectStore.subscribe((s) => {
      const next = gatherAudioTracks(s.tracks)
      // Cheap change test: the immutable store makes reference compares exact.
      const changed = next.length !== prev.length || next.some((t, i) => t !== prev[i])
      prev = next
      if (!changed) return
      audio.setBlocks(next)
      void audio.loadClips().then(() => engine.rearmAudio())
    })

    // Keep the live transport tempo in sync with the project bpm while playing -
    // covers BPM drags and undo/redo of tempo alike. setBpm re-arms audio itself.
    const unsubBpm = useProjectStore.subscribe((s, p) => {
      if (s.bpm !== p.bpm && useTimeStore.getState().isPlaying) engine.setBpm(s.bpm)
    })
    return () => {
      unsubAudio()
      unsubBpm()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const play = useCallback(async () => {
    const { currentBeat, loopRegion } = useTimeStore.getState();
    const { totalBars, beatsPerBar, tracks } = useProjectStore.getState();
    const maxBeat = totalBars * beatsPerBar;
    // Starting transport with an active loop always begins at the loop's left
    // edge. Otherwise, only wrap when parked at (or past) the project end.
    const start = loopRegion?.enabled
      ? loopRegion.startBeat
      : currentBeat >= maxBeat ? 0 : currentBeat;
    // Make sure every block's buffer is decoded before the transport starts
    // (normally a no-op - clips pre-decode when their block is inserted).
    const audio = getAudioEngine();
    audio.setBlocks(gatherAudioTracks(tracks));
    await audio.loadClips();
    useTimeStore.getState().setCurrentBeat(start);
    engine.play(start);
    setIsPlaying(true);
  }, []);

  const pause = useCallback(() => {
    engine.pause();
    setIsPlaying(false);
  }, []);

  // Return to the start. Doesn't pause: if currently playing, it keeps playing
  // from beat 0; if paused, it just moves the playhead to 0.
  const reset = useCallback(() => {
    useTimeStore.getState().setCurrentBeat(0);
    if (useTimeStore.getState().isPlaying) engine.play(0);
  }, []);

  // The main Play button doubles as restart while transport is running. Keep
  // that restart inside an active loop; without one it retains the old beat-0
  // behavior. The separate return-to-start control still always targets 0.
  const restart = useCallback(() => {
    const { isPlaying, loopRegion } = useTimeStore.getState();
    const start = loopRegion?.enabled ? loopRegion.startBeat : 0;
    useTimeStore.getState().setCurrentBeat(start);
    if (isPlaying) engine.play(start);
  }, []);

  return {
    play,
    pause,
    reset,
    restart,
  }
}
