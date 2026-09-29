import fs from 'fs'
import os from 'os'
import path from 'path'
import { execFileSync } from 'child_process'
import type { Cabin } from './api'
import { alignPlacement, formatBars, loadAnalysis, NOTE_NAMES } from './analysis'
import { mediaRef, REPO } from './paths'

// `cabin analyze`: the song → tools/analysis/analyze.py (Demucs stems, grid,
// events, envelopes) → projects/<name>/analysis/analysis.json, then into the
// project: tempo, the song aligned so its first downbeat is a bar line,
// suggested sections, and analysis.mid (every event as MIDI, in project beats).

const VENV = process.env.CABIN_VENV ?? path.join(os.homedir(), '.cache/cabin/venv')
const SCRIPT = path.join(REPO, 'tools/analysis/analyze.py')

function python(): string {
  const py = process.env.CABIN_PYTHON ?? path.join(VENV, 'bin/python')
  if (!fs.existsSync(py)) throw new Error(`no analysis python at ${py} - run: cabin analyze --setup  (or set CABIN_PYTHON)`)
  return py
}

/** Repo-relative when inside the repo, absolute otherwise (CABIN_PROJECTS_DIR). */
const shown = (f: string) => (f.startsWith(REPO + path.sep) ? path.relative(REPO, f) : f)

export function setupVenv() {
  const base = ['python3.13', 'python3.12', 'python3.11', 'python3'].find((b) => {
    try { execFileSync(b, ['--version'], { stdio: 'ignore' }); return true } catch { return false }
  })
  if (!base) throw new Error('no python3 on PATH')
  if (!fs.existsSync(path.join(VENV, 'bin/python'))) {
    console.log(`creating ${VENV} with ${base}`)
    fs.mkdirSync(path.dirname(VENV), { recursive: true })
    execFileSync(base, ['-m', 'venv', VENV], { stdio: 'inherit' })
  }
  const pip = path.join(VENV, 'bin/pip')
  execFileSync(pip, ['install', '-q', '--upgrade', 'pip'], { stdio: 'inherit' })
  console.log('installing librosa, demucs, torch (a few minutes the first time)')
  execFileSync(pip, ['install', '-q', 'librosa', 'soundfile', 'scipy', 'numpy', 'demucs', 'torch', 'torchaudio'], { stdio: 'inherit' })
  execFileSync(path.join(VENV, 'bin/python'), ['-c', 'import librosa, demucs, torch; print("ok: librosa", librosa.__version__, "torch", torch.__version__)'], { stdio: 'inherit' })
}

export interface AnalyzeOpts {
  /** Use an existing analysis.json instead of running the analysis. */
  json?: string
  /** Existing stems dir (drums/bass/vocals/other.wav) - skips Demucs. */
  stems?: string
  bpm?: string
  downbeat?: string
  /** Leave the project's tempo alone. */
  keepBpm?: boolean
  /** Replace existing sections with the suggested ones. */
  sections?: boolean
}

export function runAnalysis(p: Cabin, o: AnalyzeOpts): string {
  const outDir = path.join(p.dir, 'analysis')
  fs.mkdirSync(outDir, { recursive: true })
  const dest = path.join(outDir, 'analysis.json')
  if (o.json) {
    fs.copyFileSync(path.resolve(o.json), dest)
  } else {
    if (!p.meta.audio) throw new Error('the project has no song - pass --audio song.m4a (or cabin new <name> --audio ...)')
    const args = [SCRIPT, path.join(p.dir, p.meta.audio), '--out', outDir, '--beats-per-bar', String(p.beatsPerBar)]
    if (o.stems) args.push('--stems', path.resolve(o.stems))
    if (o.bpm) args.push('--bpm', o.bpm)
    if (o.downbeat) args.push('--downbeat', o.downbeat)
    execFileSync(python(), args, { stdio: 'inherit' })
  }
  const raw = loadAnalysis(dest)
  if (o.downbeat && o.json) raw.tempo.downbeat = Number(o.downbeat)

  if (!o.keepBpm) p.bpm = raw.tempo.bpm
  const place = alignPlacement(raw, p.beatsPerBar)
  if (p.meta.audio) {
    const ref = mediaRef(p.name, p.meta.audio)
    for (const t of Object.values(p.doc.audioTracks)) {
      for (const b of t.audioBlocks ?? []) {
        if (b.clipRef !== ref) continue
        b.startBar = place.startBar
        b.trimStart = place.trimStart
      }
    }
  }
  p.meta.analysis = path.relative(p.dir, dest)
  // the downbeat may come from --downbeat on a reused json: keep it with the file
  fs.writeFileSync(dest, JSON.stringify(raw))

  const a = p.analysis()
  p.ensureBars(Math.ceil(a.endBeat / p.beatsPerBar))
  const suggested = a.sections()
  const replaced = !p.sections.length || !!o.sections
  if (replaced) p.sections = suggested.map(({ name, from, to }) => ({ name, from, to }))
  const midi = path.join(outDir, 'analysis.mid')
  a.toMidi(midi)

  const counts = Object.entries(raw.events).map(([k, v]) => `${k} ${v.length}`).join(' · ')
  const roots = new Array(12).fill(0)
  for (const h of raw.harmony) if (h.b >= 0) roots[h.b]++
  const topRoots = roots.map((n, pc) => [n, pc] as const).sort((x, y) => y[0] - x[0]).slice(0, 4).filter(([n]) => n > 0).map(([, pc]) => NOTE_NAMES[pc])
  return [
    `${p.name}: ${raw.tempo.bpm} BPM, first downbeat ${(raw.tempo.downbeat ?? raw.tempo.phase).toFixed(4)}s → ` +
      (place.trimStart > 0 ? `trimmed ${place.trimStart.toFixed(3)}s so bar 0 is ONE` : `song starts at bar ${place.startBar.toFixed(3)} so bar ${Math.ceil(place.startBar)} is ONE`),
    `events: ${counts}`,
    `commonest bass roots: ${topRoots.join(' ')}`,
    `sections${replaced ? '' : ' (suggested - kept yours; --sections to replace)'}: ${suggested.map((s) => `${s.name} ${s.from}-${s.to}`).join(' · ')}`,
    `wrote ${shown(dest)} and ${shown(midi)}`,
    '',
    formatBars(a.bars(), replaced ? p.sections : suggested),
  ].join('\n')
}
