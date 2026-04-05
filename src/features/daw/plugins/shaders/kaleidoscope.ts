import { VisualPlugin } from '../types';

export const KaleidoscopePlugin: VisualPlugin = {
  id: 'kaleidoscope',
  name: 'Kaleidoscope',
  description: 'Dynamic kaleidoscope with oscillating parameters',
  category: 'shader',

  defaultSettings: {
    // Core
    segments: 6,
    rotation: 0,
    zoom: 1,
    centerX: 0,
    centerY: 0,

    // Auto-animation
    spinSpeed: 0,

    // Segment oscillator
    segmentOsc: false,
    segmentOscSpeed: 0.5,
    segmentOscAmount: 4,

    // Rotation oscillator
    rotationOsc: false,
    rotationOscSpeed: 0.3,
    rotationOscAmount: 3.14,

    // Zoom oscillator
    zoomOsc: false,
    zoomOscSpeed: 0.2,
    zoomOscAmount: 0.5,

    // Center oscillator (creates swirl effect)
    centerOsc: false,
    centerOscSpeed: 0.4,
    centerOscAmount: 0.2,

    // Visual effects
    hueShift: 0,
    hueShiftOsc: false,
    hueShiftOscSpeed: 0.1,
    hueShiftOscAmount: 1,

    saturation: 1,
    brightness: 1,
    contrast: 1,

    // Edge effects
    edgeSoftness: 0,
    vignette: 0,
  },

  settingsSchema: {
    // Core parameters
    segments: {
      type: 'number',
      label: 'Segments',
      min: 2,
      max: 24,
      step: 1,
      default: 6,
    },
    rotation: {
      type: 'number',
      label: 'Rotation',
      min: 0,
      max: 6.28,
      step: 0.05,
      default: 0,
    },
    zoom: {
      type: 'number',
      label: 'Zoom',
      min: 0.1,
      max: 3,
      step: 0.1,
      default: 1,
    },
    centerX: {
      type: 'number',
      label: 'Center X',
      min: -0.5,
      max: 0.5,
      step: 0.05,
      default: 0,
    },
    centerY: {
      type: 'number',
      label: 'Center Y',
      min: -0.5,
      max: 0.5,
      step: 0.05,
      default: 0,
    },
    spinSpeed: {
      type: 'number',
      label: 'Spin Speed',
      min: -2,
      max: 2,
      step: 0.1,
      default: 0,
    },

    // Segment oscillator
    segmentOsc: {
      type: 'boolean',
      label: 'Oscillate Segments',
      default: false,
    },
    segmentOscSpeed: {
      type: 'number',
      label: 'Seg Osc Speed',
      min: 0.1,
      max: 3,
      step: 0.1,
      default: 0.5,
    },
    segmentOscAmount: {
      type: 'number',
      label: 'Seg Osc Range',
      min: 1,
      max: 12,
      step: 1,
      default: 4,
    },

    // Rotation oscillator
    rotationOsc: {
      type: 'boolean',
      label: 'Oscillate Rotation',
      default: false,
    },
    rotationOscSpeed: {
      type: 'number',
      label: 'Rot Osc Speed',
      min: 0.1,
      max: 3,
      step: 0.1,
      default: 0.3,
    },
    rotationOscAmount: {
      type: 'number',
      label: 'Rot Osc Amount',
      min: 0.1,
      max: 6.28,
      step: 0.1,
      default: 3.14,
    },

    // Zoom oscillator
    zoomOsc: {
      type: 'boolean',
      label: 'Oscillate Zoom',
      default: false,
    },
    zoomOscSpeed: {
      type: 'number',
      label: 'Zoom Osc Speed',
      min: 0.1,
      max: 3,
      step: 0.1,
      default: 0.2,
    },
    zoomOscAmount: {
      type: 'number',
      label: 'Zoom Osc Amount',
      min: 0.1,
      max: 2,
      step: 0.1,
      default: 0.5,
    },

    // Center oscillator
    centerOsc: {
      type: 'boolean',
      label: 'Oscillate Center',
      default: false,
    },
    centerOscSpeed: {
      type: 'number',
      label: 'Center Osc Speed',
      min: 0.1,
      max: 3,
      step: 0.1,
      default: 0.4,
    },
    centerOscAmount: {
      type: 'number',
      label: 'Center Osc Amount',
      min: 0.05,
      max: 0.5,
      step: 0.05,
      default: 0.2,
    },

    // Hue shift
    hueShift: {
      type: 'number',
      label: 'Hue Shift',
      min: 0,
      max: 1,
      step: 0.05,
      default: 0,
    },
    hueShiftOsc: {
      type: 'boolean',
      label: 'Oscillate Hue',
      default: false,
    },
    hueShiftOscSpeed: {
      type: 'number',
      label: 'Hue Osc Speed',
      min: 0.05,
      max: 2,
      step: 0.05,
      default: 0.1,
    },
    hueShiftOscAmount: {
      type: 'number',
      label: 'Hue Osc Amount',
      min: 0.1,
      max: 1,
      step: 0.1,
      default: 1,
    },

    // Color adjustments
    saturation: {
      type: 'number',
      label: 'Saturation',
      min: 0,
      max: 2,
      step: 0.1,
      default: 1,
    },
    brightness: {
      type: 'number',
      label: 'Brightness',
      min: 0.5,
      max: 2,
      step: 0.1,
      default: 1,
    },
    contrast: {
      type: 'number',
      label: 'Contrast',
      min: 0.5,
      max: 2,
      step: 0.1,
      default: 1,
    },

    // Edge effects
    edgeSoftness: {
      type: 'number',
      label: 'Edge Softness',
      min: 0,
      max: 0.5,
      step: 0.05,
      default: 0,
    },
    vignette: {
      type: 'number',
      label: 'Vignette',
      min: 0,
      max: 1,
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
    uniform float time;

    // Core
    uniform float segments;
    uniform float rotation;
    uniform float zoom;
    uniform float centerX;
    uniform float centerY;
    uniform float spinSpeed;

    // Segment oscillator
    uniform bool segmentOsc;
    uniform float segmentOscSpeed;
    uniform float segmentOscAmount;

    // Rotation oscillator
    uniform bool rotationOsc;
    uniform float rotationOscSpeed;
    uniform float rotationOscAmount;

    // Zoom oscillator
    uniform bool zoomOsc;
    uniform float zoomOscSpeed;
    uniform float zoomOscAmount;

    // Center oscillator
    uniform bool centerOsc;
    uniform float centerOscSpeed;
    uniform float centerOscAmount;

    // Hue
    uniform float hueShift;
    uniform bool hueShiftOsc;
    uniform float hueShiftOscSpeed;
    uniform float hueShiftOscAmount;

    // Color
    uniform float saturation;
    uniform float brightness;
    uniform float contrast;

    // Edge
    uniform float edgeSoftness;
    uniform float vignette;

    varying vec2 vUv;

    #define PI 3.14159265359
    #define TAU 6.28318530718

    // RGB to HSV
    vec3 rgb2hsv(vec3 c) {
      vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
      vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
      vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
      float d = q.x - min(q.w, q.y);
      float e = 1.0e-10;
      return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
    }

    // HSV to RGB
    vec3 hsv2rgb(vec3 c) {
      vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
      vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
      return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
    }

    void main() {
      // Calculate animated parameters
      float animSegments = segments;
      if (segmentOsc) {
        animSegments = segments + sin(time * segmentOscSpeed * TAU) * segmentOscAmount;
        animSegments = max(2.0, animSegments);
      }

      float animRotation = rotation + time * spinSpeed * TAU;
      if (rotationOsc) {
        animRotation += sin(time * rotationOscSpeed * TAU) * rotationOscAmount;
      }

      float animZoom = zoom;
      if (zoomOsc) {
        animZoom = zoom + sin(time * zoomOscSpeed * TAU) * zoomOscAmount;
        animZoom = max(0.1, animZoom);
      }

      float animCenterX = centerX;
      float animCenterY = centerY;
      if (centerOsc) {
        animCenterX += sin(time * centerOscSpeed * TAU) * centerOscAmount;
        animCenterY += cos(time * centerOscSpeed * TAU * 1.3) * centerOscAmount;
      }

      float animHue = hueShift;
      if (hueShiftOsc) {
        animHue = fract(hueShift + time * hueShiftOscSpeed);
      }

      // Center UV coordinates with animated center
      vec2 center = vec2(0.5 + animCenterX, 0.5 + animCenterY);
      vec2 uv = vUv - center;

      // Convert to polar coordinates
      float angle = atan(uv.y, uv.x) + animRotation;
      float radius = length(uv) * animZoom;

      // Kaleidoscope effect - fold angle into segment
      float segmentAngle = TAU / animSegments;
      float segmentIndex = floor(angle / segmentAngle);
      angle = mod(angle, segmentAngle);

      // Mirror every other segment
      if (mod(segmentIndex, 2.0) >= 1.0) {
        angle = segmentAngle - angle;
      }

      // Convert back to cartesian
      vec2 newUv = vec2(cos(angle), sin(angle)) * radius + 0.5;

      // Sample texture with bounds check
      vec4 color;
      if (newUv.x < 0.0 || newUv.x > 1.0 || newUv.y < 0.0 || newUv.y > 1.0) {
        color = vec4(0.0, 0.0, 0.0, 1.0);
      } else {
        color = texture2D(tDiffuse, newUv);
      }

      // Edge softness (blend to black at segment edges)
      if (edgeSoftness > 0.0) {
        float edgeDist = min(angle, segmentAngle - angle) / segmentAngle;
        float edgeFade = smoothstep(0.0, edgeSoftness, edgeDist);
        color.rgb *= edgeFade;
      }

      // Hue shift
      if (animHue > 0.0) {
        vec3 hsv = rgb2hsv(color.rgb);
        hsv.x = fract(hsv.x + animHue);
        color.rgb = hsv2rgb(hsv);
      }

      // Saturation
      if (saturation != 1.0) {
        vec3 hsv = rgb2hsv(color.rgb);
        hsv.y *= saturation;
        color.rgb = hsv2rgb(hsv);
      }

      // Brightness and contrast
      color.rgb = (color.rgb - 0.5) * contrast + 0.5;
      color.rgb *= brightness;

      // Vignette
      if (vignette > 0.0) {
        float dist = length(vUv - 0.5) * 2.0;
        float vig = smoothstep(1.0, 1.0 - vignette, dist);
        color.rgb *= vig;
      }

      gl_FragColor = color;
    }
  `,
};
