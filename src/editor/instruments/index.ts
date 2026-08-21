// Registry: collects every object instrument's definition into one map. Renderers
// resolve the visual component via the def (def.component). Adding an instrument =
// one new file + one import/entry here PLUS a picker entry (name/description/icon)
// in components/LeftSidebar.tsx's ALL_OBJECT_INSTRUMENTS - the add-track menu is a
// curated list and does NOT read this registry, so an instrument missing there is
// registered but unreachable.

import { cubeInstrument } from './Cube'
import { kaleidoSolidInstrument } from './KaleidoSolid'
import { circleInstrument, triangleInstrument } from './shapes'
import { icosahedronBurstInstrument } from './IcosahedronBurst'
import { textDisplayInstrument } from './TextDisplay'
import { starsInstrument } from './Stars'
import { particleBurstInstrument } from './ParticleBurst'
import { fractalTunnelInstrument } from './FractalTunnel'
import { neonPolarInstrument } from './NeonPolar'
import { hopfFibrationInstrument } from './HopfFibration'
import { shapeFlightInstrument } from './ShapeFlight'
import { dotFieldInstrument } from './DotField'
import { metronomeBallsInstrument } from './MetronomeBalls'
import { emojiDisplayInstrument } from './EmojiDisplay'
import { cameraControlInstrument } from './CameraControl'
import { cameraOrbitInstrument } from './CameraOrbit'
import { filmStockInstrument, filmGrainInstrument } from './FilmStock'
import { scribbleInstrument } from './Scribble'
import { filmCardInstrument } from './FilmCard'
import { pixelBlastInstrument } from './PixelBlast'
import { videoInstrument } from './Video'
import { photoInstrument } from './Photo'
import { oscilloscopeInstrument } from './Oscilloscope'
import { colorFiltersInstrument } from './ColorFilters'
import { bassRippleInstrument } from './BassRipple'
import { impactWarpInstrument } from './ImpactWarp'
import { strobeInstrument } from './Strobe'
import { laserSphereInstrument } from './LaserSphere'
import { laserLineInstrument } from './LaserLine'
import { wormholeInstrument } from './Wormhole'
import { particleSphereInstrument } from './ParticleSphere'
import { photoSlotInstrument } from './PhotoSlot'
import { polyFxInstrument } from './PolyFx'
import { waterDropInstrument } from './WaterDrop'
import { flashWallInstrument } from './FlashWall'
import { overlapShapeInstrument } from './OverlapShape'
import { overlapSolidInstrument } from './OverlapSolid'
import { cropMaskInstrument } from './Crop'
import { midiRollInstrument } from './MidiRoll'
import { starfieldInstrument } from './Starfield'
import { wireframeInstrument } from './Wireframe'
import type { ObjectInstrumentDef } from './types'
import { preloadComponent } from './lazyInstrument'

export type { ObjectInstrumentDef, ParamDef } from './types'

export const INSTRUMENTS: Record<string, ObjectInstrumentDef> = {
  [cubeInstrument.id]: cubeInstrument,
  [kaleidoSolidInstrument.id]: kaleidoSolidInstrument,
  [circleInstrument.id]: circleInstrument,
  [triangleInstrument.id]: triangleInstrument,
  [icosahedronBurstInstrument.id]: icosahedronBurstInstrument,
  [textDisplayInstrument.id]: textDisplayInstrument,
  [starsInstrument.id]: starsInstrument,
  [particleBurstInstrument.id]: particleBurstInstrument,
  [fractalTunnelInstrument.id]: fractalTunnelInstrument,
  [neonPolarInstrument.id]: neonPolarInstrument,
  [hopfFibrationInstrument.id]: hopfFibrationInstrument,
  [shapeFlightInstrument.id]: shapeFlightInstrument,
  [dotFieldInstrument.id]: dotFieldInstrument,
  [metronomeBallsInstrument.id]: metronomeBallsInstrument,
  [emojiDisplayInstrument.id]: emojiDisplayInstrument,
  [cameraControlInstrument.id]: cameraControlInstrument,
  [cameraOrbitInstrument.id]: cameraOrbitInstrument,
  [filmStockInstrument.id]: filmStockInstrument,
  [filmGrainInstrument.id]: filmGrainInstrument,
  [scribbleInstrument.id]: scribbleInstrument,
  [filmCardInstrument.id]: filmCardInstrument,
  [pixelBlastInstrument.id]: pixelBlastInstrument,
  [videoInstrument.id]: videoInstrument,
  [photoInstrument.id]: photoInstrument,
  [oscilloscopeInstrument.id]: oscilloscopeInstrument,
  [colorFiltersInstrument.id]: colorFiltersInstrument,
  [bassRippleInstrument.id]: bassRippleInstrument,
  [impactWarpInstrument.id]: impactWarpInstrument,
  [strobeInstrument.id]: strobeInstrument,
  [laserSphereInstrument.id]: laserSphereInstrument,
  [laserLineInstrument.id]: laserLineInstrument,
  [wormholeInstrument.id]: wormholeInstrument,
  [particleSphereInstrument.id]: particleSphereInstrument,
  [photoSlotInstrument.id]: photoSlotInstrument,
  [polyFxInstrument.id]: polyFxInstrument,
  [waterDropInstrument.id]: waterDropInstrument,
  [flashWallInstrument.id]: flashWallInstrument,
  [overlapShapeInstrument.id]: overlapShapeInstrument,
  [overlapSolidInstrument.id]: overlapSolidInstrument,
  [cropMaskInstrument.id]: cropMaskInstrument,
  [midiRollInstrument.id]: midiRollInstrument,
  [starfieldInstrument.id]: starfieldInstrument,
  [wireframeInstrument.id]: wireframeInstrument,
}

export function getInstrument(id: string): ObjectInstrumentDef | undefined {
  return INSTRUMENTS[id]
}

// Components are lazy chunks (see lazyInstrument.ts): the def is metadata, the
// visual arrives when fetched. Preloading from the project's track list means
// the chunks are in memory before the scene mounts them, so first paint does
// not suspend per instrument.
const preloaded = new Set<string>()

/** Start fetching one instrument's visual (idempotent, cheap once started). */
export function preloadInstrument(id: string): Promise<void> {
  const def = INSTRUMENTS[id]
  if (!def) return Promise.resolve()
  preloaded.add(id)
  return Promise.all([preloadComponent(def.component), preloadComponent(def.instancedComponent)]).then(() => undefined)
}

/** Preload every instrument the project's tracks name. Called on every store
 *  change, so it does the minimum: a Set test per track, a fetch per new id. */
export function preloadProjectInstruments(scenes: Record<string, { tracks: Record<string, { instrumentId?: string }> }>): void {
  for (const scene of Object.values(scenes)) {
    for (const track of Object.values(scene.tracks)) {
      const id = track.instrumentId
      if (id && !preloaded.has(id) && INSTRUMENTS[id]) void preloadInstrument(id)
    }
  }
}
