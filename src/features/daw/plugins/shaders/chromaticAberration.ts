import { VisualPlugin } from '../types';

export const ChromaticAberrationPlugin: VisualPlugin = {
  id: 'chromaticAberration',
  name: 'Chromatic Aberration',
  description: 'RGB channel offset for retro/glitch effect',
  category: 'shader',

  defaultSettings: {
    offset: 0.01,
    angle: 0,
  },

  settingsSchema: {
    offset: {
      type: 'number',
      label: 'Offset',
      min: 0,
      max: 0.1,
      step: 0.002,
      default: 0.01,
    },
    angle: {
      type: 'number',
      label: 'Angle',
      min: 0,
      max: 6.28,
      step: 0.1,
      default: 0,
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
};
