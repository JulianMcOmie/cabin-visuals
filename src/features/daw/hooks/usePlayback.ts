'use client';

import { useEffect, useRef, useCallback } from 'react';
import { getPlaybackEngine, PlaybackState } from '@daw/core/playback';
import { useProjectStore } from '@daw/stores/projectStore';
import { useUIStore } from '@daw/stores/uiStore';

export function usePlayback() {
  const engineRef = useRef(getPlaybackEngine());
  const project = useProjectStore((state) => state.project);
  const isPlaying = useUIStore((s) => s.isPlaying);
  const setPlaying = useUIStore((s) => s.setPlaying);
  const setCurrentBeat = useUIStore((s) => s.setCurrentBeat);
  const setUILoopRegion = useUIStore((s) => s.setLoopRegion);
  const loopStart = useUIStore((s) => s.loopStart);
  const loopEnd = useUIStore((s) => s.loopEnd);
  const loopEnabled = useUIStore((s) => s.loopEnabled);

  // Setup callbacks on mount
  useEffect(() => {
    const engine = engineRef.current;

    engine.setCallbacks({
      onBeatChange: (beat) => {
        setCurrentBeat(beat);
      },
      onStateChange: (state: PlaybackState) => {
        setPlaying(state === 'playing');
      },
    });

    // Note: We don't dispose the engine on unmount because multiple components
    // share the singleton engine. Disposing when any component unmounts would
    // kill playback for all other components. The engine persists for the app lifetime.
  }, [setCurrentBeat, setPlaying]);

  // Sync loop region with engine when loopEnabled changes
  useEffect(() => {
    if (!isPlaying) return;

    const engine = engineRef.current;
    if (loopEnabled && loopStart !== null && loopEnd !== null && loopStart !== loopEnd) {
      engine.setLoopRegion(loopStart, loopEnd, project.beatsPerBar);
    } else {
      // Clear custom loop - restore full project loop
      engine.setLoopRegion(null, null, project.beatsPerBar);
    }
  }, [isPlaying, loopEnabled, loopStart, loopEnd, project.beatsPerBar]);

  const play = useCallback(async () => {
    const engine = engineRef.current;
    let startBeat = useUIStore.getState().currentBeat;

    // Logic Pro behavior: if loop is enabled and playhead is outside the loop region,
    // start playback from loop start
    if (loopEnabled && loopStart !== null && loopEnd !== null && loopStart !== loopEnd) {
      if (startBeat < loopStart || startBeat >= loopEnd) {
        startBeat = loopStart;
        setCurrentBeat(loopStart);
      }
    }

    // Play from current playhead position
    await engine.playFrom(project, startBeat);

    // Apply loop region if enabled
    if (loopEnabled && loopStart !== null && loopEnd !== null && loopStart !== loopEnd) {
      engine.setLoopRegion(loopStart, loopEnd, project.beatsPerBar);
    }
  }, [project, loopEnabled, loopStart, loopEnd, setCurrentBeat]);

  const stop = useCallback(() => {
    const engine = engineRef.current;
    engine.stop();
  }, []);

  const pause = useCallback(() => {
    const engine = engineRef.current;
    engine.pause();
  }, []);

  const resume = useCallback(() => {
    const engine = engineRef.current;
    engine.resume();
  }, []);

  const toggle = useCallback(async () => {
    if (isPlaying) {
      stop();
    } else {
      await play();
    }
  }, [isPlaying, play, stop]);

  const setBpm = useCallback((bpm: number) => {
    const engine = engineRef.current;
    engine.setBpm(bpm);
    useProjectStore.getState().setBpm(bpm);
  }, []);

  const seekTo = useCallback((beat: number) => {
    const engine = engineRef.current;
    engine.seekTo(beat, project.beatsPerBar);
  }, [project.beatsPerBar]);

  const setLoopRegion = useCallback((start: number | null, end: number | null) => {
    const engine = engineRef.current;
    engine.setLoopRegion(start, end, project.beatsPerBar);
    setUILoopRegion(start, end);
  }, [project.beatsPerBar, setUILoopRegion]);

  const setPlaybackSpeed = useCallback((speed: number) => {
    const engine = engineRef.current;
    engine.setPlaybackSpeed(speed);
    useUIStore.getState().setPlaybackSpeed(speed);
  }, []);

  return {
    isPlaying,
    play,
    stop,
    pause,
    resume,
    toggle,
    setBpm,
    seekTo,
    setLoopRegion,
    setPlaybackSpeed,
  };
}
