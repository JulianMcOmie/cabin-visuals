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
  params: [
    { key: 'amount', label: 'Wobble', min: 0, max: 1, step: 0.05, default: 0.5 },
    { key: 'speed', label: 'Re-rolls / beat', min: 1, max: 24, step: 1, default: 6 },
    { key: 'melt', label: 'Melt Band', min: 0, max: 1, step: 0.05, default: 0.4 },
    { key: 'meltRate', label: 'Melt Sweeps / beat', min: 0.05, max: 2, step: 0.05, default: 0.25 },
  ],
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform vec2 resolution;
    uniform float time;
    uniform float amount;
    uniform float speed;
    uniform float melt;
    uniform float meltRate;
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
      // Quantized re-roll index: the wobble HOLDS between rolls (the boil),
      // it does not slide continuously.
      float roll = floor(time * speed);
      vec2 p = vUv * 11.0;
      vec2 disp = vec2(
        vnoise(p + roll * 37.17) - 0.5,
        vnoise(p + roll * 61.73 + 19.19) - 0.5
      ) * amount * 0.02;

      // The melt band: sweeps top to bottom once per 1/meltRate beats, and
      // inside it the image smears DOWNWARD (sampling from above), raggedly.
      if (melt > 0.0) {
        float bandPos = 1.0 - fract(time * meltRate);
        float band = smoothstep(0.14, 0.0, abs(vUv.y - bandPos));
        disp.y += band * melt * 0.04 * (0.35 + 0.65 * vnoise(vec2(vUv.x * 24.0, roll)));
      }

      gl_FragColor = texture2D(tDiffuse, clamp(vUv + disp, 0.0, 1.0));
    }
  `,
}
