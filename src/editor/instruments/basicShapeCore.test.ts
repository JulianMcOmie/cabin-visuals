import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import { MeshPhysicalMaterial } from 'three'
import { applyBasicShapeAppearance, BASIC_SHAPE_MATERIALS } from './basicShapeCore'
import { circleInstrument, triangleInstrument } from './shapes'

describe('basic shape compatibility', () => {
  it('keeps saved instrument IDs, the color control and the pulse vocabulary', () => {
    assert.deepEqual([circleInstrument.id, triangleInstrument.id], ['circle', 'triangle'])
    assert.deepEqual([circleInstrument.name, triangleInstrument.name], ['Circle', 'Triangle'])
    for (const def of [circleInstrument, triangleInstrument]) {
      assert.equal(def.kind, 'object')
      assert.equal(def.castsShadows, true)
      assert.equal(def.userInterfaceRenderer, 'parameters')
      assert.deepEqual(def.params, [{ key: 'baseColor', label: 'Base Color', type: 'color', default: '#5757db' }])
      assert.deepEqual(def.midiRows, [
        { pitch: 76, label: 'Pulse · max', emphasized: true },
        { pitch: 68, label: 'Pulse · strong' },
        { pitch: 60, label: 'Pulse · medium' },
        { pitch: 52, label: 'Pulse · soft' },
        { pitch: 44, label: 'Pulse · gentle' },
        { pitch: 36, label: 'Pulse · faint' },
      ])
    }
  })

  it('scales only from energy and leaves placement to the track transform', () => {
    for (const def of [circleInstrument, triangleInstrument]) {
      for (const [beat, energy, scale] of [[0, 0, 1], [80, 0.5, 1.175], [-4, 2, 1.7], [0, 0, 1]]) {
        const transform = def.localTransform!({ beat, energy, params: { scale: 99, size: 40, x: 10 } })
        assert.deepEqual(transform, {
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [scale, scale, scale],
        })
      }
    }
  })

  it('prefers an explicit color, then legacy hue, then the default color', () => {
    const material = new MeshPhysicalMaterial()
    applyBasicShapeAppearance(material, { params: { baseHue: 120 }, stringParams: { baseColor: '#123456' }, energy: 0 })
    assert.equal(material.color.getHexString(), '123456')

    for (const baseHue of [-240, 120, 480]) {
      applyBasicShapeAppearance(material, { params: { baseHue }, stringParams: { baseColor: '' }, energy: 0 })
      const rgb = material.color.toArray()
      for (const [i, value] of [0.34, 0.86, 0.34].entries()) assert.ok(Math.abs(rgb[i] - value) < 1e-12)
    }
    applyBasicShapeAppearance(material, { params: { baseHue: 0 }, stringParams: {}, energy: 0 })
    for (const [i, value] of [0.86, 0.34, 0.34].entries()) assert.ok(Math.abs(material.color.toArray()[i] - value) < 1e-12)

    applyBasicShapeAppearance(material, { params: {}, stringParams: {}, energy: 0 })
    assert.equal(material.color.getHexString(), '5757db')
  })

  it('pulses emission without changing engine-managed opacity', () => {
    const material = new MeshPhysicalMaterial({ opacity: 0.42, transparent: true })
    for (const [energy, expected] of [[0, 0.2], [0.5, 1.4], [2, 5], [0, 0.2]]) {
      applyBasicShapeAppearance(material, { params: {}, stringParams: {}, energy })
      assert.equal(material.emissiveIntensity, expected)
      assert.equal(material.opacity, 0.42)
      assert.equal(material.transparent, true)
    }
  })

  it('preserves the polished circle and matte triangle material settings', () => {
    assert.deepEqual(BASIC_SHAPE_MATERIALS, {
      circle: {
        metalness: 0.62, roughness: 0.13, clearcoat: 0.72, clearcoatRoughness: 0.08,
        iridescence: 0.72, iridescenceIOR: 1.45, envMapIntensity: 1.55, flatShading: false,
      },
      triangle: {
        metalness: 0.04, roughness: 0.58, clearcoat: 0.08, clearcoatRoughness: 0.5,
        iridescence: 0, iridescenceIOR: 1.3, envMapIntensity: 0.82, flatShading: true,
      },
    })
  })
})
