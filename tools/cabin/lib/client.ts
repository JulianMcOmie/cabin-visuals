import fs from 'fs'
import http from 'http'
import path from 'path'
import { spawn } from 'child_process'
import { DAEMON_STATE, DEFAULT_DEV_URL, REPO } from './paths'

// Talking to the render daemon (daemon.ts): find it, start it if needed, call it.

interface DaemonState { pid: number; port: number; devUrl: string }

const CONFIG = path.join(REPO, 'tools/cabin/.config.json')

export function devUrl(): string {
  if (process.env.CABIN_DEV_URL) return process.env.CABIN_DEV_URL
  try {
    const c = JSON.parse(fs.readFileSync(CONFIG, 'utf8')) as { devUrl?: string }
    if (c.devUrl) return c.devUrl
  } catch { /* no config */ }
  return DEFAULT_DEV_URL
}

export function setDevUrl(url: string) {
  let c: Record<string, unknown> = {}
  try { c = JSON.parse(fs.readFileSync(CONFIG, 'utf8')) } catch { /* fresh */ }
  c.devUrl = url
  fs.writeFileSync(CONFIG, JSON.stringify(c, null, 2) + '\n')
}

function readState(): DaemonState | null {
  try { return JSON.parse(fs.readFileSync(DAEMON_STATE, 'utf8')) as DaemonState } catch { return null }
}

async function alive(s: DaemonState | null): Promise<boolean> {
  if (!s) return false
  try {
    const r = await fetch(`http://127.0.0.1:${s.port}/status`, { method: 'POST', body: '{}' })
    return r.ok
  } catch {
    return false
  }
}

export async function assertDevServer(url = devUrl()) {
  try {
    const r = await fetch(`${url}/api/dev/projects`)
    if (r.ok) return
    throw new Error(`HTTP ${r.status}`)
  } catch (e) {
    throw new Error(
      `the dev server isn't answering at ${url} (${(e as Error).message}).\n` +
      `  start it:  npm run dev            (or: cabin config dev-url http://localhost:<port> for another port)`,
    )
  }
}

/** Stop the daemon and wait for its process to exit: a daemon that is closing
 *  Chrome still answers /status, and a call routed to it meets a dead browser. */
export async function stopDaemon(): Promise<boolean> {
  const s = readState()
  if (!(await alive(s))) return false
  await call('/stop', {}).catch(() => undefined)
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    try { process.kill(s!.pid, 0) } catch { return true }
    await new Promise((r) => setTimeout(r, 150))
  }
  throw new Error(`the render daemon (pid ${s!.pid}) didn't exit - kill it and retry`)
}

export async function ensureDaemon(): Promise<DaemonState> {
  const url = devUrl()
  let s = readState()
  if (await alive(s)) {
    if (s!.devUrl === url) return s!
    await stopDaemon()
  }
  await assertDevServer(url)
  const logFile = path.join(REPO, 'tools/cabin/.daemon.log')
  const out = fs.openSync(logFile, 'a')
  const child = spawn(process.execPath, ['--import', 'tsx', path.join(REPO, 'tools/cabin/lib/daemon.ts'), `--dev-url=${url}`], {
    cwd: REPO, detached: true, stdio: ['ignore', out, out], env: process.env,
  })
  child.unref()
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 300))
    s = readState()
    if (s && s.pid === child.pid && (await alive(s))) return s
  }
  throw new Error(`the render daemon didn't start - see ${logFile}`)
}

/** POST to the daemon over plain http - no timeouts. (fetch/undici gives up on a
 *  response whose headers take > 300 s, and a full render's /stream answers only
 *  when the last frame is encoded.) */
function post(port: number, endpoint: string, body: string): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: endpoint, method: 'POST', headers: { 'Content-Type': 'application/json' } }, (res) => {
      let text = ''
      res.setEncoding('utf8')
      res.on('data', (c) => { text += c })
      res.on('end', () => resolve({ status: res.statusCode ?? 0, text }))
    })
    req.setTimeout(0)
    req.on('error', reject)
    req.end(body)
  })
}

export async function call<T = Record<string, unknown>>(endpoint: string, body: Record<string, unknown>): Promise<T> {
  const s = readState()
  if (!s) throw new Error('no daemon running')
  const r = await post(s.port, endpoint, JSON.stringify(body))
  const json = JSON.parse(r.text || '{}') as T & { error?: string; console?: string[] }
  if (r.status !== 200) {
    const extra = json.console?.length ? `\n  page console:\n    ${json.console.join('\n    ')}` : ''
    throw new Error(`${json.error ?? `daemon HTTP ${r.status}`}${extra}`)
  }
  return json
}

/** Poll /progress while a long call runs, printing a one-line bar. */
export async function withProgress<T>(label: string, work: Promise<T>): Promise<T> {
  let done = false
  const s = readState()
  const tick = async () => {
    while (!done) {
      await new Promise((r) => setTimeout(r, 1000))
      if (done || !s) break
      try {
        const r = await fetch(`http://127.0.0.1:${s.port}/progress`, { method: 'POST', body: '{}' })
        const p = (await r.json()) as { done?: number; total?: number; startedAt?: number }
        if (p.total) {
          const el = (Date.now() - (p.startedAt ?? Date.now())) / 1000
          const rate = (p.done ?? 0) / Math.max(0.001, el)
          const eta = rate > 0 ? ((p.total - (p.done ?? 0)) / rate) : 0
          process.stdout.write(`\r  ${label}: ${p.done}/${p.total} frames  ${rate.toFixed(1)} fps  eta ${Math.floor(eta / 60)}m${String(Math.round(eta % 60)).padStart(2, '0')}s   `)
        }
      } catch { /* daemon busy */ }
    }
  }
  void tick()
  try {
    return await work
  } finally {
    done = true
    process.stdout.write('\n')
  }
}
