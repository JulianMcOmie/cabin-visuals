import { detectDrums } from './drumDetection'
self.onmessage = (event: MessageEvent<{ samples: Float32Array; sampleRate: number }>) => {
  try {
    const analysis = detectDrums(event.data.samples, event.data.sampleRate, (progress) => self.postMessage({ progress }))
    self.postMessage({ analysis })
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'Drum analysis failed.' })
  }
}
