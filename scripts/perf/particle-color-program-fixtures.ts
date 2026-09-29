import { Matrix4, Vector3 } from 'three'
import { getMoverOrSplitterDefinition } from '../../src/editor/core/visualCopies/registry'
import { mergeDefinitionSettings } from '../../src/editor/core/visualCopies/definitions'
import { sharedLocalLayout } from '../../src/editor/core/visualCopies/sharedLocalLayout'
import { splitterWithChildChain } from '../../src/editor/core/visualCopies/splitterChildChain'
import { gatedMoverOrSplitter } from '../../src/editor/core/visualCopies/copyTargets'
import { bypassGated } from '../../src/editor/core/visualCopies/bypass'
import { switchGated, switcherVariantsFor, SWITCHER_GATE } from '../../src/editor/core/visualCopies/switcher'
import { framedMoverOrSplitter } from '../../src/editor/core/visualCopies/moverFrame'
import type { MoverOrSplitter } from '../../src/editor/core/visualCopies/types'
import type { ResolvedNote } from '../../src/editor/core/visual/types'

export const COLOR_IDS = ['cosinePalette', 'gradient', 'riso', 'hueRotate', 'calmHueRotate'] as const
export const colorNote = (beat = 0, pitch = 60, velocity = 1, durationBeats = 2): ResolvedNote =>
  ({ beat, pitch, velocity, durationBeats, blockStartBeat: 0, blockEndBeat: 64 })
export function colorEntry(id: string, settings: Record<string, number> = {}, notes: ResolvedNote[] = [], strings: Record<string, string> = {}): MoverOrSplitter {
  const definition = getMoverOrSplitterDefinition(id)!
  return definition.resolve({ settings: mergeDefinitionSettings(definition, settings, strings), notes })
}
export function radialPopulation(levels = 4) {
  return Array.from({ length: levels }, (_, i) => colorEntry('radial', { copies: 32, radius: 2.1 / 3.5 ** i, plane: i % 3, tilt: 11 + i * 7 }))
}
export function largeGradientPath() {
  const point = (t: number) => [2.2 * Math.cos(t), 1.7 * Math.sin(t), .6 * Math.sin(t * .7)]
  return JSON.stringify(Array.from({ length: 64 }, (_, i) => {
    const t = i / 63 * Math.PI * 6, dt = Math.PI * 6 / 63 / 3
    return { point: point(t), incoming: point(t - dt), outgoing: point(t + dt) }
  }))
}
export interface ColorFrameCase {
  name: string
  chain: MoverOrSplitter[]
  beat: number
  placement: Matrix4
  objectOpacity: number
  size: number
  glow: number
  color: string
  repeat?: string
}
export function colorFrameCases(): ColorFrameCase[] {
  const grid = () => colorEntry('grid', { rows: 5, columns: 7, depth: 3, spacing: .73 })
  const tail = () => colorEntry('radial', { copies: 3, radius: .13, plane: 1, tilt: 17 })
  const fluid = () => colorEntry('fluidImpact', { strength: 1.2, radius: 6 }, [colorNote(0), colorNote(.5, 60, .7)])
  const make = (name: string, chain: MoverOrSplitter[], changes: Partial<ColorFrameCase> = {}): ColorFrameCase => ({
    name, chain, beat: .7, placement: new Matrix4(), objectOpacity: .7, size: .07, glow: .2, color: '#bc734d', ...changes,
  })
  const frames: ColorFrameCase[] = []
  const placed = new Matrix4().makeRotationZ(.27).scale(new Vector3(.9, 1.1, 1.3)).setPosition(.21, -.13, .17)
  for (const mode of [0, 1, 2, 3, 4, 5]) for (const blend of [0, 1]) {
    frames.push(make(`cosine-map-${mode}-blend-${blend}`, [grid(), colorEntry('cosinePalette', {
      mode, blend, amount: .55, scroll: -.137, span: 3.7, offset: .213, cycles: 1.5,
    }, [colorNote(0), colorNote(.3, 60, .5)])], { placement: placed }))
  }
  frames.push(make('cosine-negative-periods-and-clamp', [grid(), colorEntry('cosinePalette', {
    mode: 0, amount: 1.3, bright: .8, range: .8, scroll: -3.723, cycles: 3.5, span: .31,
  })]))
  for (const mode of [0, 1, 2, 3, 4]) for (const mapping of mode >= 3 ? [0, 1] : [0]) {
    frames.push(make(`gradient-map-${mode}-mapping-${mapping}`, [grid(), colorEntry('gradient', {
      mode, mapping, amount: .6, angle: 37, span: 2.7, near: 1.2, far: -.7, width: 1.7,
    }, [], { colorA: '#33114f', colorB: '#81efd3', path: JSON.stringify([
      { point: [-2, -.8, -.2], incoming: [-2, -1, 0], outgoing: [-1, 2, 1] },
      { point: [.2, .3, .1], incoming: [-.7, -1, .4], outgoing: [1, -2, .4] },
      { point: [2, .7, -.3], incoming: [1, 1, -.2], outgoing: [2, 1, 0] },
    ]) })], { placement: placed }))
  }
  frames.push(make('gradient-grey-endpoints-and-flat-depth', [grid(), colorEntry('gradient', {
    mode: 2, near: 1, far: 1, amount: .5,
  }, [], { colorA: '#000000', colorB: '#aaaaaa' })]))
  for (const mode of [0, 1, 2, 3, 4, 5]) for (const dither of [0, 1, 2]) {
    frames.push(make(`riso-map-${mode}-dither-${dither}`, [grid(), colorEntry('riso', {
      mode, dither, span: 3.4, offset: .13, grain: .73, tone: -.17, ink: .12, amount: .65, blend: mode % 2,
    })], { placement: placed }))
  }
  frames.push(make('riso-exact-unscreened-tie', [colorEntry('line', { copies: 5, spacing: .4 }),
    colorEntry('riso', { mode: 5, dither: 2, ink: 0, amount: 1 })]))
  for (const mode of [0, 1, 2, 3, 4, 5]) for (const hueMode of [0, 1]) {
    frames.push(make(`hue-map-${mode}-circle-${hueMode}`, [grid(), colorEntry('hueRotate', {
      mode, hueMode, rotate: -.13, spread: 1.7, continuous: 1, speed: -.17,
      saturation: .2, lightness: -.06, span: 3.4, offset: .13,
    })], { placement: placed }))
  }
  const notes = [colorNote(0, 60, .9, .8), colorNote(.3, 62, .6, 1.2), colorNote(.2, 61, .7, 2),
    colorNote(.4, 63, .4, .5), colorNote(0, 60, .3, 3)]
  for (const shape of [0, 1, 2]) for (const staggerBeats of [0, -.017, .017]) {
    frames.push(make(`note-colorizer-shape-${shape}-roll-${staggerBeats}`, [grid(), colorEntry('calmHueRotate', {
      shape, staggerBeats, attackBeats: .3, releaseBeats: .7, intensity: .65, rainbowSpread: .2,
    }, notes)], { placement: placed }))
  }
  frames.push(make('note-colorizer-born-falls-back-to-live', [grid(), colorEntry('calmHueRotate', { sample: 1 }, notes)]))
  const cosine = () => colorEntry('cosinePalette', { mode: 5, blend: 0, amount: .6, scroll: .13 })
  const gradient = () => colorEntry('gradient', { mode: 1, amount: .4 })
  const hue = () => colorEntry('hueRotate', { mode: 5, rotate: .17, spread: -.7, saturation: .2, lightness: -.1 })
  frames.push(make('color-before-later-fanout', [grid(), cosine(), tail()]),
    make('color-before-later-displacement', [grid(), colorEntry('cosinePalette', { mode: 0, span: 3.7 }), fluid(), tail()]),
    make('color-after-fluid', [grid(), fluid(), cosine(), tail()]),
    make('all-five-colorizers-in-order', [grid(), cosine(), gradient(), hue(), colorEntry('riso', { amount: .65 }), colorEntry('calmHueRotate', {}, notes)]),
    make('gradient-inherits-perceptual-tint', [grid(), cosine(), gradient(), hue()]),
    make('last-tint-wins-before-final-relative-hue', [grid(), hue(), gradient(), cosine(), hue()]),
    make('silent-note-colorizer-preserves-upstream', [grid(), cosine(), hue(), colorEntry('calmHueRotate', {}, [colorNote(9)])]),
    make('zero-amount-colorizers-preserve-upstream', [grid(), cosine(), ...['gradient', 'riso', 'cosinePalette'].map(id => colorEntry(id, { amount: 0 })), hue()]))
  const nested = splitterWithChildChain(colorEntry('radial', { copies: 5, radius: 1.2 }),
    [colorEntry('mover', { motion: 1, mode: 1, angleX: 17, angleY: 29, angleZ: 13 })])
  frames.push(make('color-reads-frame-before-internal-fold', [nested, colorEntry('cosinePalette', { mode: 0, span: 2.7 }), tail()]))
  const inherited = sharedLocalLayout({ transforms: [new Matrix4(), new Matrix4().makeScale(0, 1, 1),
    new Matrix4().makeScale(-.7, 1.2, .8)], opacities: [.3, .5, .7], hueShifts: [.13, -.2, .37] })
  frames.push(make('appearance-plus-singular-copies', [grid(), inherited, cosine(), hue()], { objectOpacity: 2.5 }))
  const seeks = [grid(), fluid(), colorEntry('cosinePalette', { mode: 3 }, notes), hue()]
  frames.push(make('seek-start', seeks), make('seek-later', seeks, { beat: 1.8 }),
    make('seek-negative', seeks, { beat: -.5 }), make('seek-restored', seeks, { repeat: 'seek-start' }))
  for (const staggerBeats of [-.017, .017]) {
    frames.push(make(`note-rainbow-equal-gain-original-order-${staggerBeats}`, [grid(), colorEntry('calmHueRotate', {
      staggerBeats, attackBeats: 0, releaseBeats: 0, rainbowRate: .7,
    }, [colorNote(.5, 61, 1, 5), colorNote(0, 61, 1, 5)])], { beat: 1.3 }))
  }
  frames.push(make('invalid-note-tint-overrides-upstream-without-rendering-invalid-color', [grid(), cosine(),
    colorEntry('calmHueRotate', { intensity: .8 }, [colorNote()], { color: 'hsl(220,80%,40%)' })]))
  frames.push(make('mixed-case-note-hex-and-stagger', [grid(), colorEntry('calmHueRotate', {
    staggerBeats: -.013, intensity: .7,
  }, [colorNote(0, 60, 1, 4)], { color: '#AbCDeF' })]))
  frames.push(make('gradient-maximum-64-node-curve', [grid(), colorEntry('gradient', {
    mode: 4, mapping: 0, amount: .8,
  }, [], { path: largeGradientPath() })]))
  frames.push(make('nested-colorizer-after-upstream-grid', [grid(), splitterWithChildChain(
    colorEntry('radial', { copies: 5, radius: .37 }), [cosine(), hue()])], { placement: placed }))
  frames.push(make('nested-color-and-fluid-order', [grid(), splitterWithChildChain(
    colorEntry('radial', { copies: 5, radius: .37 }), [colorEntry('cosinePalette', { mode: 0, span: 2.7 }), fluid(), gradient()]), hue()],
    { placement: placed }))
  frames.push(make('nested-colorizer-under-two-splitter-levels', [colorEntry('radial', { copies: 7, radius: 2.1 }), splitterWithChildChain(
    colorEntry('radial', { copies: 5, radius: .6 }), [splitterWithChildChain(colorEntry('radial', { copies: 3, radius: .17 }),
      [colorEntry('riso', { mode: 5, dither: 1 }), hue()])])], { placement: placed }))
  for (const rule of ['every', 'runs'] as const) frames.push(make(`targeted-colorizer-${rule}-before-fanout`, [grid(),
    gatedMoverOrSplitter(cosine(), { rule, slices: 3, on: [0, 2] }), tail(), hue()]))
  const gated = bypassGated(cosine(), [beat => beat >= 1 && beat < 2])
  const switched = switchGated(gated, beat => beat < 2, switcherVariantsFor(gated, SWITCHER_GATE, 0, 2))
  const gates = [grid(), gradient(), switched, tail()]
  frames.push(make('colorizer-gates-live', gates, { beat: .3 }), make('colorizer-bypassed', gates, { beat: 1.2 }),
    make('colorizer-switched-off', gates, { beat: 2.1 }))
  const framed = framedMoverOrSplitter(colorEntry('cosinePalette', { mode: 0, span: 3.7 }), [
    colorEntry('mover', { motion: 1, mode: 1, angleZ: 29, angleY: 17 }),
    colorEntry('mover', { motion: 0, mode: 1, distanceX: .3, distanceY: -.2 }, [colorNote()]),
  ])
  const framedChain = [grid(), framed, tail()]
  frames.push(make('framed-colorizer-placement', framedChain, { placement: placed }),
    make('framed-colorizer-held-beat-placement-edit', framedChain, { placement: placed.clone().setPosition(.8, -.4, .7) }),
    make('framed-colorizer-placement-restored', framedChain, { placement: placed, repeat: 'framed-colorizer-placement' }))
  for (const grouping of [0, 25, -1]) frames.push(make(`visibility-grouping-${grouping}`, [grid(), cosine(),
    colorEntry('visibility', { grouping, attackBeats: .1, decayBeats: .2, sustainLevel: .4, releaseBeats: .7 },
      [colorNote(0, 127, .1, .5), colorNote(.1, 125, 1, .7)]), tail()], { objectOpacity: 2.5 }))
  frames.push(make('nested-visibility-after-upstream-color', [grid(), cosine(), splitterWithChildChain(
    colorEntry('radial', { copies: 5, radius: .37 }), [colorEntry('visibility', {
      grouping: 0, attackBeats: 0, sustainLevel: .4,
    }, [colorNote(0, 127, 1, 2), colorNote(0, 125, 1, 2)]), hue()])], { objectOpacity: 2.5 }))
  return frames
}
