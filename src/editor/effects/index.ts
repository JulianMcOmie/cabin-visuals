// Registry: collects every visual effect plugin. Adding an effect = one new file +
// one entry here. The renderer resolves a track's EffectInstance to its def via getEffect.

import { offsetPlugin } from './transforms/offset'
import { rotatePlugin } from './transforms/rotate'
import { scalePlugin } from './transforms/scale'
import { kaleidoscopePlugin } from './shaders/kaleidoscope'
import { kaleidoSkinPlugin } from './materials/kaleidoSkin'
import { glowPlugin } from './shaders/glow'
import { texturizerPlugin } from './materials/texturizer'
import { boilPlugin } from './shaders/boil'
import { pixelatePlugin } from './shaders/pixelate'
import { chromaticAberrationPlugin } from './shaders/chromaticAberration'
import { opacityPlugin } from './shaders/opacity'
import { deformPlugin } from './deform/deform'
import { gradeScenePlugin } from './scene/grade'
import { lensScenePlugin } from './scene/lens'
import { blurScenePlugin } from './scene/blur'
import { grainScenePlugin } from './scene/grain'
import { crushScenePlugin } from './scene/crush'
import { glitchScenePlugin } from './scene/glitch'
import { mirrorScenePlugin } from './scene/mirror'
import type { VisualEffect } from './types'

export type { VisualEffect, EffectCategory } from './types'

export const EFFECTS: Record<string, VisualEffect> = {
  [offsetPlugin.id]: offsetPlugin,
  [rotatePlugin.id]: rotatePlugin,
  [scalePlugin.id]: scalePlugin,
  [kaleidoscopePlugin.id]: kaleidoscopePlugin,
  [kaleidoSkinPlugin.id]: kaleidoSkinPlugin,
  [boilPlugin.id]: boilPlugin,
  [pixelatePlugin.id]: pixelatePlugin,
  [chromaticAberrationPlugin.id]: chromaticAberrationPlugin,
  [opacityPlugin.id]: opacityPlugin,
  [texturizerPlugin.id]: texturizerPlugin,
  [glowPlugin.id]: glowPlugin,
  [deformPlugin.id]: deformPlugin,
  // Scene-category devices, in the add menu's order: the grade first (the
  // foundation), then lens/blur (optics), then texture and destruction.
  [gradeScenePlugin.id]: gradeScenePlugin,
  [lensScenePlugin.id]: lensScenePlugin,
  [blurScenePlugin.id]: blurScenePlugin,
  [grainScenePlugin.id]: grainScenePlugin,
  [crushScenePlugin.id]: crushScenePlugin,
  [glitchScenePlugin.id]: glitchScenePlugin,
  [mirrorScenePlugin.id]: mirrorScenePlugin,
}

export function getEffect(id: string): VisualEffect | undefined {
  return EFFECTS[id]
}

/** All plugins as a list (for the library). */
export const PLUGIN_LIST: VisualEffect[] = Object.values(EFFECTS)
