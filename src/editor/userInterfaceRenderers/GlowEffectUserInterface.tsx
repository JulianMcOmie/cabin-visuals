'use client'
import { bindPanel, Console, ControlRow, Knob, More } from './console'
import { GLOW_PRESETS, glowPlugin } from '../effects/shaders/glow'
import type { UserInterfaceRendererDefinition } from './types'

export const GlowEffectUserInterfaceRenderer: UserInterfaceRendererDefinition = ({ parameters }) => {
  const b = bindPanel(parameters)
  const strength = b.num('strength'),
    radius = b.num('radius'),
    spread = b.num('spread')
  const source = parameters.find((p) => p.definition.key === 'source')?.value ?? 1
  const rest = b.rest().filter((p) => !['threshold', 'softness'].includes(p.definition.key) || source === 0)
  return (
    <Console accent={glowPlugin.accent!}>
      <ControlRow spill>
        <Knob b={strength} label="STRENGTH" />
        <Knob b={radius} label="RADIUS" format={(v) => `${Math.round(v)} px`} />
        <Knob b={spread} label="SPREAD" />
      </ControlRow>
      <div className="flex flex-wrap gap-1 px-3 pb-3" aria-label="Glow presets">
        {Object.entries(GLOW_PRESETS).map(([name, settings]) => (
          <button
            key={name}
            type="button"
            className="rounded border border-white/10 bg-white/5 px-2 py-1 text-[10px] text-white/60 hover:bg-white/10 hover:text-white/90"
            onClick={() => {
              for (const p of parameters)
                if (settings[p.definition.key] !== undefined) p.setValue(settings[p.definition.key])
            }}
          >
            {name}
          </button>
        ))}
      </div>
      <More parameters={rest} label="SOURCE · COLOR · CORE · SHAPE" />
      <p className="px-3 pb-3 text-[10px] leading-relaxed text-white/35">
        Core brightness 1 and white-hot 0 preserve the original. Stretch 1 is round; orientation 0° is
        horizontal and 90° is vertical. Radius uses a 1080px frame reference.
      </p>
    </Console>
  )
}
