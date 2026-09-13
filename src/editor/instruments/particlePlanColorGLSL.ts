/** The Particle copy-color path in linear RGB, matching colorShift.ts and the
 * render helpers in utils/oklch.ts. Every program stage mutates a shared color
 * state; tint mixing and relative shifts are applied exactly once at the end. */
export const PARTICLE_PLAN_COLOR_GLSL = `
  float hueChannel(float p, float q, float h) {
    h = fract(h);
    if (h < 1.0 / 6.0) return p + (q - p) * 6.0 * h;
    if (h < 0.5) return q;
    if (h < 2.0 / 3.0) return p + (q - p) * 6.0 * (2.0 / 3.0 - h);
    return p;
  }
  vec3 particleOffsetHsl(vec3 rgb, vec3 shift) {
    float high = max(rgb.r, max(rgb.g, rgb.b));
    float low = min(rgb.r, min(rgb.g, rgb.b));
    float delta = high - low;
    float lightness = (low + high) * 0.5;
    float saturation = 0.0, hue = 0.0;
    if (delta != 0.0) {
      saturation = lightness <= 0.5 ? delta / (high + low) : delta / (2.0 - high - low);
      hue = high == rgb.r ? (rgb.g - rgb.b) / delta + (rgb.g < rgb.b ? 6.0 : 0.0)
        : high == rgb.g ? (rgb.b - rgb.r) / delta + 2.0 : (rgb.r - rgb.g) / delta + 4.0;
      hue /= 6.0;
    }
    hue = fract(hue + shift.x);
    saturation = clamp(saturation + shift.y, 0.0, 1.0);
    lightness = clamp(lightness + shift.z, 0.0, 1.0);
    if (saturation == 0.0) return vec3(lightness);
    float q = lightness <= 0.5 ? lightness * (1.0 + saturation) : lightness + saturation - lightness * saturation;
    float p = 2.0 * lightness - q;
    return vec3(hueChannel(p, q, hue + 1.0 / 3.0), hueChannel(p, q, hue), hueChannel(p, q, hue - 1.0 / 3.0));
  }
  vec3 shiftHue(vec3 rgb, float shift) {
    if (shift == 0.0 || max(rgb.r, max(rgb.g, rgb.b)) == min(rgb.r, min(rgb.g, rgb.b))) return rgb;
    return particleOffsetHsl(rgb, vec3(shift, 0.0, 0.0));
  }
  vec3 particleLinearRgbToOklab(vec3 rgb) {
    vec3 lms = vec3(
      dot(rgb, vec3(0.4122214708, 0.5363325363, 0.0514459929)),
      dot(rgb, vec3(0.2119034982, 0.6806995451, 0.1073969566)),
      dot(rgb, vec3(0.0883024619, 0.2817188376, 0.6299787005)));
    lms = sign(lms) * pow(abs(lms), vec3(1.0 / 3.0));
    return vec3(
      dot(lms, vec3(0.2104542553, 0.7936177850, -0.0040720468)),
      dot(lms, vec3(1.9779984951, -2.4285922050, 0.4505937099)),
      dot(lms, vec3(0.0259040371, 0.7827717662, -0.8086757660)));
  }
  vec3 particleOklabToLinearRgb(vec3 lab) {
    vec3 lms = vec3(
      dot(lab, vec3(1.0, 0.3963377774, 0.2158037573)),
      dot(lab, vec3(1.0, -0.1055613458, -0.0638541728)),
      dot(lab, vec3(1.0, -0.0894841775, -1.2914855480)));
    lms = lms * lms * lms;
    return clamp(vec3(
      dot(lms, vec3(4.0767416621, -3.3077115913, 0.2309699292)),
      dot(lms, vec3(-1.2684380046, 2.6097574011, -0.3413193965)),
      dot(lms, vec3(-0.0041960863, -0.7034186147, 1.7076147010))), 0.0, 1.0);
  }
  vec3 particleCopyColor(vec3 rgb, float hue, float saturation, float lightness,
    vec3 tint, float tintAmount, float tintPerceptual, float huePerceptual) {
    tintAmount = clamp(tintAmount, 0.0, 1.0);
    if (tintAmount > 0.0) {
      if (tintAmount >= 1.0) rgb = tint;
      else if (tintPerceptual > 0.5) {
        vec3 from = particleLinearRgbToOklab(rgb), to = particleLinearRgbToOklab(tint);
        rgb = particleOklabToLinearRgb(from + (to - from) * tintAmount);
      } else rgb += (tint - rgb) * tintAmount;
    }
    if (huePerceptual > 0.5) {
      if (hue != 0.0) {
        vec3 lab = particleLinearRgbToOklab(rgb);
        float angle = hue * 6.283185307179586, c = cos(angle), s = sin(angle);
        rgb = particleOklabToLinearRgb(vec3(lab.x, lab.y * c - lab.z * s, lab.y * s + lab.z * c));
      }
      hue = 0.0;
    }
    if (saturation == 0.0 && lightness == 0.0) return shiftHue(rgb, hue);
    return particleOffsetHsl(rgb, vec3(hue, saturation, lightness));
  }
`
