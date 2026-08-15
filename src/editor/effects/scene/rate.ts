// The musical rate ladder shared by the two RE-SEEDING devices (Grain, Glitch).
//
// Both quantize their randomness to `floor(beat * rate)`, so `rate` is in
// re-seeds per BEAT - which is a tempo-relative number, not a frequency, and
// therefore has an exact note value. The knob is stepped over this ladder and
// reads it out in note values (`1/8`, `1/16`) rather than as a raw multiplier,
// for the same reason Strobe puts its rates on labelled rows: the speed is a
// musical choice, so the control should speak in the units the choice is made
// in. The stored value stays the continuous number, so automation lanes and
// older saves are untouched (Radial Motion's and Tunnel's detent contract).
//
// One beat is a quarter note here, as everywhere else in the project.

export interface SceneFxRate {
  /** Re-seeds per beat - what the shader's `rate` uniform receives. */
  value: number
  /** Note value the readout speaks. */
  label: string
}

export const SCENE_FX_RATES: readonly SceneFxRate[] = [
  { value: 0.25, label: '1/1' },
  { value: 0.5, label: '1/2' },
  { value: 1, label: '1/4' },
  { value: 2, label: '1/8' },
  { value: 4, label: '1/16' },
  { value: 8, label: '1/32' },
  { value: 16, label: '1/64' },
]

/** The ladder as the Knob's `detents` array (index units, see console/Knob). */
export const SCENE_FX_RATE_DETENTS: readonly number[] = SCENE_FX_RATES.map((rate) => rate.value)

/** The note value nearest a stored rate - a legacy or automated value that sits
 *  between detents still reads as the division it is closest to. */
export function formatSceneFxRate(value: number): string {
  let nearest = SCENE_FX_RATES[0]
  for (const rate of SCENE_FX_RATES) {
    if (Math.abs(rate.value - value) < Math.abs(nearest.value - value)) nearest = rate
  }
  return nearest.label
}
