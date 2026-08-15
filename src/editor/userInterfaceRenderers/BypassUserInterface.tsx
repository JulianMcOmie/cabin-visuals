'use client'

// Bypass's console: one segmented control and a sentence.
//
// The segment IS the whole device, so it gets the panel to itself - but a
// polarity switch is the one control that cannot be read off its own labels
// ("Switch off" against what? for how long?). The line underneath states the
// resting behaviour and the note behaviour in that order, which is the order
// the user experiences them, and it is worth the ~30px precisely because
// getting the polarity backwards looks identical to the device not working.

import { bindPanel, Console, ParameterList, Segmented } from './console'
import { BYPASS_COLOR } from '../core/visualCopies/identityColors'
import { BYPASS_ON_REST } from '../core/visualCopies/bypass'
import type { UserInterfaceRendererDefinition } from './types'

const EXPLANATION: Record<number, string> = {
  0: 'The device above runs as usual. Each note switches it off for the note’s length.',
  1: 'The device above is off. Each note switches it on for the note’s length.',
}

export const BypassUserInterfaceRenderer: UserInterfaceRendererDefinition = ({ parameters }) => {
  const b = bindPanel(parameters)
  const mode = b.select('mode')
  if (b.missing || !mode) return <ParameterList parameters={parameters} />

  return (
    <Console accent={BYPASS_COLOR}>
      <div className="px-4 pt-3">
        <Segmented b={mode} name="Notes" />
        <p className="mt-2.5 mb-3 text-[11px] leading-[1.45] text-[var(--text-3)]">
          {EXPLANATION[Math.round(mode.value) === BYPASS_ON_REST ? 1 : 0]}
        </p>
      </div>
    </Console>
  )
}
