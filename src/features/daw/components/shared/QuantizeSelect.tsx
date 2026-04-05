'use client';

interface QuantizeSelectProps {
  value: number;
  onChange: (value: number) => void;
}

/**
 * Dropdown for selecting grid quantization value.
 * Options are in beats: 0.25 (1/16), 0.5 (1/8), 1 (1/4), 4 (bar).
 */
export function QuantizeSelect({ value, onChange }: QuantizeSelectProps) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted">Grid:</span>
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="px-2 py-1 bg-background border border-border rounded text-sm text-foreground"
      >
        <option value={0.0625}>1/64</option>
        <option value={1/24}>1/64T</option>
        <option value={0.125}>1/32</option>
        <option value={1/12}>1/32T</option>
        <option value={0.25}>1/16</option>
        <option value={1/6}>1/16T</option>
        <option value={0.5}>1/8</option>
        <option value={1/3}>1/8T</option>
        <option value={1}>1/4</option>
        <option value={2/3}>1/4T</option>
        <option value={2}>1/2</option>
        <option value={4/3}>1/2T</option>
        <option value={4}>Bar</option>
      </select>
    </div>
  );
}
