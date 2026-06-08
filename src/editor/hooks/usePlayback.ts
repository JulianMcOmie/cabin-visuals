import { useCallback } from "react";
import { getPlaybackEngine } from '../core/playback';
import { useTimeStore } from '../store/timeStore';
import { useUIStore } from '../store/UIStore';

export function usePlayback() {
  const { setIsPlaying } = useUIStore();
  const engine = getPlaybackEngine();
  const { bpm, totalBars, beatsPerBar, setCurrentBeat } = useTimeStore.getState();
  engine.init({
    onBeatChange: (beat) => setCurrentBeat(beat),
    getBpm: () => bpm,
    getMaxBeat: () => totalBars * beatsPerBar,
    onEnd: () => setIsPlaying(false)
  });

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