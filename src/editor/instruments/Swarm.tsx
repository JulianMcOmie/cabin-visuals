import { useMemo, useRef } from 'react'
import { useGLTF } from '@react-three/drei'
import {
  Box3,
  BufferGeometry,
  DoubleSide,
  InstancedBufferAttribute,
  InstancedMesh,
  Material,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
} from 'three'
import { useInstrumentFrame } from '../core/visual/instrumentFrame'
import { resetSV } from '../core/visual/stateVector'
import { paramDefault, type ObjectInstrumentDef } from './types'

const MAX_SWARM_COUNT = 512
const TAU = Math.PI * 2
const HELMET_MODEL_URL = '/models/daft_punk_helmet_guy-manuel.glb'
const HELMET_FIT_SIZE = 1.9
const _helmetBaseRotation = new Matrix4().makeRotationY(Math.PI)
const _forward = new Vector3(0, 0, 1)
const _outward = new Vector3()
const _faceQuat = new Quaternion()

interface HelmetPart {
  geometry: BufferGeometry
  material: Material | Material[]
}

function axisAngleVectorFromQuat(q: Quaternion, out: [number, number, number]): void {
  if (q.w > 1) q.normalize()
  const angle = 2 * Math.acos(q.w)
  const s = Math.sqrt(1 - q.w * q.w)
  if (s < 0.00001 || angle < 0.00001) {
    out[0] = 0
    out[1] = 0
    out[2] = 0
    return
  }
  out[0] = (q.x / s) * angle
  out[1] = (q.y / s) * angle
  out[2] = (q.z / s) * angle
}

function cloneMaterial(material: Material | Material[]): Material | Material[] {
  if (Array.isArray(material)) return material.map(cloneMaterial) as Material[]
  const cloned = material.clone()
  cloned.side = DoubleSide
  installInstanceOpacity(cloned)
  return cloned
}

function installInstanceOpacity(material: Material) {
  if (material.userData.cabinInstanceOpacity) return
  const previous = material.onBeforeCompile
  material.transparent = true
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float instanceOpacity;\nvarying float vInstanceOpacity;')
      .replace('#include <begin_vertex>', 'vInstanceOpacity = instanceOpacity;\n#include <begin_vertex>')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vInstanceOpacity;')
      .replace('#include <dithering_fragment>', 'gl_FragColor.a *= vInstanceOpacity;\n#include <dithering_fragment>')
  }
  material.customProgramCacheKey = () => 'cabin-swarm-instance-opacity'
  material.userData.cabinInstanceOpacity = true
}

function setHelmetMaterialEnergy(material: Material | Material[], energy: number) {
  const materials = Array.isArray(material) ? material : [material]
  for (const mat of materials) {
    if (!(mat instanceof MeshStandardMaterial)) continue
    const isVisor = mat.name.toLowerCase().includes('visor') || mat.color.getHex() === 0x000000
    mat.emissive.copy(mat.color)
    mat.emissiveIntensity = isVisor ? 0 : 0.04 + energy * 0.35
  }
}

function updateInstanceOpacity(mesh: InstancedMesh, count: number, opacities: readonly number[], fallback: number) {
  let attr = mesh.geometry.getAttribute('instanceOpacity') as InstancedBufferAttribute | undefined
  if (!attr || attr.count < MAX_SWARM_COUNT) {
    attr = new InstancedBufferAttribute(new Float32Array(MAX_SWARM_COUNT).fill(1), 1)
    mesh.geometry.setAttribute('instanceOpacity', attr)
  }
  const values = attr.array as Float32Array
  for (let i = 0; i < count; i++) {
    values[i] = Math.max(0, Math.min(1, opacities[i] ?? fallback))
  }
  attr.needsUpdate = true
}

function buildHelmetParts(scene: Mesh): HelmetPart[]
function buildHelmetParts(scene: { updateWorldMatrix: (updateParents: boolean, updateChildren: boolean) => void; traverse: (cb: (obj: unknown) => void) => void }): HelmetPart[]
function buildHelmetParts(scene: { updateWorldMatrix: (updateParents: boolean, updateChildren: boolean) => void; traverse: (cb: (obj: unknown) => void) => void }): HelmetPart[] {
  scene.updateWorldMatrix(true, true)

  const box = new Box3()
  const meshes: Mesh[] = []
  scene.traverse((obj) => {
    if (obj instanceof Mesh && obj.geometry) {
      meshes.push(obj)
      box.expandByObject(obj)
    }
  })

  if (meshes.length === 0 || box.isEmpty()) return []

  const center = box.getCenter(new Vector3())
  const size = box.getSize(new Vector3())
  const fitScale = HELMET_FIT_SIZE / Math.max(size.x, size.y, size.z, 0.000001)
  const normalize = new Matrix4()
    .makeScale(fitScale, fitScale, fitScale)
    .multiply(new Matrix4().makeTranslation(-center.x, -center.y, -center.z))

  return meshes.map((mesh) => {
    const geometry = mesh.geometry.clone()
    geometry.applyMatrix4(_helmetBaseRotation.clone().multiply(normalize).multiply(mesh.matrixWorld))
    geometry.computeBoundingBox()
    geometry.computeBoundingSphere()
    return {
      geometry,
      material: cloneMaterial(mesh.material),
    }
  })
}

export const swarmInstrument: ObjectInstrumentDef = {
  id: 'swarm',
  name: 'Swarm',
  kind: 'object',
  params: [
    { key: 'count', label: 'Count', min: 1, max: MAX_SWARM_COUNT, step: 1, default: 24 },
    { key: 'layout', label: 'Layout', type: 'select', default: 0, options: [
      { value: 0, label: 'Ring' },
      { value: 1, label: 'Line' },
      { value: 2, label: 'Grid' },
    ] },
    { key: 'radius', label: 'Radius', min: 0.2, max: 8, step: 0.05, default: 2.4 },
    { key: 'spacing', label: 'Spacing', min: 0.1, max: 2, step: 0.05, default: 0.45 },
    { key: 'size', label: 'Size', min: 0.03, max: 0.8, step: 0.01, default: 0.18 },
    { key: 'baseHue', label: 'Base Color', min: 0, max: 360, step: 1, default: 190 },
  ],
  elementCount: (params) => Math.max(1, Math.min(MAX_SWARM_COUNT, Math.round(params.count ?? 24))),
  layoutState: ({ params, i, N, channels }, out) => {
    resetSV(out)
    const layout = params.layout ?? paramDefault(swarmInstrument, 'layout')
    const radius = params.radius ?? paramDefault(swarmInstrument, 'radius')
    const spacing = params.spacing ?? paramDefault(swarmInstrument, 'spacing')
    const size = params.size ?? paramDefault(swarmInstrument, 'size')
    out.logScale = Math.log(Math.max(0.000001, size))

    if (layout === 1) {
      const center = (N - 1) / 2
      out.pos[0] = (i - center) * spacing
      channels.line_frac = N <= 1 ? 0 : i / (N - 1)
      return
    }

    if (layout === 2) {
      const cols = Math.ceil(Math.sqrt(N))
      const rows = Math.ceil(N / cols)
      const col = i % cols
      const row = Math.floor(i / cols)
      out.pos[0] = (col - (cols - 1) / 2) * spacing
      out.pos[1] = ((rows - 1) / 2 - row) * spacing
      channels.grid_col = col
      channels.grid_row = row
      return
    }

    const theta = TAU * i / Math.max(1, N)
    const cos = Math.cos(theta)
    const sin = Math.sin(theta)
    out.pos[0] = cos * radius
    out.pos[1] = sin * radius
    _outward.set(cos, sin, 0)
    _faceQuat.setFromUnitVectors(_forward, _outward)
    axisAngleVectorFromQuat(_faceQuat, out.rot)
    channels.layoutAngle = theta
    channels.fold_angle = theta
  },
  component: Swarm,
}

export function Swarm({ trackId }: { trackId: string }) {
  const meshRefs = useRef<(InstancedMesh | null)[]>([])
  const gltf = useGLTF(HELMET_MODEL_URL)
  const helmetParts = useMemo(() => buildHelmetParts(gltf.scene), [gltf.scene])

  useInstrumentFrame(trackId, (state) => {
    const count = Math.min(state.elementCount, MAX_SWARM_COUNT, state.elementMatrices.length)
    const energy = state.energy

    for (const mesh of meshRefs.current) {
      if (!mesh) continue
      mesh.count = count
      for (let i = 0; i < count; i++) mesh.setMatrixAt(i, state.elementMatrices[i])
      mesh.instanceMatrix.needsUpdate = true
      updateInstanceOpacity(mesh, count, state.elementOpacities, state.opacity)
      setHelmetMaterialEnergy(mesh.material, energy)
    }
  })

  return (
    <group>
      {helmetParts.map((part, i) => (
        <instancedMesh
          key={i}
          ref={(mesh) => { meshRefs.current[i] = mesh }}
          args={[part.geometry, part.material, MAX_SWARM_COUNT]}
          frustumCulled={false}
        />
      ))}
    </group>
  )
}

useGLTF.preload(HELMET_MODEL_URL)
