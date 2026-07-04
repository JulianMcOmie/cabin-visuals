// An external beat override for the visual engine. While set, VisualBeatSync
// computes the scene at THIS beat instead of the TimeStore's — the export walk
// drives frames through here so the transport, playhead, and every beat readout
// stay frozen for the user while the canvas renders elsewhere in time.
// null = normal operation (the store's beat).

let overrideBeat: number | null = null

export function setBeatOverride(beat: number | null): void {
  overrideBeat = beat
}

export function getBeatOverride(): number | null {
  return overrideBeat
}
