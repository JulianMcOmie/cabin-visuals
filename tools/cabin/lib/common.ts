import fs from 'fs'
import path from 'path'
import { Cabin } from './api'
import type { TrackApi } from './api'
import { loadDoc, loadMeta, projectDir, saveDoc, saveMeta, validateDoc } from './project'
import { mediaRef, REPO } from './paths'
import { probeDuration } from './audio'
import type { TimeCtx } from './time'
import { ensureBase, recordWrite } from './history'

// Helpers every command module shares: open/save a project (with history),
// resolve "scene/track", coerce CLI values, the editor URL, the registry.

export function open(name: string): Cabin {
  return new Cabin(name, loadDoc(name), loadMeta(name), projectDir(name))
}

export function timeCtx(p: Cabin): TimeCtx {
  return { bpm: p.bpm, beatsPerBar: p.beatsPerBar, sections: p.sections }
}

/** Validate and write the project (document + cabin.json), recording it in .history. */
export function save(p: Cabin, label: string, dry = false): boolean {
  const problems = validateDoc(p.doc)
  if (problems.length) {
    console.error(`refusing to save - the document has problems:\n  ${problems.join('\n  ')}`)
    process.exitCode = 1
    return false
  }
  if (dry) { console.log('(dry run - nothing written)'); return false }
  ensureBase(p.name)
  saveDoc(p.name, p.doc)
  saveMeta(p.name, p.meta)
  recordWrite(p.name, p.doc, label)
  return true
}

/** "scene/track" (scene may be 'main'/'composite'), or just "track" searched everywhere. */
export function resolveTrack(p: Cabin, spec: string): TrackApi {
  const slash = spec.indexOf('/')
  if (slash > 0) {
    const sceneName = spec.slice(0, slash)
    const scene = /^(main|composite)$/i.test(sceneName) ? p.main() : p.scene(sceneName, { create: false })
    return scene.get(spec.slice(slash + 1))
  }
  const hits = [...p.scenes(), p.main()].flatMap((s) => (s.find(spec) ? [s.find(spec)!] : []))
  if (hits.length === 1) return hits[0]
  if (hits.length === 0) throw new Error(`no track "${spec}" in any scene`)
  throw new Error(`"${spec}" is in several scenes (${hits.map((h) => h.scene.name).join(', ')}) - use <scene>/<track>`)
}

export function coerce(v: string): number | boolean | string {
  if (v === 'true') return true
  if (v === 'false') return false
  if (/^-?\d*\.?\d+(e-?\d+)?$/i.test(v)) return Number(v)
  return v
}

export async function editorUrl(name: string) {
  const { devUrl } = await import('./client')
  return `${devUrl()}/editor?file=${encodeURIComponent(name)}`
}

/** Regenerate the code-instrument registry (scripts/code-instruments.cjs). */
export function regenerate(verbose = false) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const gen = require(path.join(REPO, 'scripts/code-instruments.cjs')) as { generate: (o?: { quiet?: boolean }) => { instruments: Array<{ rel: string }>; compositions: Array<{ rel: string }> } }
  const r = gen.generate({ quiet: true })
  if (verbose) {
    console.log(`instruments (${r.instruments.length}):\n  ${r.instruments.map((x) => x.rel).join('\n  ') || '(none)'}`)
    console.log(`compositions (${r.compositions.length}):\n  ${r.compositions.map((x) => x.rel).join('\n  ') || '(none)'}`)
  }
}

/** Copy a song into the project and put it on the timeline. */
export async function attachAudio(p: Cabin, src: string) {
  const from = path.resolve(src)
  if (!fs.existsSync(from)) throw new Error(`no audio file ${from}`)
  const rel = path.join('audio', path.basename(from))
  const dest = path.join(p.dir, rel)
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  if (path.resolve(dest) !== from) fs.copyFileSync(from, dest)
  const duration = probeDuration(dest)
  p.addAudio(mediaRef(p.name, rel), { name: path.basename(from).replace(/\.[^.]+$/, ''), fileName: path.basename(from), duration })
  p.meta.audio = rel
}
