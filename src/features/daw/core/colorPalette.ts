// Color Palette System — Types, defaults, and resolution helpers

// ── Types ──────────────────────────────────────────────────────────────

export type ColorRole = 'primary' | 'secondary' | 'accent' | 'background' | 'highlight' | 'text' | 'textStroke';

export interface ColorPaletteDef {
  name: string;
  primary: string;    // hex
  secondary: string;  // hex
  accent: string;     // hex
  background: string; // hex
  highlight: string;  // hex
  text: string;       // hex — fill color for text visuals
  textStroke: string; // hex — outline/stroke color for text visuals
}

export interface ResolvedPalette {
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  highlight: string;
  text: string;
  textStroke: string;
  crossfadeProgress: number;       // 0 = fully "from", 1 = fully "to"
  fromPalette: ColorPaletteDef | null;
  toPalette: ColorPaletteDef | null;
}

export type ColorRoleMappingEntry =
  | { role: ColorRole; param: string; type: 'hsl-hue' }
  | { role: ColorRole; param: string; type: 'hsl-sat' }
  | { role: ColorRole; param: string; type: 'hsl-light' }
  | { role: ColorRole; param: string; type: 'hex' }
  | { role: ColorRole; param: string; type: 'hsl-hue-deg' };

export type ColorRoleMapping = ColorRoleMappingEntry[];

// ── Constants ──────────────────────────────────────────────────────────

export const PALETTE_PITCH_MIN = 36;

export const DEFAULT_PALETTES: ColorPaletteDef[] = [
  { name: 'Midnight Ocean',   primary: '#1a73e8', secondary: '#0d47a1', accent: '#00bcd4',  background: '#0d47a1', highlight: '#64b5f6', text: '#4fc3f7', textStroke: '#0d47a1' },
  { name: 'Ember',            primary: '#ff5722', secondary: '#e64a19', accent: '#ffab40',  background: '#d84315', highlight: '#ff8a65', text: '#ff6e40', textStroke: '#b71c1c' },
  { name: 'Forest',           primary: '#2e7d32', secondary: '#1b5e20', accent: '#76ff03',  background: '#1b5e20', highlight: '#81c784', text: '#69f0ae', textStroke: '#1b5e20' },
  { name: 'Neon Nights',      primary: '#e040fb', secondary: '#7c4dff', accent: '#00e5ff',  background: '#6200ea', highlight: '#ea80fc', text: '#e040fb', textStroke: '#6200ea' },
  { name: 'Sunset',           primary: '#ff6f00', secondary: '#f44336', accent: '#ffc107',  background: '#e65100', highlight: '#ffcc80', text: '#ffab00', textStroke: '#d84315' },
  { name: 'Arctic',           primary: '#b3e5fc', secondary: '#4fc3f7', accent: '#e1f5fe',  background: '#0277bd', highlight: '#ffffff', text: '#e1f5fe', textStroke: '#0277bd' },
  { name: 'Lavender Dream',   primary: '#9575cd', secondary: '#7e57c2', accent: '#f48fb1',  background: '#5e35b1', highlight: '#d1c4e9', text: '#b388ff', textStroke: '#4a148c' },
  { name: 'Coral Reef',       primary: '#ff7043', secondary: '#26a69a', accent: '#ffee58',  background: '#00897b', highlight: '#ff8a80', text: '#ff8a65', textStroke: '#00695c' },
  { name: 'Monochrome',       primary: '#e0e0e0', secondary: '#9e9e9e', accent: '#ffffff',  background: '#424242', highlight: '#f5f5f5', text: '#ffffff', textStroke: '#424242' },
  { name: 'Cyberpunk',        primary: '#ff1744', secondary: '#d500f9', accent: '#00e5ff',  background: '#aa00ff', highlight: '#ff80ab', text: '#ff1744', textStroke: '#aa00ff' },
  { name: 'Golden Hour',      primary: '#ffd54f', secondary: '#ffb300', accent: '#fff176',  background: '#f57f17', highlight: '#ffe082', text: '#ffd600', textStroke: '#e65100' },
  { name: 'Deep Space',       primary: '#311b92', secondary: '#4a148c', accent: '#00b0ff',  background: '#1a237e', highlight: '#7c4dff', text: '#7c4dff', textStroke: '#1a0066' },
  { name: 'Cherry Blossom',   primary: '#f48fb1', secondary: '#f06292', accent: '#fce4ec',  background: '#c2185b', highlight: '#f8bbd0', text: '#f06292', textStroke: '#880e4f' },
  { name: 'Toxic',            primary: '#76ff03', secondary: '#64dd17', accent: '#00e676',  background: '#33691e', highlight: '#b2ff59', text: '#76ff03', textStroke: '#33691e' },
  { name: 'Warm Earth',       primary: '#8d6e63', secondary: '#6d4c41', accent: '#d7ccc8',  background: '#5d4037', highlight: '#bcaaa4', text: '#d7ccc8', textStroke: '#3e2723' },
  { name: 'Electric Blue',    primary: '#2979ff', secondary: '#2962ff', accent: '#82b1ff',  background: '#1565c0', highlight: '#448aff', text: '#448aff', textStroke: '#0d47a1' },
];

export const PALETTE_PITCH_MAX = PALETTE_PITCH_MIN + DEFAULT_PALETTES.length - 1;

// ── Color Utilities ────────────────────────────────────────────────────

/** Parse hex string (#rrggbb or #rgb) to {r,g,b} 0-255 */
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  return {
    r: parseInt(h.substring(0, 2), 16),
    g: parseInt(h.substring(2, 4), 16),
    b: parseInt(h.substring(4, 6), 16),
  };
}

/** Convert hex to HSL (all 0-1 range) */
export function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const { r: rr, g: gg, b: bb } = hexToRgb(hex);
  const r = rr / 255, g = gg / 255, b = bb / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return { h, s, l };
}

/** RGB-space linear interpolation between two hex colors */
export function lerpHex(a: string, b: string, t: number): string {
  const ca = hexToRgb(a), cb = hexToRgb(b);
  const r = Math.round(ca.r + (cb.r - ca.r) * t);
  const g = Math.round(ca.g + (cb.g - ca.g) * t);
  const bl = Math.round(ca.b + (cb.b - ca.b) * t);
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1);
}

// ── Palette Resolution ─────────────────────────────────────────────────

interface ActiveNote {
  startTimeInBeats: number;
  pitch: number;
}

/**
 * Given the active notes on a palette track, determine the resolved palette.
 * Latest-starting held note wins. When no notes are active, returns null
 * (caller should keep previous palette).
 */
export function resolvePaletteAtBeat(
  activeNotes: Map<number, ActiveNote>,
  palettes: ColorPaletteDef[],
  crossfadeDuration: number,
  beat: number,
  prevPitch: number | null,
  prevDef: ColorPaletteDef | null,
): ResolvedPalette | null {
  if (activeNotes.size === 0 && prevPitch === null) return null;

  // Find latest-starting active note
  let bestNote: ActiveNote | null = null;
  for (const note of activeNotes.values()) {
    if (!bestNote || note.startTimeInBeats > bestNote.startTimeInBeats) {
      bestNote = note;
    }
  }

  // Determine current palette from pitch
  let currentDef: ColorPaletteDef | null = null;
  let currentPitch: number | null = null;
  if (bestNote) {
    const idx = bestNote.pitch - PALETTE_PITCH_MIN;
    if (idx >= 0 && idx < palettes.length) {
      currentDef = palettes[idx];
      currentPitch = bestNote.pitch;
    }
  }

  // Fall back to previous if no active note
  if (!currentDef) {
    if (!prevDef) return null;
    currentDef = prevDef;
    currentPitch = prevPitch;
  }

  // Handle crossfade
  const pitchChanged = currentPitch !== prevPitch && prevPitch !== null && prevDef !== null;
  if (pitchChanged && crossfadeDuration > 0 && bestNote) {
    const elapsed = beat - bestNote.startTimeInBeats;
    const progress = Math.min(1, elapsed / crossfadeDuration);

    return {
      primary: lerpHex(prevDef!.primary, currentDef.primary, progress),
      secondary: lerpHex(prevDef!.secondary, currentDef.secondary, progress),
      accent: lerpHex(prevDef!.accent, currentDef.accent, progress),
      background: lerpHex(prevDef!.background, currentDef.background, progress),
      highlight: lerpHex(prevDef!.highlight, currentDef.highlight, progress),
      text: lerpHex(prevDef!.text, currentDef.text, progress),
      textStroke: lerpHex(prevDef!.textStroke, currentDef.textStroke, progress),
      crossfadeProgress: progress,
      fromPalette: prevDef,
      toPalette: currentDef,
    };
  }

  // No crossfade — instant switch
  return {
    primary: currentDef.primary,
    secondary: currentDef.secondary,
    accent: currentDef.accent,
    background: currentDef.background,
    highlight: currentDef.highlight,
    text: currentDef.text,
    textStroke: currentDef.textStroke,
    crossfadeProgress: 1,
    fromPalette: null,
    toPalette: currentDef,
  };
}

// ── Apply Mapping ──────────────────────────────────────────────────────

import { VisualInstrumentState } from './visualTypes';

/**
 * Write resolved palette colors into state.params based on the instrument's
 * colorRoleMapping. Each entry extracts a specific channel from a palette
 * role's hex color and writes it to a param key.
 */
export function applyColorRoleMapping(
  state: VisualInstrumentState,
  mapping: ColorRoleMapping,
  palette: ResolvedPalette,
): void {
  for (const entry of mapping) {
    const hex = palette[entry.role];
    switch (entry.type) {
      case 'hex':
        state.params[entry.param] = hex;
        break;
      case 'hsl-hue': {
        const hsl = hexToHsl(hex);
        state.params[entry.param] = hsl.h;
        break;
      }
      case 'hsl-sat': {
        const hsl = hexToHsl(hex);
        state.params[entry.param] = hsl.s;
        break;
      }
      case 'hsl-light': {
        const hsl = hexToHsl(hex);
        state.params[entry.param] = hsl.l;
        break;
      }
      case 'hsl-hue-deg': {
        const hsl = hexToHsl(hex);
        state.params[entry.param] = hsl.h * 360;
        break;
      }
    }
  }
}
