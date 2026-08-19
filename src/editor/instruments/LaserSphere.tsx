import { paramDefault, type ObjectInstrumentDef } from './types'
import { lazyInstrument } from './lazyInstrument'
import { DEFAULT_WHITE_CORE } from './laserSphereCore'

// The visual itself lives in ./LaserSphereVisual (lazy: fetched when a project
// mounts a laser sphere); this file is the def plus the shaders the settings
// panel's preview shares.

export const DEFAULT_LASER_SPHERE_COLOR = '#25dfff'
const DEFAULT_COLOR = DEFAULT_LASER_SPHERE_COLOR

export const LASER_VERTEX_SHADER = `
varying float vFacing;

void main() {
  vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
  vec3 viewNormal = normalize(normalMatrix * normal);
  vec3 viewDirection = normalize(-viewPosition.xyz);
  vFacing = clamp(dot(viewNormal, viewDirection), 0.0, 1.0);
  gl_Position = projectionMatrix * viewPosition;
}`

export const LASER_FRAGMENT_SHADER = `
uniform vec3 coreColor;
uniform vec3 rimColor;
// A raw ShaderMaterial ignores Material.opacity, so the value the opacity
// wrapper writes each frame (visibility movers, fades) is fed back in here.
uniform float uOpacity;
varying float vFacing;

void main() {
  // The center can stay below bloom threshold while the grazing-angle rim
  // remains HDR. The real mip-chain bloom turns that rim energy into the halo.
  float rim = pow(clamp(1.0 - vFacing, 0.0, 1.0), 1.7);
  float bloomCarrier = smoothstep(0.04, 0.88, rim);
  gl_FragColor = vec4(mix(coreColor, rimColor, bloomCarrier), uOpacity);
}`

export const laserSphereInstrument: ObjectInstrumentDef = {
  id: 'laserSphere',
  name: 'Laser Sphere',
  kind: 'object',
  userInterfaceRenderer: 'laserSphere',
  params: [
    { key: 'size', label: 'Size', min: 0.0001, max: 4, step: 0.05, curve: 2, default: 1.6 },
    { key: 'color', label: 'Laser Color', type: 'color', default: DEFAULT_COLOR },
    { key: 'glow', label: 'Glow', min: 1.5, max: 12, step: 0.1, default: 5.5 },
    { key: 'whiteCore', label: 'White-hot core', min: 0, max: 1, step: 0.01, default: DEFAULT_WHITE_CORE },
    { key: 'light', label: 'Scene Light', min: 0, max: 50, step: 1, default: 14 },
  ],
  midiRows: [
    { pitch: 76, label: 'Flare · max', emphasized: true },
    { pitch: 68, label: 'Flare · strong' },
    { pitch: 60, label: 'Flare · medium' },
    { pitch: 52, label: 'Flare · soft' },
    { pitch: 44, label: 'Flare · gentle' },
    { pitch: 36, label: 'Flare · faint' },
  ],
  // Placement comes from parent tracks / movers; the sphere itself only sizes.
  localTransform: ({ params, energy }) => ({
    scale: (params.size ?? paramDefault(laserSphereInstrument, 'size')) / 1.6 * (1 + energy * 0.22),
  }),
  component: lazyInstrument(() => import('./LaserSphereVisual').then((m) => m.LaserSphere)),
}
