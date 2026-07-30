import type { VisualEffect } from '../types'

/**
 * Kaleido Skin: the object's silhouette becomes a WINDOW onto a kaleidoscope.
 *
 * Distinct from the `kaleidoscope` plugin, which folds the object's own rendered
 * image into mirrored wedges. This one GENERATES its pattern - a drifting field
 * of morphing polygons - and paints it inside the object's alpha, shaded by the
 * object's own luminance so the 3D form still reads. So it works on every
 * instrument without knowing anything about it: mask in, texture out.
 *
 * Four knobs, deliberately. Everything else that makes it look alive (how many
 * shards, their orbits, the polygon morph, the mirror seams, the palette ramp)
 * is derived inside the shader rather than exposed - the complexity lives here,
 * not in the panel.
 *
 * Pause invariant: every animated quantity is a function of `time` (the current
 * beat) times `drift`, so scrub == playback, and `drift` at 0 is a frozen
 * crystal rather than a stopped animation.
 */
export const kaleidoSkinPlugin: VisualEffect = {
  id: 'kaleidoSkin',
  name: 'Kaleido Skin',
  category: 'shader',
  params: [
    // Facets is floored in the shader: automation lanes interpolate continuously
    // and a fractional wedge count tears the fold at the wrap seam.
    { key: 'facets', label: 'Facets', min: 2, max: 16, step: 1, default: 6 },
    { key: 'scale', label: 'Scale', min: 0.3, max: 3, step: 0.05, default: 1 },
    { key: 'drift', label: 'Drift', min: 0, max: 2, step: 0.05, default: 0.6 },
    { key: 'hue', label: 'Hue', min: 0, max: 6.28, step: 0.05, default: 0 },
  ],
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform vec2 resolution;
    uniform float time;
    uniform float facets;
    uniform float scale;
    uniform float drift;
    uniform float hue;
    varying vec2 vUv;

    #define TAU 6.2831853
    #define PI 3.14159265
    // Shards live in a POLAR LATTICE: concentric rings, each subdivided into
    // roughly square cells, one shard per cell. A pixel is only reachable by
    // its own cell and the neighbours around it, so this is a fixed 3x3 = 9
    // shape tests wherever the pixel sits.
    //
    // The cell COUNT per ring grows with radius (see the cells term), which is the
    // whole point: a fixed number of shards per ring spreads over an arc that
    // grows with r, so density falls off as 1/r and the outer rings read as
    // confetti scattered on bare tint instead of a kaleidoscope.
    #define NEIGHBOURS 1

    float hash1(float n) { return fract(sin(n * 127.1) * 43758.5453123); }

    mat2 rot2(float t) { float c = cos(t), s = sin(t); return mat2(c, -s, s, c); }

    /** Signed distance to a regular n-gon of circumradius rad. \`n\` is
     *  deliberately continuous - sweeping it 3→6 morphs triangle→hexagon
     *  smoothly, which is where the "shifting abstract shapes" comes from. */
    float sdNgon(vec2 p, float n, float rad) {
      float an = PI / n;
      float t = mod(atan(p.y, p.x) + an, 2.0 * an) - an;
      return length(p) * cos(t) - rad * cos(an);
    }

    /** Cosine palette: one scalar in, a full vivid ramp out. The 0.5/0.5 split
     *  reaches pure saturation at the peaks - lifting the base washes every
     *  shard toward pastel once the luminance shading multiplies on top. */
    vec3 palette(float h) {
      return 0.5 + 0.5 * cos(TAU * (vec3(0.0, 0.33, 0.67) + h));
    }

    void main() {
      vec4 src = texture2D(tDiffuse, vUv);
      // Outside the object, contribute nothing: the overlay quad is full-frame,
      // so anything but transparent here would tint the whole scene.
      if (src.a < 0.004) { gl_FragColor = vec4(0.0); return; }

      // --- the fold -------------------------------------------------------
      // Aspect-corrected so wedges are true angular sectors and shapes stay
      // round on a non-square canvas.
      float aspect = resolution.x / max(1.0, resolution.y);
      vec2 p = (vUv - 0.5) * vec2(aspect, 1.0);
      float ang = atan(p.y, p.x);
      float r = length(p);

      float n = max(2.0, floor(facets + 0.5));
      float seg = TAU / n;
      float half_ = seg * 0.5;

      float t = time * drift;
      // The whole barrel turns slowly - a real kaleidoscope's tube rotating.
      float a = mod(ang + t * 0.15, seg);
      a = abs(a - half_);              // mirror: a == 0 and a == half_ are both mirror lines

      // Field point, geometrically undistorted (a circle in the field stays a
      // circle on screen) - shapes get SLICED by the mirror lines, which is
      // exactly what a physical kaleidoscope does.
      // The fold is FRAME-relative, but objects occupy a small part of the
      // frame - a default cube is maybe a fifth of it. Calibrated so Scale 1
      // puts several rings across a typical object; a base tuned against a
      // frame-filling shape lands every real object inside ring zero and shows
      // one soft blob.
      float zoom = 6.0 / max(0.3, scale);
      vec2 fp = vec2(cos(a), sin(a)) * r * zoom;

      // Shard size tracks the wedge width, so raising Facets subdivides the
      // pattern instead of degenerating it into radial streaks.
      float shapeScale = clamp(half_ / (PI / 6.0), 0.35, 1.5);

      // --- the shifting shapes --------------------------------------------
      // Base tint fills the gaps so a fully-covered mesh never goes black; the
      // complement of the palette reads as the dark glass behind the shards.
      vec3 accum = palette(hue + 0.5) * 0.13;
      float cover = 0.0;

      // One SCREEN-space edge width, converted into field units (a field
      // distance covers zoom times less screen, hence the factor). Keep this
      // SMALL: objects are a fraction of the frame, so a shard is only tens of
      // pixels across, and a wide edge blurs neighbouring complementary shards
      // into each other - which reads as pastel mush, not soft glass.
      float aa = 0.0045 * zoom;

      // Cell pitch shrinks with the wedge, so raising Facets subdivides the
      // whole lattice - shards AND spacing together - instead of leaving small
      // shards adrift in bare tint.
      float pitch = 0.5 * shapeScale;
      float ringHere = floor(length(fp) / pitch);
      float aFrac = a / max(0.0001, half_);   // 0..1 across the mirrored half-wedge

      for (int ro = -NEIGHBOURS; ro <= NEIGHBOURS; ro++) {
        float ri = ringHere + float(ro);
        if (ri < 0.0) continue;

        // Cells across the half-wedge at this radius, chosen so a cell's arc
        // length is about one pitch - i.e. cells stay roughly square, which is
        // what keeps shard density uniform from centre to rim.
        float rMid = (ri + 0.5) * pitch;
        float cells = max(1.0, floor(half_ * rMid / pitch + 0.5));
        float cellHere = floor(aFrac * cells);

        for (int co = -NEIGHBOURS; co <= NEIGHBOURS; co++) {
          // Cells outside [0, cells-1] are deliberately NOT skipped: those are
          // the shards straddling the mirror lines, and the fold brings them
          // back sliced - which is what a physical kaleidoscope does.
          float ci = cellHere + float(co);
          float sa = hash1(ri * 7.31 + ci * 3.17 + 1.3);
          float sb = hash1(ri * 11.7 + ci * 5.91 + 7.7);
          float sc = hash1(ri * 3.93 + ci * 9.13 + 13.1);

          // Both drifts stay inside the cell, so the 3x3 window always contains
          // every shard that could reach this pixel.
          float rr = (ri + 0.5 + 0.3 * sin(t * (0.19 + 0.11 * sa) + sa * TAU)) * pitch;
          float uu = (ci + 0.5) / cells + (0.34 / cells) * sin(t * (0.13 + 0.09 * sb) + sb * TAU);
          vec2 c = vec2(cos(half_ * uu), sin(half_ * uu)) * rr;

          float sides = 3.0 + 3.0 * (0.5 + 0.5 * sin(t * 0.11 + sc * TAU));
          float rad = pitch * (0.4 + 0.22 * sc) * (0.85 + 0.25 * sin(t * 0.23 + sa * TAU));
          float rot = t * (0.12 + 0.2 * sc) + sc * TAU;

          float d = sdNgon(rot2(rot) * (fp - c), sides, max(0.02, rad));
          float m = smoothstep(aa, -aa * 0.35, d);

          // Per-shard lightness jitter: a field of uniformly-lit shards reads
          // flat, and this is what gives the glass its stacked depth.
          vec3 shard = palette(hue + ri * 0.21 + ci * 0.13 + t * 0.03) * (0.72 + 0.42 * sc);
          accum = mix(accum, shard, m * 0.9);
          cover = max(cover, m);
        }
      }

      // Thin dark seams along both mirror lines - the physical mirror edges,
      // and the cue that sells the fold as real. Weighted by coverage: seams
      // are where the GLASS is cut, and darkening the bare tint too turns the
      // whole object into a spoked umbrella.
      float edge = min(a, half_ - a) / max(0.0001, half_);
      accum *= mix(1.0, mix(0.62, 1.0, smoothstep(0.0, 0.08, edge)), cover);

      // --- keep the 3D form -----------------------------------------------
      // Unpremultiply before measuring brightness: partially-covered silhouette
      // pixels carry a scaled-down rgb, and reading those directly would ring
      // the object in a dark fringe.
      float lum = dot(src.rgb, vec3(0.2126, 0.7152, 0.0722)) / max(src.a, 0.004);
      // The object's own shading modulates the texture, so lighting and depth
      // survive; the pow term adds a sheen on the lit side.
      // Ceiling is 1.0 on purpose: the palette already peaks at full saturation,
      // so a multiplier above 1 lifts every channel and the shards clip toward
      // white. Brightly-lit objects (a flat-shaded cube face) turn pastel.
      vec3 col = accum * mix(0.38, 1.0, smoothstep(0.02, 0.55, lum));
      // A tight sheen on the brightest facets only. Broader than this and it
      // greys the whole lit side, burying the pattern under a highlight.
      col += pow(clamp(lum, 0.0, 1.0), 5.0) * 0.07;

      gl_FragColor = vec4(col, src.a);
    }
  `,
}
