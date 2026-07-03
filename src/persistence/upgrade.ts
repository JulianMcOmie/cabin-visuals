import type { ProjectDocument } from './types'
import { emptyDocument } from './types'

/** Bump when the document shape changes, and append the matching step below. */
export const CURRENT_VERSION = 1

type UpgradeStep = (doc: Record<string, unknown>) => Record<string, unknown>

// vN → vN+1, keyed by N. Append-only: a shipped step is never edited, so any
// old blob can walk the chain to the current shape. Each step is pure — it
// returns a new object and never mutates its input.
const UPGRADES: Record<number, UpgradeStep> = {}

/**
 * Bring a raw blob (any past version) up to the current document shape.
 * The rest of the app only ever sees CURRENT_VERSION documents.
 */
export function upgradeDocument(raw: unknown): ProjectDocument {
  // Not a document at all (null, pre-versioned, corrupt) → start fresh rather
  // than crash the editor on open.
  if (raw === null || typeof raw !== 'object') return emptyDocument()
  let doc = raw as Record<string, unknown>
  if (typeof doc.schemaVersion !== 'number') return emptyDocument()

  while ((doc.schemaVersion as number) < CURRENT_VERSION) {
    const step = UPGRADES[doc.schemaVersion as number]
    if (!step) throw new Error(`No upgrade step from document version ${doc.schemaVersion}`)
    doc = { ...step(doc), schemaVersion: (doc.schemaVersion as number) + 1 }
  }
  return doc as unknown as ProjectDocument
}
