import type { VisualEffect } from '../types'

/** Offset the R and B channels in opposite directions (glitch / lens fringe). */
export const chromaticAberrationPlugin: VisualEffect = {
  id: 'chromaticAberration',
  name: 'Chromatic Aberration',
  category: 'shader',
  params: [
    { key: 'offset', label: 'Offset', min: 0, max: 0.1, step: 0.002, default: 0.01 },
    { key: 'angle', label: 'Angle', min: 0, max: 6.28, step: 0.05, default: 0 },
  ],
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float offset;
    uniform float angle;
    varying vec2 vUv;
    void main() {
      vec2 dir = vec2(cos(angle), sin(angle)) * offset;
      float r = texture2D(tDiffuse, vUv + dir).r;
      float g = texture2D(tDiffuse, vUv).g;
      float b = texture2D(tDiffuse, vUv - dir).b;
      float a = texture2D(tDiffuse, vUv).a;
      gl_FragColor = vec4(r, g, b, a);
    }
  `,
}
