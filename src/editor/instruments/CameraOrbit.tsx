import { useRef } from 'react'
import { useThree } from '@react-three/fiber'
import { PerspectiveCamera, Vector3 } from 'three'
import { useInstrumentFrame } from '../core/visual/instrumentFrame'
import {
  CAMERA_ORBIT_ROWS,
  DEFAULT_ORBIT_AXIS,
  ORBIT_AXES,
  RETURN_EASINGS,
  evaluateOrbitAngles,
  orbitCameraPosition,
  orbitCameraUp,
  type CameraOrbitSettings,
} from './cameraOrbitCore'
import { paramDefault, type ObjectInstrumentDef, type ParamDef } from './types'

// Camera Orbit renders no mesh - like Camera, it drives the scene camera each
// frame. Where Camera exposes a position and a rotation, this one exposes an aim
// point plus a ring to walk and derives the rest, so the rig physically cannot
// stop looking at the center: every control changes where it STANDS, and the aim
// is recomputed from the center every frame. That is the difference worth having
// two camera instruments for. All the math lives in cameraOrbitCore.ts so it can
// be tested.
//
// Notes drive it in the hold-to-orbit grammar: while a direction row is held the
// rig travels at Speed °/beat (scaled by velocity) and STAYS where it was
// released; holding two rows at once combines their axes into a diagonal sweep;
// a held Return home row eases everything back to the resting angles. Neither
// axis has an end - hold a row long enough and the rig laps, vertically as
// readily as horizontally.
//
// Like Camera, this instrument OWNS the camera while its track is active -
// nothing else in the scene writes it (the Canvas ships a plain default camera
// at [0,0,5], fov 55, and there are no OrbitControls). Two camera tracks at once
// therefore fight, last-mounted winning; that is the same accepted trade Camera
// documents, not something to guard against.

const DEFAULT_DISTANCE = 5
const DEFAULT_FOV = 55

const PARAMS: ParamDef[] = [
  // The pivot: what the rig circles and what it points at. The origin is where
  // an untransformed object is placed, so the default needs no setting up.
  { key: 'centerX', label: 'Center X', min: -20, max: 20, step: 0.1, default: 0 },
  { key: 'centerY', label: 'Center Y', min: -20, max: 20, step: 0.1, default: 0 },
  { key: 'centerZ', label: 'Center Z', min: -20, max: 20, step: 0.1, default: 0 },
  {
    key: 'orbitAxis',
    label: 'Orbit axis',
    type: 'select',
    options: ORBIT_AXES.map((axis, value) => ({ value, label: axis.label })),
    default: DEFAULT_ORBIT_AXIS,
  },
  // The ring. Standoff is the number the shot holds still for a whole lap;
  // radius is how wide a circle it walks. Turntable with standoff 0 and radius 5
  // IS the scene's stock camera, so dropping the instrument in changes nothing
  // until a knob moves - and so is Face-on with standoff 5 and radius 0.
  { key: 'standoff', label: 'Standoff', min: -60, max: 60, step: 0.25, default: 0 },
  { key: 'radius', label: 'Radius', min: 0, max: 60, step: 0.25, default: DEFAULT_DISTANCE },
  { key: 'azimuth', label: 'Angle (°)', min: -180, max: 180, step: 1, default: 0 },
  { key: 'fov', label: 'Field of View', min: 10, max: 120, step: 5, default: DEFAULT_FOV },
  { key: 'swingSpeed', label: 'Swing speed (°/beat)', min: 0, max: 720, step: 5, default: 90 },
  { key: 'tiltSpeed', label: 'Tilt speed (°/beat)', min: 0, max: 720, step: 5, default: 45 },
  { key: 'returnBeats', label: 'Return beats', min: 0.05, max: 16, step: 0.05, default: 1 },
  {
    key: 'returnEase',
    label: 'Return ease',
    type: 'select',
    options: RETURN_EASINGS.map((easing, value) => ({ value, label: easing.label })),
    default: 0,
  },
]

/** Params merged over the schema defaults. Reading the schema rather than
 *  repeating literals keeps a track that predates a param rendering at exactly
 *  what its panel shows (see the directory guide). */
function readSettings(params: Record<string, number>): CameraOrbitSettings {
  const read = (key: string) => params[key] ?? paramDefault(cameraOrbitInstrument, key)
  return {
    centerX: read('centerX'),
    centerY: read('centerY'),
    centerZ: read('centerZ'),
    orbitAxis: read('orbitAxis'),
    standoff: read('standoff'),
    radius: read('radius'),
    azimuth: read('azimuth'),
    swingSpeed: read('swingSpeed'),
    tiltSpeed: read('tiltSpeed'),
    returnBeats: read('returnBeats'),
    returnEase: read('returnEase'),
    fov: read('fov'),
  }
}

function CameraOrbitVisual({ trackId }: { trackId: string }) {
  const { camera } = useThree()
  const lookTarget = useRef(new Vector3())

  useInstrumentFrame(trackId, (state) => {
    const settings = readSettings(state.params)
    const { azimuth, elevation } = evaluateOrbitAngles(state.notes, settings, state.beat)
    const [x, y, z] = orbitCameraPosition(settings, azimuth, elevation)

    camera.position.set(x, y, z)
    // The rig carries its OWN up vector rather than borrowing world +Y, which is
    // what lets the vertical orbit lap forever: +Y collapses into the view
    // direction at the poles and `lookAt` snaps the frame around, while the
    // elevation tangent stays perpendicular at every height, so passing overhead
    // rolls smoothly through. lookAt then builds the rest of the basis from it.
    const [upX, upY, upZ] = orbitCameraUp(settings, azimuth, elevation)
    camera.up.set(upX, upY, upZ)
    lookTarget.current.set(settings.centerX, settings.centerY, settings.centerZ)
    camera.lookAt(lookTarget.current)

    if (camera instanceof PerspectiveCamera) {
      const fov = Math.max(1, Math.min(179, settings.fov))
      if (camera.fov !== fov) {
        camera.fov = fov
        camera.updateProjectionMatrix()
      }
    }
  })

  return null
}

export const cameraOrbitInstrument: ObjectInstrumentDef = {
  id: 'cameraOrbit',
  name: 'Camera Orbit',
  kind: 'object',
  identityColor: '#818cf8',
  userInterfaceRenderer: 'cameraOrbit',
  params: PARAMS,
  midiRows: CAMERA_ORBIT_ROWS,
  component: CameraOrbitVisual,
}
