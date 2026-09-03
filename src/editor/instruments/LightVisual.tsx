import { useContext, useEffect, useRef } from 'react'
import { Color, Group, Mesh, MeshBasicMaterial } from 'three'
import { useInstrumentFrame } from '../core/visual/instrumentFrame'
import { InstrumentCopyContext } from '../core/visual/instrumentColor'
import { SceneIdContext } from '../core/visual/sceneContext'
import { getVisualCopy } from '../core/visual/VisualEngine'
import { defaultLightDesc, registerLightAnchor, LIGHT_TYPE_AMBIENT } from '../core/visual/sceneLights'
import { paramDefault, stringParamDefault } from './types'
import { lightInstrument } from './Light'

// The Light instrument's mounted half: an ANCHOR group (whose world transform
// the placement chain composes - that is the light's position) plus the
// optional bulb marker. The illumination itself is mirrored into every render
// pass from the registry - see core/visual/sceneLights.ts for why the anchor
// cannot simply hold a THREE light.

const num = (v: number | undefined, key: string) => v ?? paramDefault(lightInstrument, key)

export function LightVisual({ trackId }: { trackId: string }) {
  const copyContext = useContext(InstrumentCopyContext)
  const sceneId = useContext(SceneIdContext)
  const copyIndex = copyContext?.visualCopyIndex ?? 0
  const anchorRef = useRef<Group>(null)
  const bulbRef = useRef<Mesh>(null)
  const desc = useRef(defaultLightDesc()).current
  const bulbColor = useRef(new Color('#ffffff')).current

  useEffect(() => {
    const object = anchorRef.current
    // No scene id = a preview/panel mount: the bulb still shows, nothing to light.
    if (!object || !sceneId) return
    return registerLightAnchor({ sceneId, key: `${trackId}:${copyIndex}`, object, desc })
  }, [sceneId, trackId, copyIndex, desc])

  useInstrumentFrame(trackId, (state) => {
    const bulb = bulbRef.current
    if (!bulb) return false
    const p = state.params
    // Copy fades (visibility movers) dim the light exactly like track opacity.
    const copy = copyContext ? getVisualCopy(trackId, copyContext.visualCopyIndex) : undefined
    const fade = state.opacity * (copy?.opacity ?? 1)
    const flash = num(p.flash, 'flash')

    desc.type = Math.round(num(p.type, 'type'))
    desc.color = state.stringParams.color ?? stringParamDefault(lightInstrument, 'color')
    desc.groundColor = state.stringParams.groundColor ?? stringParamDefault(lightInstrument, 'groundColor')
    desc.on = !state.blackedOut && fade > 0.001
    desc.intensity = num(p.intensity, 'intensity') * fade * (1 + flash * state.energy)
    desc.flat = num(p.flat, 'flat') * fade
    desc.distance = num(p.distance, 'distance')
    desc.decay = num(p.decay, 'decay')
    desc.angleDeg = num(p.angle, 'angle')
    desc.penumbra = num(p.penumbra, 'penumbra')
    desc.width = num(p.width, 'width')
    desc.height = num(p.height, 'height')
    desc.castShadow = num(p.castShadow, 'castShadow') >= 0.5
    desc.aimX = num(p.aimX, 'aimX')
    desc.aimY = num(p.aimY, 'aimY')
    desc.aimZ = num(p.aimZ, 'aimZ')

    // The bulb: a small glowing marker at the light's position. Ambient has no
    // position worth marking. The note flash brightens it toward white so a
    // played light visibly blinks even on unlit scenery.
    bulb.visible = num(p.bulb, 'bulb') >= 0.5 && desc.type !== LIGHT_TYPE_AMBIENT
    if (bulb.visible) {
      const material = bulb.material as MeshBasicMaterial
      bulbColor.set(desc.color)
      material.color.copy(bulbColor).lerp(WHITE, Math.min(1, flash * state.energy * 0.6))
    }
  })

  return (
    <group ref={anchorRef}>
      <mesh ref={bulbRef}>
        <sphereGeometry args={[0.16, 20, 14]} />
        <meshBasicMaterial color="#ffffff" />
      </mesh>
    </group>
  )
}

const WHITE = new Color('#ffffff')
