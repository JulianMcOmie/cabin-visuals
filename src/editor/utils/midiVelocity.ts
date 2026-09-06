/** Accept normalized (0–1) and legacy MIDI (0–127) velocities. Callers own
 * clamping: some instruments use a minimum strength or allow values above 1. */
export function midiVelocity(value: number): number {
  return value <= 1 ? value : value / 127
}
