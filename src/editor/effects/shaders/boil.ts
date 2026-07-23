import type { VisualEffect } from '../types'

/**
 * Boil: the hand-redrawn wobble of animated type. Every few frames the object's
 * glyph edges take a NEW small displacement (like each frame being re-inked),
 * plus an optional melt band that sweeps down the object smearing it downward
 * as it passes - both straight off a reference lyric edit where the words
 * undulate continuously and a distortion line travels top-to-bottom.
 *
 * Pause invariant: `time` is the current beat and every random value derives
 * from a hash of the QUANTIZED beat (the boil "holds" each distortion between
 * re-rolls, like 2s-and-3s animation), so scrub == playback.
 */
export const boilPlugin: VisualEffect = {
  id: 'boil',
  name: 'Boil',
  category: 'shader',
  // Intensity and DURATION are independent knobs for both components: how
  // hard the wobble hits vs how long each distortion holds, and how strong
  // the traveling line shears vs how many beats one top-to-bottom sweep takes.
  params: [
    { key: 'wobble', label: 'Wobble Intensity', min: 0, max: 1, step: 0.05, default: 0.5 },
    { key: 'wobbleHold', label: 'Wobble Hold (beats)', min: 0.02, max: 1, step: 0.01, default: 0.15 },
    { key: 'line', label: 'Line Intensity', min: 0, max: 1, step: 0.05, default: 0.5 },
    { key: 'lineBeats', label: 'Line Travel (beats)', min: 0.25, max: 8, step: 0.25, default: 1 },
  ],
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform vec2 resolution;
    uniform float time;
    uniform float wobble;
    uniform float wobbleHold;
    uniform float line;
    uniform float lineBeats;
    varying vec2 vUv;

    float hash(vec2 p) {
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }
    float vnoise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(
        mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
        mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
        u.y
      );
    }

    void main() {
      // Quantized re-roll index: the wobble HOLDS each distortion for
      // wobbleHold beats (the boil), it does not slide continuously.
      float roll = floor(time / max(0.02, wobbleHold));
      vec2 p = vUv * 11.0;
      vec2 disp = vec2(
        vnoise(p + roll * 37.17) - 0.5,
        vnoise(p + roll * 61.73 + 19.19) - 0.5
      ) * wobble * 0.02;

      // The traveling line: a THIN band taking lineBeats to sweep top to
      // bottom. The slice it crosses shears SIDEWAYS raggedly (each x gets
      // its own shove) and drags down a touch - the reference's descending
      // distortion line passing through the glyphs.
      if (line > 0.0) {
        float bandY = 1.0 - fract(time / max(0.25, lineBeats));
        float band = smoothstep(0.05, 0.0, abs(vUv.y - bandY));
        float rag = vnoise(vec2(vUv.x * 20.0, roll * 3.7));
        disp.x += band * line * 0.06 * (rag - 0.5) * 2.0;
        disp.y += band * line * 0.03 * rag;
      }

      gl_FragColor = texture2D(tDiffuse, clamp(vUv + disp, 0.0, 1.0));
    }
  `,
}
