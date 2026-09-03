import { createContext } from 'react'

/**
 * Which project scene the mounted instrument occurrence renders in. Provided
 * by ObjectRenderer / InstancedObjectRenderer (which know their scene) and
 * read by instruments that talk to per-scene machinery - the Light instrument
 * registers its anchor here, and the 3D Shape's Matte finish looks up its
 * scene's key-light direction. Null outside the engine's render path (settings
 * panels, library previews), where callers fall back to fixed defaults.
 */
export const SceneIdContext = createContext<string | null>(null)
