// Registry: collects every object instrument's definition into one map. Adding an
// instrument = one new file + one import/entry here. Nothing else hardcodes the
// list, and renderers resolve the visual component via the def (def.component).

import { cubeInstrument } from './Cube'
import { circleInstrument, triangleInstrument } from './shapes'
import { icosahedronBurstInstrument } from './IcosahedronBurst'
import { hexagonDotsInstrument } from './HexagonDots'
import { cylinderFlightInstrument } from './CylinderFlight'
import { sunInstrument } from './Sun'
import { particleRiserInstrument } from './ParticleRiser'
import { textDisplayInstrument } from './TextDisplay'
import { squareInstrument } from './Square'
import { starsInstrument } from './Stars'
import { particleBurstInstrument } from './ParticleBurst'
import { circleGridInstrument } from './CircleGrid'
import { silkSymmetryInstrument } from './SilkSymmetry'
import { fractalTunnelInstrument } from './FractalTunnel'
import { diamondLatticeInstrument } from './DiamondLattice'
import { neonPolarInstrument } from './NeonPolar'
import { hopfFibrationInstrument } from './HopfFibration'
import { particleStreamsInstrument } from './ParticleStreams'
import { particleBassRingInstrument } from './ParticleBassRing'
import { shapeFlightInstrument } from './ShapeFlight'
import { dotFieldInstrument } from './DotField'
import { metronomeBallsInstrument } from './MetronomeBalls'
import { folderFlightInstrument } from './FolderFlight'
import { emojiDisplayInstrument } from './EmojiDisplay'
import { paramDefault, type ObjectInstrumentDef } from './types'

export type { ObjectInstrumentDef, ParamDef, PortDef } from './types'

export const INSTRUMENTS: Record<string, ObjectInstrumentDef> = {
  [cubeInstrument.id]: cubeInstrument,
  [circleInstrument.id]: circleInstrument,
  [triangleInstrument.id]: triangleInstrument,
  [icosahedronBurstInstrument.id]: icosahedronBurstInstrument,
  [hexagonDotsInstrument.id]: hexagonDotsInstrument,
  [cylinderFlightInstrument.id]: cylinderFlightInstrument,
  [sunInstrument.id]: sunInstrument,
  [particleRiserInstrument.id]: particleRiserInstrument,
  [textDisplayInstrument.id]: textDisplayInstrument,
  [squareInstrument.id]: squareInstrument,
  [starsInstrument.id]: starsInstrument,
  [particleBurstInstrument.id]: particleBurstInstrument,
  [circleGridInstrument.id]: circleGridInstrument,
  [silkSymmetryInstrument.id]: silkSymmetryInstrument,
  [fractalTunnelInstrument.id]: fractalTunnelInstrument,
  [diamondLatticeInstrument.id]: diamondLatticeInstrument,
  [neonPolarInstrument.id]: neonPolarInstrument,
  [hopfFibrationInstrument.id]: hopfFibrationInstrument,
  [particleStreamsInstrument.id]: particleStreamsInstrument,
  [particleBassRingInstrument.id]: particleBassRingInstrument,
  [shapeFlightInstrument.id]: shapeFlightInstrument,
  [dotFieldInstrument.id]: dotFieldInstrument,
  [metronomeBallsInstrument.id]: metronomeBallsInstrument,
  [folderFlightInstrument.id]: folderFlightInstrument,
  [emojiDisplayInstrument.id]: emojiDisplayInstrument,
}

export function getInstrument(id: string): ObjectInstrumentDef | undefined {
  return INSTRUMENTS[id]
}

/** A track's current value for a param, falling back to the instrument's default. */
export function paramValue(
  track: { instrumentId: string; params?: Record<string, number> },
  key: string,
): number {
  const def = INSTRUMENTS[track.instrumentId]
  if (!def) return 0
  return track.params?.[key] ?? paramDefault(def, key)
}
