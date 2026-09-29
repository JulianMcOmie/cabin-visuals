import type { Matrix4 } from 'three'
import { memoizeEvaluation } from './evaluationMemo'
import type { MoverOrSplitter, SharedLocalLayout } from './types'

type Sampler = (beat: number, placementTransform?: Matrix4) => SharedLocalLayout
interface LayoutOptions { usesPlacement?: boolean; count?: number }

function checked(layout: SharedLocalLayout): SharedLocalLayout {
  const count = layout.transforms.length
  if ((layout.opacities && layout.opacities.length !== count)
    || (layout.hueShifts && layout.hueShifts.length !== count)) {
    throw new Error('Shared local layout appearance channels must match its slot count')
  }
  return layout
}

/** Build the reference evaluator and compact proof from the SAME immutable slot
 * table. Dynamic layouts retain one recent sample and share interleaved clocks
 * within an evaluation; no playback history or per-copy transform is retained.
 * Placement contents are checked because callers may edit a Matrix4 in place. */
export function sharedLocalLayout(layout: SharedLocalLayout | Sampler, options: LayoutOptions = {}): MoverOrSplitter {
  const fixed = typeof layout === 'function' ? undefined : checked(layout)
  type Sample = { elements?: readonly number[]; layout: SharedLocalLayout }
  const samples = memoizeEvaluation((_beat: number) => new Map<Matrix4 | undefined, Sample>())
  let lastBeat: number | undefined, lastPlacement: Matrix4 | undefined, last: Sample | undefined
  const samePlacement = (sample: Sample, placement?: Matrix4) => placement
    ? !!sample.elements && placement.elements.every((value, index) => Object.is(value, sample.elements![index]))
    : sample.elements === undefined
  const sample = (beat: number, inputPlacement?: Matrix4): SharedLocalLayout => {
    if (fixed) return fixed
    const placement = options.usesPlacement ? inputPlacement : undefined
    if (last && Object.is(lastBeat, beat) && lastPlacement === placement && samePlacement(last, placement)) return last.layout
    const byPlacement = samples(beat)
    let cached = byPlacement.get(placement)
    if (!cached || !samePlacement(cached, placement)) {
      cached = { elements: placement?.elements.slice(), layout: checked((layout as Sampler)(beat, placement)) }
      if (options.count !== undefined && cached.layout.transforms.length !== options.count) {
        throw new Error('Shared local layout violated its fixed slot count')
      }
      byPlacement.set(placement, cached)
    }
    lastBeat = beat; lastPlacement = placement; last = cached
    return cached.layout
  }
  return {
    cachePolicy: fixed ? 'static' : 'beat',
    ...(fixed ? (fixed.opacities || fixed.hueShifts
      ? { localLayout: fixed } : { localTransforms: fixed.transforms }) : {
      localLayoutAtBeat: sample,
      ...(options.usesPlacement ? { localLayoutUsesPlacement: true } : {}),
      ...(options.count !== undefined ? { localLayoutCount: options.count } : {}),
    }),
    apply(copy, context) {
      const slots = sample(context.beat, context.placementTransform)
      return slots.transforms.map((transform, index) => {
        const colorShift = { ...copy.colorShift }
        if (slots.hueShifts) colorShift.hue += slots.hueShifts[index]
        return {
          transform: copy.transform.clone().multiply(transform),
          opacity: slots.opacities ? copy.opacity * slots.opacities[index] : copy.opacity,
          colorShift,
        }
      })
    },
  }
}
