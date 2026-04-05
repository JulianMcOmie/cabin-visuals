import { VisualPlugin } from '../types';

export const PixelatePlugin: VisualPlugin = {
  id: 'pixelate',
  name: 'Pixelate',
  description: 'Reduce resolution for retro effect',
  category: 'shader',

  defaultSettings: {
    pixelSize: 8,
  },

  settingsSchema: {
    pixelSize: {
      type: 'number',
      label: 'Pixel Size',
      min: 2,
      max: 64,
      step: 1,
      default: 8,
    },
  },

  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,

  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float pixelSize;
    uniform vec2 resolution;
    varying vec2 vUv;

    void main() {
      vec2 dxy = pixelSize / resolution;
      vec2 coord = dxy * floor(vUv / dxy);
      gl_FragColor = texture2D(tDiffuse, coord);
    }
  `,
};
