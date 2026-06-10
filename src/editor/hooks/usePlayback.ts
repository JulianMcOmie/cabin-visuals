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

  const stop = useCallback(() => {
    engine.stop();
    setIsPlaying(false);
  }, []);

  return {
    play,
    pause,
    stop
  }
}
