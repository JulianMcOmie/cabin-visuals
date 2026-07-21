// Registry: collects every object instrument's definition into one map. Renderers
// resolve the visual component via the def (def.component). Adding an instrument =
// one new file + one import/entry here PLUS a picker entry (name/description/icon)
// in components/LeftSidebar.tsx's ALL_OBJECT_INSTRUMENTS - the add-track menu is a
// curated list and does NOT read this registry, so an instrument missing there is
// registered but unreachable.

import { cubeInstrument } from './Cube'
import { circleInstrument, triangleInstrument } from './shapes'
import { icosahedronBurstInstrument } from './IcosahedronBurst'
import { hexagonDotsInstrument } from './HexagonDots'
import { particleRiserInstrument } from './ParticleRiser'
import { textDisplayInstrument } from './TextDisplay'
import { starsInstrument } from './Stars'
import { particleBurstInstrument } from './ParticleBurst'
import { circleGridInstrument } from './CircleGrid'
import { fractalTunnelInstrument } from './FractalTunnel'
import { neonPolarInstrument } from './NeonPolar'
import { hopfFibrationInstrument } from './HopfFibration'
import { particleStreamsInstrument } from './ParticleStreams'
import { shapeFlightInstrument } from './ShapeFlight'
import { dotFieldInstrument } from './DotField'
import { metronomeBallsInstrument } from './MetronomeBalls'
import { folderFlightInstrument } from './FolderFlight'
import { emojiDisplayInstrument } from './EmojiDisplay'
import { cameraControlInstrument } from './CameraControl'
import { windowsXpInstrument } from './WindowsXP'
import { crtScanlinesInstrument } from './CrtScanlines'
import { filmStockInstrument, filmGrainInstrument } from './FilmStock'
import { scribbleInstrument } from './Scribble'
import { filmCardInstrument } from './FilmCard'
import { paddleBounceInstrument } from './PaddleBounce'
import { pixelBlastInstrument } from './PixelBlast'
import { pixelInvadersInstrument } from './PixelInvaders'
import { scoreTickerInstrument } from './ScoreTicker'
import { pointLightInstrument } from './PointLightObject'
import { videoInstrument } from './Video'
import { photoInstrument } from './Photo'
import { oscilloscopeInstrument } from './Oscilloscope'
import { colorFiltersInstrument } from './ColorFilters'
import { laserSphereInstrument } from './LaserSphere'
import { laserLineInstrument } from './LaserLine'
import { wormholeInstrument } from './Wormhole'
import { paramDefault, type ObjectInstrumentDef } from './types'

export type { ObjectInstrumentDef, ParamDef } from './types'

export const INSTRUMENTS: Record<string, ObjectInstrumentDef> = {
  [cubeInstrument.id]: cubeInstrument,
  [circleInstrument.id]: circleInstrument,
  [triangleInstrument.id]: triangleInstrument,
  [icosahedronBurstInstrument.id]: icosahedronBurstInstrument,
  [hexagonDotsInstrument.id]: hexagonDotsInstrument,
  [particleRiserInstrument.id]: particleRiserInstrument,
  [textDisplayInstrument.id]: textDisplayInstrument,
  [starsInstrument.id]: starsInstrument,
  [particleBurstInstrument.id]: particleBurstInstrument,
  [circleGridInstrument.id]: circleGridInstrument,
  [fractalTunnelInstrument.id]: fractalTunnelInstrument,
  [neonPolarInstrument.id]: neonPolarInstrument,
  [hopfFibrationInstrument.id]: hopfFibrationInstrument,
  [particleStreamsInstrument.id]: particleStreamsInstrument,
  [shapeFlightInstrument.id]: shapeFlightInstrument,
  [dotFieldInstrument.id]: dotFieldInstrument,
  [metronomeBallsInstrument.id]: metronomeBallsInstrument,
  [folderFlightInstrument.id]: folderFlightInstrument,
  [emojiDisplayInstrument.id]: emojiDisplayInstrument,
  [cameraControlInstrument.id]: cameraControlInstrument,
  [windowsXpInstrument.id]: windowsXpInstrument,
  [crtScanlinesInstrument.id]: crtScanlinesInstrument,
  [filmStockInstrument.id]: filmStockInstrument,
  [filmGrainInstrument.id]: filmGrainInstrument,
  [scribbleInstrument.id]: scribbleInstrument,
  [filmCardInstrument.id]: filmCardInstrument,
  [paddleBounceInstrument.id]: paddleBounceInstrument,
  [pixelBlastInstrument.id]: pixelBlastInstrument,
  [pixelInvadersInstrument.id]: pixelInvadersInstrument,
  [scoreTickerInstrument.id]: scoreTickerInstrument,
  [pointLightInstrument.id]: pointLightInstrument,
  [videoInstrument.id]: videoInstrument,
  [photoInstrument.id]: photoInstrument,
  [oscilloscopeInstrument.id]: oscilloscopeInstrument,
  [colorFiltersInstrument.id]: colorFiltersInstrument,
  [laserSphereInstrument.id]: laserSphereInstrument,
  [laserLineInstrument.id]: laserLineInstrument,
  [wormholeInstrument.id]: wormholeInstrument,
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
