// The kaleidoscopic surface field, as GLSL. A pure leaf module (no imports) so
// both the material EFFECT (materials/kaleidoSkin.ts, applied to any instrument)
// and the KaleidoSolid instrument can share it without a dependency cycle.
//
// Contract expected by MaterialWrapper: declares its own `uniform float u<Param>`
// per plugin param plus `uKBeat`, and defines `vec3 kaleidoField(vec3 objDir)`
// taking a direction in the target mesh's OWN space.

export const KALEIDO_FIELD_GLSL = `
  uniform float uKBeat;
  uniform float uKFacets;
  uniform float uKScale;
  uniform float uKDrift;
  uniform float uKHue;
  uniform float uKTwist;

  #define KTAU 6.2831853
  #define KPI 3.14159265

  float kHash(float n) { return fract(sin(n * 127.1) * 43758.5453123); }
  mat2 kRot(float t) { float c = cos(t), s = sin(t); return mat2(c, -s, s, c); }

  /** Signed distance to a regular n-gon. n is deliberately continuous: sweeping
   *  it 3 to 7 morphs triangle through heptagon smoothly. */
  float kNgon(vec2 p, float n, float rad) {
    float an = KPI / n;
    float t = mod(atan(p.y, p.x) + an, 2.0 * an) - an;
    return length(p) * cos(t) - rad * cos(an);
  }

  vec3 kPalette(float h) {
    return 0.5 + 0.5 * cos(KTAU * (vec3(0.0, 0.33, 0.67) + h));
  }

  /** The kaleidoscope, evaluated for a direction in the solid's OWN space. */
  vec3 kaleidoField(vec3 objDir) {
    vec3 d = normalize(objDir);
    float phi = acos(clamp(d.y, -1.0, 1.0));   // 0 at the north pole, PI at the south
    float theta = atan(d.z, d.x);

    float n = max(2.0, floor(uKFacets + 0.5));
    float seg = KTAU / n;
    float halfSeg = seg * 0.5;

    float t = uKBeat * uKDrift;
    // Notes turn the barrel (uKTwist); Drift is the idle turn on top of it.
    float a = mod(theta + uKTwist + t * 0.15, seg);
    a = abs(a - halfSeg);                       // a == 0 and a == halfSeg are mirror lines

    float shapeScale = clamp(halfSeg / (KPI / 6.0), 0.35, 1.5);
    float pitch = 0.3 * shapeScale * clamp(uKScale, 0.15, 4.0);

    // Surface metric: a wedge's arc length at polar angle phi shrinks as sin(phi),
    // so folding that in keeps cells square right up to both poles instead of
    // crowding them into a smear at the south end.
    vec2 fp = vec2(a * sin(phi), phi);

    vec3 accum = kPalette(uKHue + 0.5) * 0.12;
    float cover = 0.0;
    float aa = 0.08 * pitch;

    float ringHere = floor(phi / pitch);
    for (int ro = -1; ro <= 1; ro++) {
      float ri = ringHere + float(ro);
      if (ri < 0.0) continue;
      float rMid = (ri + 0.5) * pitch;
      if (rMid > KPI) continue;

      // Cells per ring grow with radius so density stays even; a fixed count per
      // ring spreads over a growing arc and thins out to confetti.
      float cells = max(1.0, floor(halfSeg * sin(rMid) / pitch + 0.5));
      float cellHere = floor((a / max(0.0001, halfSeg)) * cells);

      for (int co = -1; co <= 1; co++) {
        // Cells past the wedge edge are kept, not skipped: those are the shards
        // straddling a mirror line, which the fold returns sliced.
        float ci = cellHere + float(co);
        float sa = kHash(ri * 7.31 + ci * 3.17 + 1.3);
        float sb = kHash(ri * 11.7 + ci * 5.91 + 7.7);
        float sc = kHash(ri * 3.93 + ci * 9.13 + 13.1);

        // MOVE - each shard wanders inside its own cell, radially and across the
        // wedge, so the 3x3 window still catches everything that can reach here.
        float rr = rMid + 0.3 * pitch * sin(t * (0.5 + 0.3 * sa) + sa * KTAU);
        float uu = (ci + 0.5) / cells + (0.34 / cells) * sin(t * (0.4 + 0.3 * sb) + sb * KTAU);
        vec2 c = vec2(halfSeg * uu * sin(rr), rr);

        // GROW - size swings hard and each shard runs its own cycle, so shapes
        // bloom and close rather than sitting at one size.
        float grow = 0.5 + 0.62 * sin(t * (0.6 + 0.5 * sc) + sc * KTAU);
        float rad = pitch * (0.3 + 0.22 * sa) * max(0.05, grow);
        float sides = 3.0 + 4.0 * (0.5 + 0.5 * sin(t * 0.35 + sc * KTAU));
        float rot = t * (0.35 + 0.4 * sc) + sc * KTAU;

        float dist = kNgon(kRot(rot) * (fp - c), sides, rad);
        float m = smoothstep(aa, -aa * 0.35, dist);

        // RECOLOUR - every shard travels the palette at its own rate, so the
        // surface keeps changing colour instead of holding a fixed scheme.
        vec3 shard = kPalette(uKHue + ri * 0.19 + ci * 0.11 + t * (0.1 + 0.14 * sc))
                   * (0.7 + 0.45 * sb);
        accum = mix(accum, shard, m * 0.92);
        cover = max(cover, m);
      }
    }

    // Mirror seams, only where there is glass: darkening the bare tint too turns
    // the solid into a spoked umbrella.
    float edge = min(a, halfSeg - a) / max(0.0001, halfSeg);
    accum *= mix(1.0, mix(0.6, 1.0, smoothstep(0.0, 0.08, edge)), cover);
    return accum;
  }
`
