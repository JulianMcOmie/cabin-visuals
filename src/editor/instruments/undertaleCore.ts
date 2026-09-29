// Character order is persisted in track.params.character. Append, never reorder.
export const UNDERTALE_CHARACTERS = [
  'Sans', 'Papyrus', 'Frisk', 'Toriel', 'Undyne', 'Flowey', 'Napstablook', 'Mettaton',
] as const

export function undertaleCharacterIndex(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(UNDERTALE_CHARACTERS.length - 1, Math.round(value))) : 0
}

export function undertalePose(beat: number, motion: number, energy: number, response: number) {
  const hit = Math.max(0, Math.min(1, energy)) * response
  return {
    lift: Math.sin(beat * Math.PI) * motion * 0.08 + hit * 0.14,
    tilt: Math.sin(beat * Math.PI * 0.5) * motion * 0.045,
    scale: 1 + hit * 0.07,
  }
}
