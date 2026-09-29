import { defineInstrument, p, clamp, ease, lerp } from '../../code'

// Flight Rig: the camera and the grade, played by the song's shared lanes
// (ctx.lane - one Kick lane drives this, the orb and the sand alike). Kicks
// push the camera in and flare the bloom and chromatic aberration; each snare
// banks the roll the other way; the frame sways on a slow Lissajous. Draws
// nothing itself - drop it into any scene (it owns THE camera while that
// scene is on screen, and hands it back when the scene cuts away).

export const instrument = defineInstrument({
  id: 'innuendo.rig',
  name: 'Flight Rig',
  description: 'Flies the camera and grades the frame from the song lanes: dolly pushes on kicks, banked rolls on snares, aberration + bloom flares on hits.',
  color: '#f472b6',
  params: {
    distance: p.num(5, 1, 20),
    sway: p.num(0.5, 0, 3),
    push: p.num(0.9, 0, 4, { label: 'Kick push' }),
    roll: p.num(0.22, 0, 1.5, { label: 'Snare bank (rad)' }),
    aberration: p.num(4, 0, 24, { label: 'Hit aberration (px)' }),
    bloom: p.num(0.6, 0, 3, { label: 'Hit bloom' }),
    kick: p.text('Kick', { label: 'Kick lane' }),
    snare: p.text('Snare', { label: 'Snare lane' }),
  },

  camera(ctx) {
    const kick = ctx.lane(ctx.text.kick)
    const snare = ctx.lane(ctx.text.snare)
    const k = clamp(kick.pulse(undefined, 0.3))
    // bank alternates per snare; the swing from the previous bank eases in over half a beat
    const n = snare.count()
    const last = snare.last()
    const bank = (i: number) => (i <= 0 ? 0 : (i % 2 ? 1 : -1) * ctx.params.roll)
    const roll = last ? lerp(bank(n - 1), bank(n), ease.expo.out(clamp(last.age / 0.5))) : 0
    const s = ctx.params.sway
    return {
      position: [Math.sin(ctx.bar * 0.5) * s, Math.cos(ctx.bar * 0.37) * s * 0.5, ctx.params.distance - ctx.params.push * k],
      target: [0, 0, 0],
      roll,
    }
  },

  look(ctx) {
    const k = clamp(ctx.lane(ctx.text.kick).pulse(undefined, 0.25))
    const sn = clamp(ctx.lane(ctx.text.snare).pulse(undefined, 0.2))
    const hit = Math.max(k, sn * 0.8)
    return {
      aberration: ctx.params.aberration * hit,
      bloom: 0.9 + ctx.params.bloom * hit,
      vignette: 0.82 - 0.15 * hit,
    }
  },
})
