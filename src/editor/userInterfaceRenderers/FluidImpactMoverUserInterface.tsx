'use client'

import { FLUID_IMPACT_COLOR } from '../core/visualCopies/identityColors'
import { consolePanel } from './console'

// Keep the six controls that shape the gesture in view. Field position, eddy
// scale and flow remain available in More and through ordinary automation.
export const FluidImpactMoverUserInterfaceRenderer = consolePanel({
  accent: FLUID_IMPACT_COLOR,
  testId: 'fluid-impact-panel',
  rows: [
    { row: ['strength*:IMPACT', 'radius:REACH', { param: 'decay', label: 'SETTLE', suffix: 'b' }] },
    { row: [{ param: 'curl', label: 'CURL', bipolar: true }, 'turbulence:SCATTER', 'rebound:REBOUND'] },
  ],
})
