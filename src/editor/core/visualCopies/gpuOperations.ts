import { Matrix4, Vector3 } from 'three'
import { pivotedRotation } from './motionBasis'
import { isGpuAppearanceSupported } from './gpuAppearance'
import type { CopyTargetSelection } from './copyTargets'

/** A pure, count-one operation on the incoming copy's frame and appearance.
 * The host samples shared notes/automation once; workers and shaders receive
 * only data. Spatial, color and selection operations share this contract.
 * Bounds describe the frame's linear scale and its position separately:
 * |positionOut| <= positionScaleBound * |positionIn| + translationBound. */
export interface GpuOperation {
  kind: number
  parameters: readonly number[]
  scaleBound: number
  translationBound: number
  positionScaleBound?: number
  determinantPreserving?: boolean
  /** Constant affine operators can certify determinant/whole-frame growth
   * directly; no population-sized singularity probe is needed after a gate. */
  determinantScale?: number
  frameScaleBound?: number
  /** Conjunctive predicates over this stage's INPUT ordinal/population. These
   * are program data, so adding copy targeting never expands a GPU operation. */
  indexGuards?: readonly CopyTargetSelection[]
  /** A mover frame can relocate a world-sampled appearance field without
   * changing the particle's geometry or losing compact execution. */
  appearancePlacement?: readonly number[]
}

export const GPU_OPERATION_IDENTITY = 0
export const GPU_OPERATION_MIRROR_DISPLACEMENT = 1
export const GPU_OPERATION_RADIAL_DISPLACEMENT = 2
export const GPU_OPERATION_AXIAL_ROTATION = 3
export const GPU_OPERATION_FLUID_IMPACT = 4
export const GPU_OPERATION_APPEARANCE = 5
export const GPU_OPERATION_LOCAL_AFFINE = 6
export const GPU_OPERATION_ROOT_AFFINE = 7

type Triple = readonly [number, number, number]
const POSITION_EPS = 1e-6
const ANGLE_EPS = 1e-10

export function gpuOperationParameterCount(kind: number, parameters?: ArrayLike<number>): number | undefined {
  switch (kind) {
    case GPU_OPERATION_IDENTITY: return 0
    case GPU_OPERATION_MIRROR_DISPLACEMENT: return 3
    case GPU_OPERATION_RADIAL_DISPLACEMENT: return 6
    case GPU_OPERATION_AXIAL_ROTATION: return 13
    case GPU_OPERATION_FLUID_IMPACT: return 14
    case GPU_OPERATION_APPEARANCE: return parameters?.[1]
    case GPU_OPERATION_LOCAL_AFFINE:
    case GPU_OPERATION_ROOT_AFFINE: return 16
    default: return undefined
  }
}

export function isGpuOperationSupported(operation: GpuOperation): boolean {
  const p = operation.parameters
  const unitAxis = operation.kind === GPU_OPERATION_IDENTITY || operation.kind === GPU_OPERATION_APPEARANCE
    || operation.kind === GPU_OPERATION_LOCAL_AFFINE || operation.kind === GPU_OPERATION_ROOT_AFFINE
    || operation.kind === GPU_OPERATION_MIRROR_DISPLACEMENT
    || Math.abs(Math.hypot(p[0], p[1], p[2]) - 1) <= 1e-12
  return p.length === gpuOperationParameterCount(operation.kind, p)
    && (operation.kind === GPU_OPERATION_APPEARANCE || operation.parameters.every(Number.isFinite))
    && unitAxis
    && (operation.kind !== GPU_OPERATION_RADIAL_DISPLACEMENT || p[3] === 0 || p[3] === 1)
    && (operation.kind !== GPU_OPERATION_AXIAL_ROTATION
      || (p[10] >= .0001 && p[11] >= .01 && (p[12] === 0 || p[12] === 1)))
    && (operation.kind !== GPU_OPERATION_FLUID_IMPACT || (p[6] > 0 && p[10] > 0))
    && (operation.kind !== GPU_OPERATION_APPEARANCE || isGpuAppearanceSupported(operation))
    && (![GPU_OPERATION_LOCAL_AFFINE, GPU_OPERATION_ROOT_AFFINE].includes(operation.kind)
      || (p[3] === 0 && p[7] === 0 && p[11] === 0 && p[15] === 1))
    && (!operation.indexGuards || operation.indexGuards.every(guard =>
      (guard.rule === 'every' || guard.rule === 'runs') && Number.isFinite(guard.slices)
      && guard.on.every(value => Number.isInteger(value) && value >= 0 && value < 12)))
    && (!operation.appearancePlacement || operation.appearancePlacement.length === 16
      && operation.appearancePlacement.every(Number.isFinite))
    && Number.isFinite(operation.scaleBound) && operation.scaleBound >= 0
    && Number.isFinite(operation.translationBound) && operation.translationBound >= 0
    && (operation.positionScaleBound === undefined
      || (Number.isFinite(operation.positionScaleBound) && operation.positionScaleBound >= 0))
    && (operation.frameScaleBound === undefined || Number.isFinite(operation.frameScaleBound) && operation.frameScaleBound >= 0)
    && (operation.determinantScale === undefined || Number.isFinite(operation.determinantScale) && operation.determinantScale >= 0)
}

export function identityGpuOperation(): GpuOperation {
  return { kind: GPU_OPERATION_IDENTITY, parameters: [], scaleBound: 1,
    positionScaleBound: 1, translationBound: 0, determinantPreserving: true }
}

/** Turn a uniform transform into the same operation vocabulary as spatial and
 * appearance fields. Copy targeting can then condition it without a CPU loop. */
export function affineGpuOperation(matrix: Matrix4, composition: 'local' | 'chainRoot'): GpuOperation {
  const e = matrix.elements
  const a = new Vector3(e[0], e[1], e[2]), b = new Vector3(e[4], e[5], e[6]), c = new Vector3(e[8], e[9], e[10])
  const ab = Math.abs(a.dot(b)), ac = Math.abs(a.dot(c)), bc = Math.abs(b.dot(c))
  const scaleBound = Math.sqrt(Math.max(a.lengthSq() + ab + ac, b.lengthSq() + ab + bc, c.lengthSq() + ac + bc)) * (1 + 8 * Number.EPSILON)
  let frameScaleBound = 0
  for (let row = 0; row < 4; row++) frameScaleBound = Math.max(frameScaleBound,
    Math.abs(e[row]) + Math.abs(e[row + 4]) + Math.abs(e[row + 8]) + Math.abs(e[row + 12]))
  return { kind: composition === 'local' ? GPU_OPERATION_LOCAL_AFFINE : GPU_OPERATION_ROOT_AFFINE,
    parameters: e.slice(), scaleBound, positionScaleBound: scaleBound,
    translationBound: Math.hypot(e[12], e[13], e[14]), frameScaleBound,
    determinantScale: Math.abs(matrix.determinant()) }
}

/** Axis-aligned displacement, clamping inward motion at each mirror plane. */
export function mirrorDisplacementOperation(travel: Triple): GpuOperation {
  return { kind: GPU_OPERATION_MIRROR_DISPLACEMENT, parameters: [...travel],
    scaleBound: 1, translationBound: Math.hypot(...travel), determinantPreserving: true }
}

/** Radial displacement followed by a rotation around the same origin. `normal`
 * is a unit vector; spherical displacement ignores it but the turn uses it. */
export function radialDisplacementOperation(normal: Triple, spherical: boolean, travel: number, turn: number): GpuOperation {
  return { kind: GPU_OPERATION_RADIAL_DISPLACEMENT,
    parameters: [...normal, spherical ? 1 : 0, travel, turn],
    scaleBound: 1, translationBound: Math.abs(travel), determinantPreserving: true }
}

export interface AxialRotationParameters {
  axis: Triple
  center: Triple
  angles: Triple
  /** 0 uniform, 1 signed along-axis, 2 radial distance, 3 inward radial ramp. */
  falloff: number
  span: number
  curve: number
  onAxis: boolean
}

export function axialRotationOperation(parameters: AxialRotationParameters): GpuOperation {
  const { axis, center, angles, falloff, onAxis } = parameters
  // Twisting and folding are rigid rotations of each copy, so linear scale
  // stays fixed. Folding about the projected axis foot can align the original
  // axial and radial position components: their sum is bounded by sqrt(2)
  // times the original radius. Self anchoring leaves position unchanged.
  const positionScaleBound = onAxis ? Math.SQRT2 : 1
  return { kind: GPU_OPERATION_AXIAL_ROTATION,
    parameters: [...axis, ...center, ...angles, falloff,
      Math.max(.0001, parameters.span), Math.max(.01, parameters.curve), onAxis ? 1 : 0],
    scaleBound: 1, positionScaleBound,
    translationBound: onAxis ? (1 + positionScaleBound) * Math.hypot(...center) : 0,
    determinantPreserving: true }
}

export function axialRotationWeight(along: number, radius: number, falloff: number, span: number, curve: number): number {
  const raw = falloff === 1 ? along / span : falloff === 2 ? radius / span
    : falloff === 3 ? Math.max(0, 1 - radius / span) : 1
  return curve === 1 || raw === 0 ? raw : Math.sign(raw) * Math.pow(Math.abs(raw), curve)
}

export interface FluidImpactOperationParameters {
  axis: Triple
  center: Triple
  radius: number
  radialTravel: number
  swirlTravel: number
  scatterTravel: number
  frequency: number
  phase: Triple
}

/** A smooth pressure kick, coherent vortex and curling eddies. The analytic
 * eddy field is the curl of a trigonometric vector potential; its normalized
 * magnitude is at most one. Localizing the field and adding radial pressure
 * gives a fluid-like impact without integration or per-particle history.
 * Every term translates the frame, preserving object shape and orientation. */
export function fluidImpactOperation(p: FluidImpactOperationParameters): GpuOperation {
  return { kind: GPU_OPERATION_FLUID_IMPACT,
    parameters: [...p.axis, ...p.center, p.radius, p.radialTravel, p.swirlTravel, p.scatterTravel, p.frequency, ...p.phase],
    scaleBound: 1, positionScaleBound: 1,
    translationBound: Math.abs(p.radialTravel) + Math.abs(p.swirlTravel) + Math.abs(p.scatterTravel),
    determinantPreserving: true }
}

/** CPU counterpart of applyParticleOperation. Reading all incoming state before
 * writing permits out === incoming. Full matrix multiplication retains shear,
 * mirrors and the reference path's behavior at zero and near-zero scales. */
export function applyGpuOperation(operation: GpuOperation, incoming: Matrix4, out: Matrix4): Matrix4 {
  if (operation.kind === GPU_OPERATION_IDENTITY || operation.kind === GPU_OPERATION_APPEARANCE) return out.copy(incoming)
  if (operation.kind === GPU_OPERATION_LOCAL_AFFINE || operation.kind === GPU_OPERATION_ROOT_AFFINE) {
    const delta = new Matrix4().fromArray(operation.parameters)
    return operation.kind === GPU_OPERATION_LOCAL_AFFINE ? out.multiplyMatrices(incoming, delta) : out.multiplyMatrices(delta, incoming)
  }
  const p = operation.parameters
  const e = incoming.elements
  const position = new Vector3(e[12], e[13], e[14])
  let delta: Matrix4 | null = null
  if (operation.kind === GPU_OPERATION_MIRROR_DISPLACEMENT) {
    const offset = new Vector3()
    for (let axis = 0; axis < 3; axis++) {
      const component = position.getComponent(axis)
      if (Math.abs(component) <= POSITION_EPS || p[axis] === 0) continue
      offset.setComponent(axis, Math.sign(component) * Math.max(p[axis], -Math.abs(component)))
    }
    if (offset.lengthSq() > 0) delta = new Matrix4().makeTranslation(offset.x, offset.y, offset.z)
  } else if (operation.kind === GPU_OPERATION_RADIAL_DISPLACEMENT) {
    const normal = new Vector3(p[0], p[1], p[2])
    const outward = p[3] === 1 ? position.clone()
      : position.clone().addScaledVector(normal, -position.dot(normal))
    const reach = outward.length()
    if (reach > POSITION_EPS && p[4] !== 0) {
      const offset = outward.multiplyScalar(Math.max(p[4], -reach) / reach)
      delta = new Matrix4().makeTranslation(offset.x, offset.y, offset.z)
    }
    if (p[5] !== 0) {
      const turn = new Matrix4().makeRotationAxis(normal, p[5])
      delta = delta ? turn.multiply(delta) : turn
    }
  } else if (operation.kind === GPU_OPERATION_AXIAL_ROTATION) {
    const axis = new Vector3(p[0], p[1], p[2])
    const center = new Vector3(p[3], p[4], p[5])
    const offset = position.clone().sub(center)
    const along = offset.dot(axis)
    const radial = offset.clone().addScaledVector(axis, -along)
    const radius = radial.length()
    const weight = axialRotationWeight(along, radius, p[9], p[10], p[11])
    const self: [number, number, number] = [position.x, position.y, position.z]
    const foot = center.clone().addScaledVector(axis, along)
    const pivot: [number, number, number] = p[12] === 1 ? [foot.x, foot.y, foot.z] : self
    const steps: Matrix4[] = []
    const twist = p[6] * weight
    if (Math.abs(twist) > ANGLE_EPS) steps.push(pivotedRotation(new Matrix4().makeRotationAxis(axis, twist), pivot))
    if (radius > POSITION_EPS) {
      const outward = radial.clone().divideScalar(radius)
      const fold = p[7] * weight
      if (Math.abs(fold) > ANGLE_EPS) {
        const tangent = outward.clone().cross(axis).normalize()
        steps.push(pivotedRotation(new Matrix4().makeRotationAxis(tangent, fold), pivot))
      }
      const roll = p[8] * weight
      if (Math.abs(roll) > ANGLE_EPS) steps.push(pivotedRotation(new Matrix4().makeRotationAxis(outward, roll), self))
    }
    delta = steps.length ? steps.reduce((accumulated, step) => accumulated.multiply(step)) : null
  } else if (operation.kind === GPU_OPERATION_FLUID_IMPACT) {
    if (p[7] === 0 && p[8] === 0 && p[9] === 0) return out.copy(incoming)
    const x = position.x - p[3], y = position.y - p[4], z = position.z - p[5]
    const radius2 = p[6] * p[6], distance2 = x * x + y * y + z * z
    if (distance2 >= radius2) return out.copy(incoming)
    const tail = 1 - distance2 / radius2, falloff = tail * tail
    const inverse = 1 / Math.sqrt(distance2 + radius2 * .01)
    const nx = x * inverse, ny = y * inverse, nz = z * inverse
    let dx = p[7] * nx + p[8] * (p[1] * nz - p[2] * ny)
    let dy = p[7] * ny + p[8] * (p[2] * nx - p[0] * nz)
    let dz = p[7] * nz + p[8] * (p[0] * ny - p[1] * nx)
    if (p[9] !== 0) {
      const qx = x * p[10] + p[11], qy = y * p[10] + p[12], qz = z * p[10] + p[13]
      const sx = Math.sin(qx), sy = Math.sin(qy), sz = Math.sin(qz)
      const cx = Math.cos(qx), cy = Math.cos(qy), cz = Math.cos(qz)
      const amount = p[9] / (2 * Math.sqrt(3))
      dx += amount * sx * (cy - cz)
      dy += amount * sy * (cz - cx)
      dz += amount * sz * (cx - cy)
    }
    delta = new Matrix4().makeTranslation(dx * falloff, dy * falloff, dz * falloff)
  } else {
    throw new Error(`Unsupported copy GPU operation ${operation.kind}`)
  }
  return delta ? out.multiplyMatrices(delta, incoming) : out.copy(incoming)
}

/** Trusted shader implementation for the same scalar operation records. The
 * embedding renderer supplies layoutScalar(int); offsets are scalar addresses,
 * not matrix/texel addresses. No instrument-specific state enters this code. */
export const GPU_OPERATIONS_GLSL = `
  mat4 particleOpTranslation(vec3 offset) {
    mat4 result = mat4(1.0);
    result[3].xyz = offset;
    return result;
  }
  mat4 particleOpRotation(vec3 axis, float angle) {
    float c = cos(angle), s = sin(angle), t = 1.0 - c;
    float x = axis.x, y = axis.y, z = axis.z;
    return mat4(
      t*x*x+c, t*x*y+s*z, t*x*z-s*y, 0.0,
      t*x*y-s*z, t*y*y+c, t*y*z+s*x, 0.0,
      t*x*z+s*y, t*y*z-s*x, t*z*z+c, 0.0,
      0.0, 0.0, 0.0, 1.0);
  }
  mat4 particleOpPivot(vec3 axis, float angle, vec3 pivot) {
    return particleOpTranslation(pivot) * particleOpRotation(axis, angle) * particleOpTranslation(-pivot);
  }
  vec3 particleOpTriple(int offset) {
    return vec3(layoutScalar(offset), layoutScalar(offset + 1), layoutScalar(offset + 2));
  }
  mat4 applyParticleOperation(mat4 frame, int kind, int scalarOffset) {
    if (kind == ${GPU_OPERATION_LOCAL_AFFINE} || kind == ${GPU_OPERATION_ROOT_AFFINE}) {
      mat4 delta;
      for (int column = 0; column < 4; column++) {
        int p = scalarOffset + column * 4;
        delta[column] = vec4(layoutScalar(p), layoutScalar(p + 1), layoutScalar(p + 2), layoutScalar(p + 3));
      }
      return kind == ${GPU_OPERATION_LOCAL_AFFINE} ? frame * delta : delta * frame;
    }
    vec3 position = frame[3].xyz;
    if (kind == ${GPU_OPERATION_MIRROR_DISPLACEMENT}) {
      vec3 travel = particleOpTriple(scalarOffset), offset = vec3(0.0);
      for (int axis = 0; axis < 3; axis++) {
        if (abs(position[axis]) > 1e-6 && travel[axis] != 0.0)
          offset[axis] = sign(position[axis]) * max(travel[axis], -abs(position[axis]));
      }
      return dot(offset, offset) > 0.0 ? particleOpTranslation(offset) * frame : frame;
    }
    if (kind == ${GPU_OPERATION_RADIAL_DISPLACEMENT}) {
      vec3 normal = particleOpTriple(scalarOffset);
      vec3 outward = layoutScalar(scalarOffset + 3) == 1.0 ? position : position - normal * dot(position, normal);
      float reach = length(outward), travel = layoutScalar(scalarOffset + 4), turn = layoutScalar(scalarOffset + 5);
      mat4 delta = mat4(1.0);
      bool hasDelta = false;
      if (reach > 1e-6 && travel != 0.0) {
        delta = particleOpTranslation(outward * (max(travel, -reach) / reach));
        hasDelta = true;
      }
      if (turn != 0.0) {
        mat4 rotation = particleOpRotation(normal, turn);
        delta = hasDelta ? rotation * delta : rotation;
        hasDelta = true;
      }
      return hasDelta ? delta * frame : frame;
    }
    if (kind == ${GPU_OPERATION_AXIAL_ROTATION}) {
      vec3 axis = particleOpTriple(scalarOffset), center = particleOpTriple(scalarOffset + 3);
      vec3 channels = particleOpTriple(scalarOffset + 6), offset = position - center;
      float along = dot(offset, axis);
      vec3 radial = offset - axis * along;
      float radius = length(radial), falloff = layoutScalar(scalarOffset + 9);
      float span = layoutScalar(scalarOffset + 10), curve = layoutScalar(scalarOffset + 11);
      float raw = falloff == 1.0 ? along / span : falloff == 2.0 ? radius / span
        : falloff == 3.0 ? max(0.0, 1.0 - radius / span) : 1.0;
      float weight = curve == 1.0 || raw == 0.0 ? raw : sign(raw) * pow(abs(raw), curve);
      vec3 pivot = layoutScalar(scalarOffset + 12) == 1.0 ? center + axis * along : position;
      mat4 delta = mat4(1.0);
      bool hasDelta = false;
      float twist = channels.x * weight;
      if (abs(twist) > 1e-10) {
        delta = particleOpPivot(axis, twist, pivot);
        hasDelta = true;
      }
      if (radius > 1e-6) {
        vec3 outward = radial / radius;
        float fold = channels.y * weight;
        if (abs(fold) > 1e-10) {
          mat4 step = particleOpPivot(normalize(cross(outward, axis)), fold, pivot);
          delta = hasDelta ? delta * step : step;
          hasDelta = true;
        }
        float roll = channels.z * weight;
        if (abs(roll) > 1e-10) {
          mat4 step = particleOpPivot(outward, roll, position);
          delta = hasDelta ? delta * step : step;
          hasDelta = true;
        }
      }
      return hasDelta ? delta * frame : frame;
    }
    if (kind == ${GPU_OPERATION_FLUID_IMPACT}) {
      vec3 travel = particleOpTriple(scalarOffset + 7);
      if (all(equal(travel, vec3(0.0)))) return frame;
      vec3 relative = position - particleOpTriple(scalarOffset + 3);
      float radius = layoutScalar(scalarOffset + 6), radius2 = radius * radius;
      float distance2 = dot(relative, relative);
      if (distance2 >= radius2) return frame;
      float tail = 1.0 - distance2 / radius2, falloff = tail * tail;
      vec3 outward = relative / sqrt(distance2 + radius2 * 0.01);
      vec3 offset = travel.x * outward + travel.y * cross(particleOpTriple(scalarOffset), outward);
      if (travel.z != 0.0) {
        vec3 q = relative * layoutScalar(scalarOffset + 10) + particleOpTriple(scalarOffset + 11);
        vec3 s = sin(q), c = cos(q);
        vec3 eddy = vec3(s.x * (c.y - c.z), s.y * (c.z - c.x), s.z * (c.x - c.y));
        offset += travel.z * 0.2886751345948129 * eddy;
      }
      return particleOpTranslation(offset * falloff) * frame;
    }
    return frame;
  }
`
