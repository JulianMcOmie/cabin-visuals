import fs from 'fs'
import path from 'path'
import type { ProjectDocument } from '../../../src/persistence/types'
import { PROJECTS } from './paths'

// A project on disk: projects/<name>/
//   project.json   the Cabin document (the editor syncs with it live: /editor?file=<name>)
//   cabin.json     CLI metadata: named sections, notes, source audio, analysis
//   audio/ …       media the document references through the dev file route
//   renders/       shots, clips and renders the CLI writes
//   scripts/       edit scripts (`cabin run <name> scripts/foo.ts`)

export interface Section {
  name: string
  /** First bar (0-based, inclusive). */
  from: number
  /** End bar (exclusive). */
  to: number
}

export interface CabinMeta {
  sections?: Section[]
  /** Free-form notes for whoever (whichever model) works on the project next. */
  notes?: string
  /** The song file, relative to the project folder. */
  audio?: string
  /** The song's analysis (cabin analyze), relative to the project folder. */
  analysis?: string
  /** Set once notes carry provenance (see api.ts adoptLegacyNotes). */
  provenance?: number
  /** Per track: hashes of script notes the user deleted - scripts won't re-add them. */
  tombstones?: Record<string, string[]>
  [key: string]: unknown
}

const NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/

export function projectDir(name: string): string {
  if (!NAME.test(name)) throw new Error(`bad project name "${name}" (letters, digits, . _ -)`)
  return path.join(PROJECTS, name)
}

export const docPath = (name: string) => path.join(projectDir(name), 'project.json')
export const metaPath = (name: string) => path.join(projectDir(name), 'cabin.json')

export function projectExists(name: string): boolean {
  return fs.existsSync(docPath(name))
}

export function listProjects(): string[] {
  if (!fs.existsSync(PROJECTS)) return []
  return fs.readdirSync(PROJECTS).filter((n) => NAME.test(n) && fs.existsSync(path.join(PROJECTS, n, 'project.json'))).sort()
}

export function loadDoc(name: string): ProjectDocument {
  const file = docPath(name)
  if (!fs.existsSync(file)) throw new Error(`no project "${name}" (${file}). Create it: cabin new ${name}`)
  return JSON.parse(fs.readFileSync(file, 'utf8')) as ProjectDocument
}

export function loadMeta(name: string): CabinMeta {
  const file = metaPath(name)
  return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, 'utf8')) as CabinMeta) : {}
}

function writeAtomic(file: string, content: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, content)
  fs.renameSync(tmp, file)
}

export function saveDoc(name: string, doc: ProjectDocument) {
  writeAtomic(docPath(name), JSON.stringify(doc, null, 1) + '\n')
}

export function saveMeta(name: string, meta: CabinMeta) {
  writeAtomic(metaPath(name), JSON.stringify(meta, null, 2) + '\n')
}

/** Structural problems that would make the editor misbehave silently. */
export function validateDoc(doc: ProjectDocument): string[] {
  const problems: string[] = []
  const mains = doc.sceneOrder.filter((id) => doc.scenes[id]?.isMain)
  if (mains.length !== 1) problems.push(`expected exactly one Composite (isMain) scene, found ${mains.length}`)
  for (const id of Object.keys(doc.scenes)) if (!doc.sceneOrder.includes(id)) problems.push(`scene ${id} missing from sceneOrder`)
  for (const id of doc.sceneOrder) if (!doc.scenes[id]) problems.push(`sceneOrder names missing scene ${id}`)
  for (const scene of Object.values(doc.scenes)) {
    const where = `scene "${scene.name}"`
    for (const rid of scene.rootTrackIds) if (!scene.tracks[rid]) problems.push(`${where}: root ${rid} has no track`)
    for (const t of Object.values(scene.tracks)) {
      for (const c of t.childIds) {
        const child = scene.tracks[c]
        if (!child) problems.push(`${where}: track "${t.name}" lists missing child ${c}`)
        else if (child.parentId !== t.id) problems.push(`${where}: child "${child.name}" parentId ≠ "${t.name}"`)
      }
      if (t.parentId && !scene.tracks[t.parentId]) problems.push(`${where}: track "${t.name}" has missing parent`)
      if (!t.parentId && !scene.rootTrackIds.includes(t.id)) problems.push(`${where}: track "${t.name}" is neither a root nor a child`)
      for (const b of t.blocks) {
        if (!(b.durationBars > 0) || !Number.isFinite(b.startBar)) problems.push(`${where}: track "${t.name}" block ${b.id} has bad bounds`)
        for (const n of b.notes) {
          if (![n.startBeat, n.durationBeats, n.pitch, n.velocity].every(Number.isFinite)) {
            problems.push(`${where}: track "${t.name}" note ${n.id} has non-finite fields`)
            break
          }
        }
      }
    }
  }
  return problems
}
