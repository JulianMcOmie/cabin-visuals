// Worker entry: runs the beat detector off the main thread. Posts the
// BeatDetection (or null) back for the BeatDetectInput it receives.
import { detectBeatsFromChannels, type BeatDetectInput } from './beatDetect'

self.onmessage = (e: MessageEvent<BeatDetectInput>) => {
  let result = null
  try {
    result = detectBeatsFromChannels(e.data)
  } catch (err) {
    console.warn('beat detection failed in worker', err)
  }
  ;(self as unknown as Worker).postMessage(result)
}
