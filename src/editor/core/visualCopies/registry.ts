// The new-definition registry. Registry ownership (not a new track type per
// runtime) is what routes ids during migration: ids found here resolve through
// the VisualCopy chain; unknown ids fall back to the legacy mover registry.
// New ids must stay distinct from legacy mover ids until deliberate migrations
// exist. This module must not import the legacy registry.

import type { MoverOrSplitterDefinition } from './definitions'
import { MOVER_OR_SPLITTER_DEFINITIONS } from './library'

const definitions = new Map<string, MoverOrSplitterDefinition<any>>()

export function registerMoverOrSplitterDefinition<Settings>(
  definition: MoverOrSplitterDefinition<Settings>,
): void {
  if (definitions.has(definition.id)) {
    throw new Error(`MoverOrSplitter definition id already registered: ${definition.id}`)
  }
  definitions.set(definition.id, definition)
}

/** Undefined means the id belongs to the legacy path (or nothing). */
export function getMoverOrSplitterDefinition(
  id: string | undefined,
): MoverOrSplitterDefinition<any> | undefined {
  return id ? definitions.get(id) : undefined
}

export function hasMoverOrSplitterDefinition(id: string | undefined): boolean {
  return !!id && definitions.has(id)
}

/** Every registered definition, in registration order (library order first) -
 *  the library picker enumerates these. */
export function listMoverOrSplitterDefinitions(): MoverOrSplitterDefinition<any>[] {
  return [...definitions.values()]
}

/** Test-only escape hatch so fake definitions don't leak between test files. */
export function unregisterMoverOrSplitterDefinitionForTests(id: string): void {
  definitions.delete(id)
}

// Seed the production library (mirrors the legacy registry importing its
// library). Test fakes register on top with distinct 'test.*' ids.
for (const definition of MOVER_OR_SPLITTER_DEFINITIONS) {
  registerMoverOrSplitterDefinition(definition)
}
