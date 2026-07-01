// Registry: collects every visual effect plugin. Adding an effect = one new file +
// one entry here. The renderer resolves a track's PluginInstance to its def via getPlugin.

import { offsetPlugin } from './transforms/offset'
import { rotatePlugin } from './transforms/rotate'
import { scalePlugin } from './transforms/scale'
import type { VisualPlugin } from './types'

export type { VisualPlugin, EffectCategory } from './types'

export const PLUGINS: Record<string, VisualPlugin> = {
  [offsetPlugin.id]: offsetPlugin,
  [rotatePlugin.id]: rotatePlugin,
  [scalePlugin.id]: scalePlugin,
}

export function getPlugin(id: string): VisualPlugin | undefined {
  return PLUGINS[id]
}

/** All plugins as a list (for the library). */
export const PLUGIN_LIST: VisualPlugin[] = Object.values(PLUGINS)
