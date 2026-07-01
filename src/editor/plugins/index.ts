// Registry: collects every visual effect plugin. Adding an effect = one new file +
// one entry here. The renderer resolves a track's PluginInstance to its def via getPlugin.

import { offsetPlugin } from './transforms/offset'
import { rotatePlugin } from './transforms/rotate'
import { scalePlugin } from './transforms/scale'
import { echoPlugin } from './clones/echo'
import { tilePlugin } from './clones/tile'
import { radialSymmetryPlugin } from './clones/radialSymmetry'
import { linearDuplicatePlugin } from './clones/linearDuplicate'
import { rotationalSymmetryPlugin } from './clones/rotationalSymmetry'
import { kaleidoscopePlugin } from './shaders/kaleidoscope'
import { pixelatePlugin } from './shaders/pixelate'
import { chromaticAberrationPlugin } from './shaders/chromaticAberration'
import { opacityPlugin } from './shaders/opacity'
import type { VisualPlugin } from './types'

export type { VisualPlugin, EffectCategory, CloneSpec } from './types'

export const PLUGINS: Record<string, VisualPlugin> = {
  [offsetPlugin.id]: offsetPlugin,
  [rotatePlugin.id]: rotatePlugin,
  [scalePlugin.id]: scalePlugin,
  [echoPlugin.id]: echoPlugin,
  [tilePlugin.id]: tilePlugin,
  [radialSymmetryPlugin.id]: radialSymmetryPlugin,
  [linearDuplicatePlugin.id]: linearDuplicatePlugin,
  [rotationalSymmetryPlugin.id]: rotationalSymmetryPlugin,
  [kaleidoscopePlugin.id]: kaleidoscopePlugin,
  [pixelatePlugin.id]: pixelatePlugin,
  [chromaticAberrationPlugin.id]: chromaticAberrationPlugin,
  [opacityPlugin.id]: opacityPlugin,
}

export function getPlugin(id: string): VisualPlugin | undefined {
  return PLUGINS[id]
}

/** All plugins as a list (for the library). */
export const PLUGIN_LIST: VisualPlugin[] = Object.values(PLUGINS)
