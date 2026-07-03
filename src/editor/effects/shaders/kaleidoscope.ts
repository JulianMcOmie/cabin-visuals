import type { VisualEffect } from '../types'

/** Fold the image into mirrored radial segments, with spin, zoom, and a hue shift. */
export const kaleidoscopePlugin: VisualEffect = {
  id: 'kaleidoscope',
  name: 'Kaleidoscope',
  category: 'shader',
  params: [
    { key: 'segments', label: 'Segments', min: 2, max: 24, step: 1, default: 6 },
    { key: 'rotation', label: 'Rotation', min: 0, max: 6.28, step: 0.05, default: 0 },
    { key: 'zoom', label: 'Zoom', min: 0.1, max: 3, step: 0.05, default: 1 },
    { key: 'spinSpeed', label: 'Spin Speed', min: -2, max: 2, step: 0.05, default: 0 },
    { key: 'hueShift', label: 'Hue Shift', min: 0, max: 6.28, step: 0.05, default: 0 },
  ],
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float time;
    uniform float segments;
    uniform float rotation;
    uniform float zoom;
    uniform float spinSpeed;
    uniform float hueShift;
    varying vec2 vUv;

    vec3 hueRotate(vec3 c, float h) {
      const mat3 toYIQ = mat3(0.299, 0.596, 0.211, 0.587, -0.274, -0.523, 0.114, -0.322, 0.312);
      const mat3 toRGB = mat3(1.0, 1.0, 1.0, 0.956, -0.272, -1.106, 0.621, -0.647, 1.703);
      vec3 yiq = toYIQ * c;
      float hue = atan(yiq.z, yiq.y) + h;
      float chroma = length(yiq.yz);
      yiq = vec3(yiq.x, chroma * cos(hue), chroma * sin(hue));
      return toRGB * yiq;
    }

    void main() {
      vec2 uv = vUv - 0.5;
      float a = atan(uv.y, uv.x);
      float r = length(uv) * zoom;
      float seg = 6.2831853 / max(2.0, segments);
      a = mod(a + rotation + time * spinSpeed, seg);
      a = abs(a - seg * 0.5);
      vec2 p = vec2(cos(a), sin(a)) * r + 0.5;
      vec4 col = (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0) ? vec4(0.0) : texture2D(tDiffuse, p);
      col.rgb = hueRotate(col.rgb, hueShift);
      gl_FragColor = col;
    }
  `,
}
