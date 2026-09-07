import type { VisualEffect } from '../types'
import { FRAME_REFERENCE_HEIGHT } from '../../core/visual/framePixels'

/** Quantize to a coarse pixel grid (retro). */
export const pixelatePlugin: VisualEffect = {
  id: 'pixelate',
  name: 'Pixelate',
  category: 'shader',
  params: [
    { key: 'pixelSize', label: 'Pixel Size', min: 2, max: 64, step: 1, default: 8 },
  ],
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform vec2 resolution;
    uniform float pixelSize;
    varying vec2 vUv;
    void main() {
      vec2 frameResolution = resolution / resolution.y * ${FRAME_REFERENCE_HEIGHT.toFixed(1)};
      vec2 d = vec2(pixelSize) / frameResolution;
      vec2 coord = d * floor(vUv / d) + d * 0.5;
      gl_FragColor = texture2D(tDiffuse, coord);
    }
  `,
}
