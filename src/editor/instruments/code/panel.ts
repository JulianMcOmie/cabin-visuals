import type { KnobItem, PanelRowSpec, PanelSpec } from '../../userInterfaceRenderers/console/spec'
import type { CodeInstrumentSpec, ParamSpec } from './types'

// The console panel a code instrument gets when it doesn't declare one: its
// params laid out the way the hand-built consoles are - select params with a
// few options as segmented rows, numbers as knobs (the first one large), up to
// four per row with SHORT captions (knob captions are one word: the hand-built
// consoles say LENGTH, THICK, GLOW), colours as labelled pills. Booleans, text
// and long selects fall into the MORE disclosure. Data only: no React here, so
// this stays node-safe like the rest of the SDK.

const KEY = /^\w+$/
const PER_ROW = 4

/** One-word caption: a short label, else the key, capped at 7 letters. */
function caption(key: string, p: ParamSpec): string {
  const label = (p.label ?? '').trim()
  const first = label.split(/[\s(/-]+/)[0] ?? ''
  const pick = label && label.length <= 7 ? label : first.length >= 3 && first.length <= 7 ? first : key
  return pick.replace(/[^\w ]/g, '').slice(0, 7).toUpperCase()
}

export function autoPanel(spec: CodeInstrumentSpec): PanelSpec | undefined {
  const params = Object.entries(spec.params ?? {}).filter(([k]) => KEY.test(k))
  if (!params.length) return undefined
  const rows: PanelRowSpec[] = []
  for (const [k, p] of params) {
    if (p.kind === 'select' && !p.showIf && p.options.length <= 5) rows.push({ segmented: k })
  }
  // gated knobs are optional - the console skips params their showIf hides
  const knobs: KnobItem[] = params
    .filter(([, p]) => p.kind === 'num')
    .map(([k, p], i) => ({ param: k, label: caption(k, p), ...(i === 0 ? { large: true } : {}), ...(p.showIf ? { optional: true } : {}) }))
  for (let i = 0; i < knobs.length; i += PER_ROW) rows.push({ row: knobs.slice(i, i + PER_ROW) })
  const pills = params
    .filter(([, p]) => p.kind === 'color' && !p.showIf)
    .map(([k, p]) => ({ pill: k, label: caption(k, p) }))
  for (let i = 0; i < pills.length; i += PER_ROW) rows.push({ row: pills.slice(i, i + PER_ROW) })
  if (!rows.length) return undefined
  const firstColor = params.find(([, p]) => p.kind === 'color')
  return {
    accent: firstColor ? { param: firstColor[0], fallback: (firstColor[1] as { default: string }).default } : spec.color ?? '#56d8ff',
    testId: `code-${spec.id}`,
    rows,
  }
}
