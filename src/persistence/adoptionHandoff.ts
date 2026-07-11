// Handoff between anonymous adoption and the persistence binding.
//
// Adoption creates the project row FROM the current in-memory document, then
// rebinds the URL. When useProjectPersistence picks up the new ?project=, the
// normal bind path (blank slate → network load → hydrate) would wipe and
// re-fill the stores with the very document they already hold - every store
// consumer visibly flaps (the first-run tutorial snaps back a step, the
// timeline empties for a beat). This marker lets the bind recognize "this row
// was just seeded from memory" and skip straight to arming autosave.
//
// Deliberately time-windowed rather than consume-once: React StrictMode runs
// the binding effect twice in dev, and both runs must take the handoff. Any
// later rebind (navigating away and back) falls outside the window and loads
// normally.

const WINDOW_MS = 10_000

let adopted: { id: string; name: string; at: number } | null = null

/** Adoption calls this right before rebinding the URL to the new row. */
export function markAdopted(id: string, name: string): void {
  adopted = { id, name, at: Date.now() }
}

/** Does `id` refer to a row just seeded from the current in-memory document? */
export function justAdopted(id: string): { name: string } | null {
  if (!adopted || adopted.id !== id || Date.now() - adopted.at > WINDOW_MS) return null
  return { name: adopted.name }
}
