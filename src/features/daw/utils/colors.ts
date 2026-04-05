import { PatternCategory, TrackTypeId } from '@daw/core/types';
import { INSTRUMENTS, getInstrument } from '@daw/instruments';

// Category colors (kid-friendly but not childish)
export const CATEGORY_COLORS: Record<PatternCategory, string> = {
  drums: '#C4A8FF',    // Purple (brightened)
  chords: '#FF7B7B',   // Coral (brightened)
  bass: '#FFE66D',     // Yellow
  arp: '#5EDDD4',      // Teal (brightened)
  modifier: '#A5F1E3', // Mint (brightened)
  rhythm: '#F9A826',   // Orange
  suppress: '#64748b', // Slate
  mute: '#991b1b',     // Deep red (instrument blackout)
  rest: '#9ca3af',     // Gray
  swing: '#f472b6',    // Pink (groove feel)
};

// Track type colors
export const TRACK_TYPE_COLORS: Record<TrackTypeId, string> = {
  base: '#6366f1',       // Indigo
  add: '#22c55e',        // Green
  override: '#ef4444',   // Red
  suppress: '#64748b',   // Slate (event filtering)
  mute: '#991b1b',       // Deep red (instrument blackout)
  gate: '#f59e0b',       // Amber
  shift: '#06b6d4',      // Cyan
  transpose: '#0ea5e9',  // Sky blue
  scale: '#8b5cf6',      // Violet
  scaleShift: '#ec4899', // Pink
  harmonyMap: '#14b8a6', // Teal
  rhythm: '#F9A826',     // Orange
  rest: '#9ca3af',       // Gray
  swing: '#f472b6',      // Pink (groove feel)
  scene: '#7c3aed',      // Purple (scene compositor)
  master: '#94a3b8',     // Slate (master channel)
};

// Instrument colors - derived from INSTRUMENTS registry
export const INSTRUMENT_COLORS: Record<string, string> = Object.fromEntries(
  Object.entries(INSTRUMENTS).map(([id, def]) => [id, def.color])
);

// Background variants (darker for timeline blocks)
export function getBlockColor(instrumentId?: string, category?: PatternCategory): string {
  if (instrumentId) {
    const instrument = getInstrument(instrumentId);
    return instrument?.color || '#64748b';
  }
  if (category) {
    return CATEGORY_COLORS[category];
  }
  return '#64748b'; // Slate gray default
}

// Get contrasting text color
export function getTextColor(backgroundColor: string): string {
  // Simple luminance check
  const hex = backgroundColor.replace('#', '');
  const r = parseInt(hex.substr(0, 2), 16);
  const g = parseInt(hex.substr(2, 2), 16);
  const b = parseInt(hex.substr(4, 2), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? '#0e0e0e' : '#ffffff';
}

// Generate a glow box-shadow for a given color
export function glowShadow(color: string, intensity: number = 0.3): string {
  const hex = color.replace('#', '');
  const r = parseInt(hex.substr(0, 2), 16);
  const g = parseInt(hex.substr(2, 2), 16);
  const b = parseInt(hex.substr(4, 2), 16);
  return `0 0 ${Math.round(20 * intensity)}px rgba(${r}, ${g}, ${b}, ${intensity}), 0 0 ${Math.round(40 * intensity)}px rgba(${r}, ${g}, ${b}, ${intensity * 0.4})`;
}

// Get a semi-transparent version of a color
export function withAlpha(color: string, alpha: number): string {
  const hex = color.replace('#', '');
  const r = parseInt(hex.substr(0, 2), 16);
  const g = parseInt(hex.substr(2, 2), 16);
  const b = parseInt(hex.substr(4, 2), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Lighten a color (supports hex and hsl strings)
export function lighten(color: string, amount: number): string {
  const hslMatch = color.match(/^hsl\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*\)$/);
  if (hslMatch) {
    const h = parseFloat(hslMatch[1]);
    const s = parseFloat(hslMatch[2]);
    const l = Math.min(100, parseFloat(hslMatch[3]) + amount);
    return `hsl(${h}, ${s}%, ${l}%)`;
  }
  const hex = color.replace('#', '');
  const r = Math.min(255, parseInt(hex.substr(0, 2), 16) + Math.round(amount));
  const g = Math.min(255, parseInt(hex.substr(2, 2), 16) + Math.round(amount));
  const b = Math.min(255, parseInt(hex.substr(4, 2), 16) + Math.round(amount));
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

// Darken a color
export function darken(color: string, amount: number): string {
  const hex = color.replace('#', '');
  const r = Math.max(0, parseInt(hex.substr(0, 2), 16) - amount);
  const g = Math.max(0, parseInt(hex.substr(2, 2), 16) - amount);
  const b = Math.max(0, parseInt(hex.substr(4, 2), 16) - amount);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

// Mix white with a color (tinted white)
// ratio is how much white (0 = full color, 1 = pure white)
export function tintWhite(color: string, ratio: number = 0.85): string {
  const hex = color.replace('#', '');
  const colorR = parseInt(hex.substr(0, 2), 16);
  const colorG = parseInt(hex.substr(2, 2), 16);
  const colorB = parseInt(hex.substr(4, 2), 16);
  const r = Math.round(255 * ratio + colorR * (1 - ratio));
  const g = Math.round(255 * ratio + colorG * (1 - ratio));
  const b = Math.round(255 * ratio + colorB * (1 - ratio));
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}
