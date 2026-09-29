import { defineInstrument, p, ease, clamp } from '../../code'

// Symmetry as a played effect: a scene post pass that folds the finished scene -
// bilateral mirror, quad, n-fold kaleidoscope, or a water reflection below a
// horizon - with notes stepping the kaleidoscope round, changing its fold, or
// rippling the water. Draws nothing itself; place it in the scene it folds.
//
//   60  Turn: rotate one segment (springs into place)
//   62  Ripple: a ring of ripples spreads across the water / warps the fold
//   48-59  Fold: n = 2 + (pitch - 48) segments while held (overrides the param)

const ROW = { turn: 60, ripple: 62, fold0: 48 }

export const instrument = defineInstrument({
  id: 'innuendo.mirror',
  name: 'Mirror / Kaleido',
  description: 'Folds the whole scene - mirror, quad, kaleidoscope or water reflection - with rows that turn the fold, change its segments, and ripple it.',
  color: '#d66bff',
  params: {
    mode: p.select(['Mirror', 'Quad', 'Kaleidoscope', 'Water'], 2),
    segments: p.int(8, 2, 24),
    spin: p.num(0.06, -2, 2, { label: 'Spin (rad/s)' }),
    zoom: p.num(1.9, 0.3, 4),
    mix: p.num(1, 0, 1),
    horizon: p.num(-0.28, -0.9, 0.9, { label: 'Water line' }),
    ripple: p.num(0.35, 0, 2, { label: 'Water ripple' }),
    shade: p.num(0.42, 0, 1, { label: 'Water darkness' }),
  },
  rows: {
    [ROW.ripple]: 'Ripple',
    [ROW.turn]: { label: 'Turn', emphasized: true },
    ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => [ROW.fold0 + i, `Fold × ${2 + i}`])),
  },
  post: {
    fragment: /* glsl */ `
      uniform float uMode, uN, uRot, uZoom, uMix, uRipple, uHorizon, uShade, uWave, uWaveAge;
      vec2 toUv2(vec2 p){ p.x /= uAspect; return p * 0.5 + 0.5; }
      void main(){
        vec2 p = vUv * 2.0 - 1.0; p.x *= uAspect;
        vec2 s = p;
        float shade = 1.0;
        if (uMode < 0.5) {
          s.x = -abs(s.x);
        } else if (uMode < 1.5) {
          s = -abs(s);
        } else if (uMode < 2.5) {
          float r = length(p) / uZoom;
          r += sin(r * 40.0 - uWaveAge * 12.0) * uWave * 0.01 * exp(-uWaveAge * 2.0);
          float a = atan(p.y, p.x) - uRot;
          float seg = 6.28318530718 / uN;
          a = mod(a, seg);
          a = abs(a - seg * 0.5);
          a += 1.57079632679 - seg * 0.5;
          s = r * vec2(cos(a), sin(a));
        } else {
          if (p.y < uHorizon) {
            float d = uHorizon - p.y;
            s.y = uHorizon + d;
            float rip = uRipple + uWave * exp(-uWaveAge * 1.5) * 2.0;
            s.x += sin(d * 60.0 - uBeat * 3.0) * rip * d * 0.15 + sin(p.x * 9.0 + uBeat) * rip * 0.01;
            s.y += sin(d * 90.0 + uBeat * 4.0) * rip * d * 0.05;
            shade = uShade * exp(-d * 1.2);
          }
        }
        vec3 sym = texture2D(tDiffuse, clamp(toUv2(s), 0.0005, 0.9995)).rgb * shade;
        vec4 raw = texture2D(tDiffuse, vUv);
        gl_FragColor = vec4(mix(raw.rgb, sym, uMix), raw.a);
      }`,
    uniforms: {
      uMode: { value: 2 }, uN: { value: 8 }, uRot: { value: 0 }, uZoom: { value: 1.9 }, uMix: { value: 1 },
      uRipple: { value: 0.3 }, uHorizon: { value: -0.28 }, uShade: { value: 0.42 }, uWave: { value: 0 }, uWaveAge: { value: 9 },
    },
    update(ctx, u) {
      if (ctx.params.mix <= 0.001) return false
      const fold = ctx.held((pitch) => pitch >= ROW.fold0 && pitch < ROW.fold0 + 12)
      const n = fold ? 2 + (fold.pitch - ROW.fold0) : Math.round(ctx.params.segments)
      let turns = 0
      for (const h of ctx.hits(ROW.turn)) turns += ease.back(2.2).out(clamp(h.ageSec / 0.26))
      const wave = ctx.last(ROW.ripple)
      u.uMode.value = Math.round(ctx.params.mode)
      u.uN.value = n
      u.uRot.value = ctx.sec * ctx.params.spin + turns * ((Math.PI * 2) / n) * 0.5
      u.uZoom.value = ctx.params.zoom
      u.uMix.value = ctx.params.mix * ctx.opacity
      u.uRipple.value = ctx.params.ripple
      u.uHorizon.value = ctx.params.horizon
      u.uShade.value = ctx.params.shade
      u.uWave.value = wave ? wave.velocity : 0
      u.uWaveAge.value = wave ? wave.ageSec : 9
    },
  },
})
