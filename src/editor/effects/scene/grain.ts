import type { VisualEffect } from '../types'

// Grain - film grain, scanlines, or an ordered-dither halftone over the
// finished frame. The texture ANIMATES by the beat, not the wall clock: the
// seed is `floor(time * rate)`, so a paused frame is frozen grain, scrubbing
// shows exactly what playback shows, and export is frame-exact - the same
// purity discipline as everything else, applied to noise. RATE is in
// re-seeds per beat, so the boil is tempo-locked.
const GRAIN_FRAGMENT = `
uniform sampler2D tDiffuse;
uniform float amount;
uniform float mode;
uniform float size;
uniform float rate;
uniform float time;
varying vec2 vUv;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

// Ordered 4x4 Bayer, built from the 2x2 recursion (no arrays in GLSL ES 1.0).
float bayer2(vec2 p) {
  return 3.0 * p.y + 2.0 * p.x - 4.0 * p.x * p.y;
}
float bayer4(vec2 cell) {
  return (4.0 * bayer2(mod(cell, 2.0)) + bayer2(mod(floor(cell * 0.5), 2.0))) / 16.0;
}

void main() {
  vec4 source = texture2D(tDiffuse, vUv);
  vec3 color = source.rgb;
  float seed = floor(time * max(rate, 0.001));
  float px = max(size, 1.0);

  if (mode < 0.5) {
    // Film grain: luminance-weighted so shadows keep their black and
    // highlights their headroom - grain lives in the midtones, as on stock.
    vec2 cell = floor(gl_FragCoord.xy / px);
    float g = hash(cell + vec2(seed * 19.7, seed * 7.3)) - 0.5;
    float luma = dot(clamp(color, 0.0, 1.0), vec3(0.2126, 0.7152, 0.0722));
    float weight = 4.0 * luma * (1.0 - luma);
    color += g * amount * 0.35 * weight;
  } else if (mode < 1.5) {
    // Scanlines: darkened rows with a slow beat-locked roll.
    float row = gl_FragCoord.y / (px * 2.0) + time * 0.5;
    float line = 0.5 + 0.5 * sin(row * 6.28318);
    color *= 1.0 - amount * 0.5 * line;
  } else {
    // Halftone: ordered 4x4 Bayer threshold on luminance, inked in the
    // frame's own color so it reads as a print of the scene, not a stencil.
    vec2 cell = floor(gl_FragCoord.xy / px);
    float luma = dot(clamp(color, 0.0, 1.0), vec3(0.2126, 0.7152, 0.0722));
    float ink = step(bayer4(cell), luma);
    color = mix(color, color * ink * 1.4, amount);
  }

  gl_FragColor = vec4(max(color, 0.0), source.a);
}`

export const grainScenePlugin: VisualEffect = {
  id: 'sceneGrain',
  name: 'Grain',
  category: 'scene',
  // Near-achromatic on purpose: this is the film-stock device, and a silver
  // console beside six coloured ones reads as the monochrome one.
  accent: '#d6d3d1',
  params: [
    { key: 'amount', label: 'Amount', min: 0, max: 1, step: 0.01, default: 0.4 },
    { key: 'mode', label: 'Texture', type: 'select', options: [
      { value: 0, label: 'Film grain' },
      { value: 1, label: 'Scanlines' },
      { value: 2, label: 'Halftone' },
    ], default: 0 },
    { key: 'size', label: 'Size', min: 1, max: 8, step: 0.5, default: 2 },
    { key: 'rate', label: 'Rate', min: 0.25, max: 16, step: 0.25, default: 8 },
  ],
  fragmentShader: GRAIN_FRAGMENT,
}
