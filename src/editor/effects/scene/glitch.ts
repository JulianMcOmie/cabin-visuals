import type { VisualEffect } from '../types'

// Glitch - horizontal slice displacement, block corruption and an RGB split
// jitter, all seeded from the QUANTIZED beat (`floor(time * rate)`), so the
// corruption pattern re-rolls on a tempo grid and a paused frame holds one
// glitch forever - purity's version of datamosh. AMOUNT gates everything
// (0 = clean frame, pass skipped), which makes `fx:<id>:amount` on a burst
// lane the canonical snare map.
const GLITCH_FRAGMENT = `
uniform sampler2D tDiffuse;
uniform float amount;
uniform float rate;
uniform float slices;
uniform float shift;
uniform float split;
uniform float blocks;
uniform float time;
varying vec2 vUv;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

void main() {
  float seed = floor(time * max(rate, 0.001));
  vec2 uv = vUv;

  // Slice displacement: the frame cut into horizontal bands, a random subset
  // shoved sideways. Each band rolls its own dice per seed, so the tear
  // pattern is different on every grid step.
  float sliceCount = max(slices, 1.0);
  float band = floor(uv.y * sliceCount);
  float roll = hash(vec2(band, seed));
  if (roll > 1.0 - 0.45 * amount) {
    float dir = sign(hash(vec2(seed, band)) - 0.5);
    uv.x = fract(uv.x + dir * shift * amount * (0.3 + roll));
  }

  // Block corruption: a coarse grid where a few cells sample from a wrong
  // (offset) place - the datamosh read.
  if (blocks > 1e-4) {
    vec2 cell = floor(uv * vec2(16.0, 9.0));
    float b = hash(cell + vec2(seed * 3.1, seed * 5.7));
    if (b > 1.0 - 0.25 * blocks * amount) {
      uv = fract(uv + (vec2(hash(cell + seed), hash(cell - seed)) - 0.5) * 0.4);
    }
  }

  // RGB split: a per-seed direction, sized by the split knob - capped small
  // in uv so fine content fringes instead of turning to confetti.
  vec2 splitOffset = vec2(hash(vec2(seed, 1.0)) - 0.5, hash(vec2(seed, 2.0)) - 0.5)
    * 0.012 * split * amount;
  float red = texture2D(tDiffuse, fract(uv + splitOffset)).r;
  vec4 mid = texture2D(tDiffuse, uv);
  float blue = texture2D(tDiffuse, fract(uv - splitOffset)).b;

  gl_FragColor = vec4(red, mid.g, blue, mid.a);
}`

export const glitchScenePlugin: VisualEffect = {
  id: 'sceneGlitch',
  name: 'Glitch',
  category: 'scene',
  accent: '#a3e635',
  params: [
    { key: 'amount', label: 'Amount', min: 0, max: 1, step: 0.01, default: 0.6 },
    // Shares Grain's musical ladder (scene/rate.ts) - the bottom rung is one
    // re-seed per bar, which is why the floor is 0.25 rather than the 0.5 this
    // shipped with.
    { key: 'rate', label: 'Rate', min: 0.25, max: 16, step: 0.25, default: 4 },
    { key: 'slices', label: 'Slices', min: 2, max: 32, step: 1, default: 12 },
    { key: 'shift', label: 'Shift', min: 0, max: 0.5, step: 0.005, default: 0.1 },
    { key: 'split', label: 'RGB split', min: 0, max: 1, step: 0.01, default: 0.5 },
    { key: 'blocks', label: 'Blocks', min: 0, max: 1, step: 0.01, default: 0.3 },
  ],
  fragmentShader: GLITCH_FRAGMENT,
}
