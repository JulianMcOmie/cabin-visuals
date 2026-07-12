// Registry: collects every visual effect plugin. Adding an effect = one new file +
// one entry here. The renderer resolves a track's EffectInstance to its def via getEffect.

import { offsetPlugin } from './transforms/offset'
import { rotatePlugin } from './transforms/rotate'
import { scalePlugin } from './transforms/scale'
import { kaleidoscopePlugin } from './shaders/kaleidoscope'
import { pixelatePlugin } from './shaders/pixelate'
import { chromaticAberrationPlugin } from './shaders/chromaticAberration'
import { opacityPlugin } from './shaders/opacity'
import type { VisualEffect } from './types'

export type { VisualEffect, EffectCategory } from './types'

export const EFFECTS: Record<string, VisualEffect> = {
  [offsetPlugin.id]: offsetPlugin,
  [rotatePlugin.id]: rotatePlugin,
  [scalePlugin.id]: scalePlugin,
  [kaleidoscopePlugin.id]: kaleidoscopePlugin,
  [pixelatePlugin.id]: pixelatePlugin,
  [chromaticAberrationPlugin.id]: chromaticAberrationPlugin,
  [opacityPlugin.id]: opacityPlugin,
}

export function getEffect(id: string): VisualEffect | undefined {
  return EFFECTS[id]
}

/** All plugins as a list (for the library). */
export const PLUGIN_LIST: VisualEffect[] = Object.values(EFFECTS)
