import type { VisualEffect } from '../types'

/** Fade the whole layer. */
export const opacityPlugin: VisualEffect = {
  id: 'opacity',
  name: 'Opacity',
  category: 'shader',
  params: [
    { key: 'opacity', label: 'Opacity', min: 0, max: 1, step: 0.01, default: 1 },
  ],
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float opacity;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      gl_FragColor = vec4(c.rgb * opacity, c.a * opacity);
    }
  `,
}
