import fs from 'fs'
import path from 'path'
import type { ProjectDocument } from '../../../src/persistence/types'
import { upgradeDocument } from '../../../src/persistence/upgrade'
import { docPath, projectDir } from './project'

// Every CLI save records the document it WROTE in projects/<name>/.history/
// (newest last, capped). So:
//   cabin diff <name>          what changed since my last write (= your edits in the editor)
//   cabin diff <name> --last   what my last write changed
//   cabin history <name>       the writes, labelled
//   cabin undo <name>          put back the document before my last write
// The editor's own edits land in project.json via file sync and are never
// overwritten silently: undo refuses when the file moved since that write.

const KEEP = 80

export interface HistoryEntry { file: string; seq: number; at: string; label: string }

const dirOf = (name: string) => path.join(projectDir(name), '.history')

export function listHistory(name: string): HistoryEntry[] {
  const dir = dirOf(name)
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir)
    .filter((f) => /^\d{5}-/.test(f) && f.endsWith('.json'))
    .sort()
    .map((f) => {
      const m = /^(\d{5})-(\d{8}T\d{6})-(.*)\.json$/.exec(f)
      return {
        file: path.join(dir, f),
        seq: Number(m?.[1] ?? 0),
        at: m ? `${m[2].slice(0, 4)}-${m[2].slice(4, 6)}-${m[2].slice(6, 8)} ${m[2].slice(9, 11)}:${m[2].slice(11, 13)}:${m[2].slice(13, 15)}` : '',
        label: (m?.[3] ?? f).replace(/_/g, ' '),
      }
    })
}

export function readEntry(e: HistoryEntry): ProjectDocument {
  // snapshots written under an older schema compare in the current one
  return upgradeDocument(JSON.parse(fs.readFileSync(e.file, 'utf8')))
}

/** Record a written document (call right after writing project.json). */
export function recordWrite(name: string, doc: ProjectDocument, label: string) {
  const dir = dirOf(name)
  fs.mkdirSync(dir, { recursive: true })
  const all = listHistory(name)
  const seq = (all[all.length - 1]?.seq ?? 0) + 1
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, '').slice(0, 15)
  const safe = label.replace(/[^a-zA-Z0-9.-]+/g, '_').slice(0, 60) || 'write'
  fs.writeFileSync(path.join(dir, `${String(seq).padStart(5, '0')}-${stamp}-${safe}.json`), JSON.stringify(doc))
  for (const old of all.slice(0, Math.max(0, all.length + 1 - KEEP))) fs.rmSync(old.file, { force: true })
}

/** Before the first CLI write, keep what was there (the editor's or a fresh doc) as the base. */
export function ensureBase(name: string) {
  if (listHistory(name).length) return
  const file = docPath(name)
  if (!fs.existsSync(file)) return
  recordWrite(name, JSON.parse(fs.readFileSync(file, 'utf8')) as ProjectDocument, 'base')
}
