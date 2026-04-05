import { MidiRow, RangeLabel } from './MidiEditor';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/**
 * Generate MidiRow[] for a given pitch range.
 * Higher pitches at the top (descending order).
 * Falls back to C1–C7 (24–96) if no range provided.
 */
export function generateRows(
  noteRange?: { min: number; max: number },
): MidiRow[] {
  const min = noteRange?.min ?? 24;
  const max = noteRange?.max ?? 96;
  const rows: MidiRow[] = [];

  for (let pitch = max; pitch >= min; pitch--) {
    const octave = Math.floor(pitch / 12) - 1;
    const noteIndex = pitch % 12;
    const hue = (noteIndex / 12) * 360;
    rows.push({
      pitch,
      label: `${NOTE_NAMES[noteIndex]}${octave}`,
      color: `hsl(${hue}, 70%, 55%)`,
    });
  }

  return rows;
}

/**
 * Generate rows for automation tracks where pitch maps to a parameter value.
 * Shows value labels instead of note names. Only labels a reasonable subset of rows.
 */
export function generateAutomationRows(
  noteRange: { min: number; max: number },
  paramMin: number,
  paramMax: number,
  paramLabel: string,
): { rows: MidiRow[]; rangeLabels: RangeLabel[] } {
  const pitchMin = noteRange.min;
  const pitchMax = noteRange.max;
  const pitchSpan = pitchMax - pitchMin;
  const rows: MidiRow[] = [];

  // Pick ~8 labeled pitches evenly spread
  const labelCount = Math.min(9, pitchSpan + 1);
  const labelledPitches = new Set<number>();
  for (let i = 0; i < labelCount; i++) {
    labelledPitches.add(Math.round(pitchMin + (i / (labelCount - 1)) * pitchSpan));
  }

  for (let pitch = pitchMax; pitch >= pitchMin; pitch--) {
    const t = pitchSpan > 0 ? (pitch - pitchMin) / pitchSpan : 0;
    const value = paramMin + t * (paramMax - paramMin);

    // Format the value nicely
    const formatted = value >= 100 ? Math.round(value).toString()
      : value >= 1 ? value.toFixed(1)
      : value.toFixed(3);

    const hue = t * 240; // blue (low) to red (high)
    rows.push({
      pitch,
      label: labelledPitches.has(pitch) ? formatted : '',
      color: `hsl(${hue}, 60%, 50%)`,
    });
  }

  // Single range label for the whole range
  const rangeLabels: RangeLabel[] = [{
    startPitch: pitchMin,
    endPitch: pitchMax,
    label: paramLabel,
  }];

  return { rows, rangeLabels };
}
