import { useCallback, useEffect } from "react";
import { getPlaybackEngine } from '../core/playback';
import { useTimeStore } from '../store/TimeStore';
import { useUIStore } from '../store/UIStore';

export function usePlayback() {
  const { setIsPlaying } = useTimeStore();
  const engine = getPlaybackEngine();

  useEffect(() => {
    engine.init({
      onBeatChange: (beat) => useTimeStore.getState().setCurrentBeat(beat),
      getBpm: () => useTimeStore.getState().bpm,
      getMaxBeat: () => {
        const { totalBars, beatsPerBar } = useTimeStore.getState()
        return totalBars * beatsPerBar
      },
      onEnd: () => setIsPlaying(false),
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const play = useCallback(() => {
    const { currentBeat } = useTimeStore.getState();
    engine.play(currentBeat);
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

  return {
    play,
    pause,
    reset
  }
}
