import type { ResolvedNote } from '../../core/visual/types'
import type { Look } from '../../core/visual/look'

// What the SDK reaches OUTSIDE a track through: other tracks' notes (lanes),
// the camera claim, the frame's look. The editor wires the real services in at
// startup (code/register.tsx); under node (the CLI, tests) they stay no-ops, so
// SDK modules never import the engine and stay node-safe. Kept on globalThis
// so a hot reload of this file can't drop the wiring.

export interface WorldServices {
  /** Resolved notes of a track by name ('Kick' or 'Scene/Track'). */
  laneNotes(name: string): readonly ResolvedNote[] | undefined
  claimCamera(trackId: string): void
  setTrackLook(trackId: string, look: Look | null): void
  setCompositionLook(look: Look | null): void
}

const NOOP: WorldServices = {
  laneNotes: () => undefined,
  claimCamera: () => {},
  setTrackLook: () => {},
  setCompositionLook: () => {},
}

const holder = globalThis as unknown as { __cabinWorld?: WorldServices }

export function provideWorld(services: Partial<WorldServices>) {
  holder.__cabinWorld = { ...(holder.__cabinWorld ?? NOOP), ...services }
}

export function world(): WorldServices {
  return holder.__cabinWorld ?? NOOP
}
