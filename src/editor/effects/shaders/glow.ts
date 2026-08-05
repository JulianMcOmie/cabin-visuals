import type { VisualEffect } from '../types'

/** Screen-space bloom over the object's own render: bright-pass + one-pass
 *  24-tap golden-spiral blur, added back over the source. The halo spills past
 *  the silhouette (alpha grows where bloom lands), which is the point - pair
 *  with the Texturizer's Neon finish or Glow knob for the classic look. */
export const glowPlugin: VisualEffect = {
  id: 'glow',
  name: 'Glow',
  category: 'shader',
  params: [
    { key: 'amount', label: 'Amount', min: 0, max: 3, step: 0.05, default: 0.8 },
    { key: 'size', label: 'Size', min: 0, max: 1, step: 0.01, default: 0.35 },
    { key: 'threshold', label: 'Threshold', min: 0, max: 1, step: 0.01, default: 0.35 },
  ],
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform vec2 resolution;
    uniform float amount;
    uniform float size;
    uniform float threshold;
    varying vec2 vUv;
    void main() {
      vec4 base = texture2D(tDiffuse, vUv);
      // Blur radius in pixels; squared response packs control into small halos.
      vec2 px = mix(6.0, 90.0, size * size) / resolution;
      // Rotate the whole spiral by a per-pixel hash: the sparse tap rings
      // dissolve into stable noise instead of visible onion layers.
      float jitter = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) * 6.2831853;
      vec3 acc = vec3(0.0);
      float accA = 0.0;
      float wsum = 0.0;
      for (int i = 0; i < 40; i++) {
        float fi = float(i);
        float t = (fi + 0.5) / 40.0;
        float ang = fi * 2.399963 + jitter; // golden angle: even disc coverage
        float r = sqrt(t);
        vec2 off = vec2(cos(ang), sin(ang)) * r * px;
        vec4 s = texture2D(tDiffuse, vUv + off);
        float lum = max(s.r, max(s.g, s.b)) * s.a;
        float bright = smoothstep(threshold, threshold + 0.35, lum);
        float w = 1.0 - r * r; // soft radial falloff
        acc += s.rgb * (bright * w);
        accA += s.a * (bright * w);
        wsum += w;
      }
      vec3 bloom = acc / wsum * (amount * 1.5);
      float bloomA = clamp(accA / wsum * amount, 0.0, 1.0);
      // Damp the addition where the source is already bright: the halo gets the
      // full bloom while the core keeps its hue instead of clipping to white.
      float baseLum = clamp(max(base.r, max(base.g, base.b)) * base.a, 0.0, 1.0);
      vec3 col = base.rgb + bloom * mix(1.0, 0.3, baseLum);
      gl_FragColor = vec4(col, clamp(base.a + bloomA * 0.85, 0.0, 1.0));
    }
  `,
}
