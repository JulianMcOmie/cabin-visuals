// The render daemon: one long-lived headless Chrome (the installed Google
// Chrome, so WebGL runs on the real GPU) holding the editor open on a project
// (`/editor?file=<name>`), plus a tiny HTTP API the CLI talks to. Keeping the
// page warm is the point: a still costs a fraction of a second instead of a
// cold editor boot. Started on demand by the CLI (client.ts); exits after 30
// minutes idle, or on `cabin daemon stop`.
//
// Frames never leave the page as PNGs for clips/renders: the page streams raw
// RGBA over a WebSocket to this process, which pipes them into ffmpeg.

import http from 'http'
import fs from 'fs'
import path from 'path'
import { spawn } from 'child_process'
import { WebSocketServer } from 'ws'
import { chromium, type Browser, type Page } from 'playwright'
import { DAEMON_STATE, PROJECTS } from './paths'
import { audioMix } from './audio'
import type { ProjectDocument } from '../../../src/persistence/types'
import type { DocSkeleton } from '../../../src/editor/dev/renderHooks'

const CHROME = process.env.CABIN_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const devUrl = (process.argv.find((a) => a.startsWith('--dev-url=')) ?? '--dev-url=http://localhost:3000').slice('--dev-url='.length)
const IDLE_MS = 30 * 60 * 1000

let browser: Browser | null = null
let page: Page | null = null
let openProject: string | null = null
let lastUse = Date.now()
const consoleLog: string[] = []
let progress: { done: number; total: number; startedAt: number } | null = null

function log(...args: unknown[]) {
  console.log(new Date().toISOString().slice(11, 19), ...args)
}

// No auth round trips from a headless dev page.
const ABORTED = /supabase\.co\/(rest|auth|storage)/

async function ensurePage(): Promise<Page> {
  if (page && !page.isClosed() && browser?.isConnected()) return page
  if (!browser?.isConnected()) {
    // First use, or Chrome went away (a GPU crash): start a fresh one.
    if (browser) log('browser disconnected - relaunching')
    browser = await chromium.launch({
      executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
      headless: true,
      args: ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--autoplay-policy=no-user-gesture-required'],
    })
  }
  page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  await page.route(ABORTED, (r) => r.abort())
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') {
      // "Failed to load resource" says which resource only in its location.
      const url = m.text().startsWith('Failed to load resource') ? m.location().url : ''
      if (url && ABORTED.test(url)) return
      const line = `[${m.type()}] ${m.text()}${url ? ` ${url}` : ''}`
      consoleLog.push(line)
      if (consoleLog.length > 300) consoleLog.shift()
    }
  })
  page.on('pageerror', (e) => { consoleLog.push(`[pageerror] ${e.message}`) })
  openProject = null
  return page
}

/** The editor is up: render hooks installed, the file loaded, a canvas mounted. */
const editorReady = () => !!window.__cabinRender && !!window.__cabinFileSync && (window.__cabinFileSync.loads ?? 0) > 0 && !!(window as unknown as { __three?: unknown }).__three

async function openOn(project: string): Promise<Page> {
  const p = await ensurePage()
  if (openProject !== project) {
    log('open', project)
    await p.goto(`${devUrl}/editor?file=${encodeURIComponent(project)}`, { waitUntil: 'domcontentloaded', timeout: 180_000 })
    await p.waitForFunction(editorReady, null, { timeout: 180_000 })
    openProject = project
  }
  return p
}

/** The file's skeleton (bpm, scenes, track ids) - what the page must be showing. */
function skeleton(project: string): DocSkeleton {
  const doc = JSON.parse(fs.readFileSync(path.join(PROJECTS, project, 'project.json'), 'utf8')) as ProjectDocument
  const scenes = doc.sceneOrder.filter((id) => doc.scenes[id])
  const codeIds = new Set<string>()
  for (const id of scenes) for (const t of Object.values(doc.scenes[id].tracks)) if (t.instrumentId?.includes('.')) codeIds.add(t.instrumentId)
  return {
    bpm: doc.bpm,
    scenes: scenes.map((id) => ({ id, name: doc.scenes[id].name, trackIds: Object.keys(doc.scenes[id].tracks) })),
    codeIds: [...codeIds],
  }
}

/** Make sure the page shows the file's CURRENT version, settled. In ?file= sessions
 *  the page reloads itself when an instrument or the engine is hot-reloaded
 *  (src/editor/dev/hmrReload.ts), so a sync can meet a navigation mid-way: retry. */
async function sync(project: string): Promise<Page> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await syncOnce(project)
    } catch (e) {
      const msg = (e as Error).message
      if (attempt >= 3 || !/context was destroyed|navigat|Target closed|detached/i.test(msg)) throw e
      log('page navigated during sync - retrying')
      await new Promise((r) => setTimeout(r, 500))
    }
  }
}

async function syncOnce(project: string): Promise<Page> {
  const p = await openOn(project)
  // A hot reload (an instrument file edited) restarts the page's modules:
  // wait for the editor to be back before talking to it.
  await p.waitForFunction(editorReady, null, { timeout: 180_000 })
  const res = await fetch(`${devUrl}/api/dev/projects/${encodeURIComponent(project)}?versionOnly=1`)
  const { version } = (await res.json()) as { version: string }
  const pageVersion = await p.evaluate(() => window.__cabinFileSync?.version ?? null)
  if (pageVersion !== version) await p.evaluate(() => window.__cabinFileSync!.reload())
  // The version alone can lie after a hot reload (the stores were replaced
  // under a file-sync closure that still thinks it's current): check what's
  // actually in the stores, and reload the page if it isn't this file.
  const skel = skeleton(project)
  let off = await p.evaluate((s) => window.__cabinRender!.mismatch(s), skel)
  if (off.length) {
    log('page out of sync -', off.join('; '), '- reloading')
    await p.reload({ waitUntil: 'domcontentloaded', timeout: 180_000 })
    await p.waitForFunction(editorReady, null, { timeout: 180_000 })
    off = await p.evaluate((s) => window.__cabinRender!.mismatch(s), skel)
    if (off.length) throw new Error(`the editor is not showing ${project}: ${off.join('; ')}`)
  }
  await p.evaluate(() => window.__cabinFileSync!.whenSettled())
  return p
}

async function codeErrors(p: Page) {
  return p.evaluate(() => window.__cabinRender?.errors() ?? [])
}

type Json = Record<string, unknown>

async function handleShot(body: Json) {
  const project = String(body.project)
  const p = await sync(project)
  await p.evaluate(() => (window as unknown as { __cabinClearCodeErrors?: () => void }).__cabinClearCodeErrors?.())
  const logStart = consoleLog.length
  const view = await p.evaluate((v) => window.__cabinRender!.view(v), String(body.view ?? 'main'))
  // A view switch re-resolves the canvas; give it a frame.
  await p.waitForTimeout(150)
  const images = await p.evaluate(
    ([beats, w, h]) => window.__cabinRender!.captureBeats(beats as number[], { width: w as number, height: h as number }),
    [body.beats, body.width ?? 960, body.height ?? 540] as const,
  )
  return { images, view, errors: await codeErrors(p), console: consoleLog.slice(logStart) }
}

async function handleStream(body: Json) {
  const project = String(body.project)
  const out = String(body.out)
  const p = await sync(project)
  await p.evaluate((v) => window.__cabinRender!.view(v), String(body.view ?? 'main'))
  await p.waitForTimeout(150)
  const fps = Number(body.fps ?? 30)
  const frames = Number(body.frames)
  const startBeat = Number(body.startBeat)
  const doc = JSON.parse(fs.readFileSync(path.join(PROJECTS, project, 'project.json'), 'utf8'))
  const fromSec = (startBeat * 60) / doc.bpm
  const durSec = frames / fps
  const mix = body.audio === false ? null : audioMix(doc, project, fromSec, durSec, 1)

  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0, maxPayload: 256 * 1024 * 1024 })
  await new Promise<void>((ok) => wss.on('listening', () => ok()))
  const wsPort = (wss.address() as { port: number }).port
  fs.mkdirSync(path.dirname(out), { recursive: true })

  let ff: ReturnType<typeof spawn> | null = null
  let ffDone: Promise<void> | null = null
  progress = { done: 0, total: frames, startedAt: Date.now() }
  wss.on('connection', (sock) => {
    let header: { width: number; height: number } | null = null
    sock.on('message', (data: Buffer, isBinary: boolean) => {
      if (!isBinary) {
        const text = String(data)
        if (text === 'end') {
          ff!.stdin!.end()
          void ffDone!.then(() => sock.send('done'), (e) => { log('ffmpeg failed', e); sock.send('done') })
          return
        }
        header = JSON.parse(text)
        const video = body.vt
          ? ['-c:v', 'hevc_videotoolbox', '-q:v', String(body.q ?? 65), '-tag:v', 'hvc1']
          : ['-c:v', 'libx264', '-preset', String(body.preset ?? 'medium'), '-crf', String(body.crf ?? 18), '-profile:v', 'high']
        const args = [
          '-y', '-hide_banner', '-loglevel', 'error',
          '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${header!.width}x${header!.height}`, '-r', String(fps), '-i', '-',
          ...(mix ? mix.inputs : []),
          ...(mix ? ['-filter_complex', `[0:v]vflip[vout];${mix.filter}`, '-map', '[vout]', '-map', '[aout]'] : ['-vf', 'vflip']),
          ...video, '-pix_fmt', 'yuv420p',
          ...(mix ? ['-c:a', 'aac', '-b:a', '256k'] : []),
          '-movflags', '+faststart', out,
        ]
        ff = spawn('ffmpeg', args, { stdio: ['pipe', 'inherit', 'inherit'] })
        ffDone = new Promise((ok, fail) => ff!.on('exit', (c) => (c === 0 ? ok() : fail(new Error(`ffmpeg exited ${c}`)))))
        return
      }
      if (!ff) return
      if (!ff.stdin!.write(data)) {
        ;(sock as unknown as { _socket: { pause(): void; resume(): void } })._socket.pause()
        ff.stdin!.once('drain', () => (sock as unknown as { _socket: { resume(): void } })._socket.resume())
      }
      if (progress) progress.done++
    })
  })
  try {
    const result = await p.evaluate((o) => window.__cabinRender!.stream(o), {
      startBeat, frames, fps,
      width: Number(body.width ?? 1920), height: Number(body.height ?? 1080),
      subframes: Number(body.subframes ?? 1), shutter: Number(body.shutter ?? 0.5),
      url: `ws://127.0.0.1:${wsPort}`,
    })
    return { out, ...result, errors: await codeErrors(p) }
  } finally {
    wss.close()
    progress = null
  }
}

async function route(url: string, body: Json): Promise<unknown> {
  lastUse = Date.now()
  switch (url) {
    case '/status': return { ok: true, devUrl, project: openProject, pid: process.pid }
    case '/shot': return handleShot(body)
    case '/stream': return handleStream(body)
    case '/progress': return progress ?? {}
    case '/audit': {
      const p = await sync(String(body.project))
      await p.evaluate((v) => window.__cabinRender!.view(v), String(body.view ?? 'main'))
      await p.waitForTimeout(150)
      progress = { done: 0, total: 1, startedAt: Date.now() }
      try {
        return { frames: await p.evaluate((o) => window.__cabinRender!.audit(o), body as unknown as Parameters<NonNullable<Window['__cabinRender']>['audit']>[0]) }
      } finally {
        progress = null
      }
    }
    case '/ui': {
      // A screenshot of the editor itself (panels, timeline) - for checking UI work.
      const p = await sync(String(body.project))
      const w = Number(body.width ?? 1600), h = Number(body.height ?? 1000)
      await p.setViewportSize({ width: w, height: h })
      await p.evaluate((o) => {
        const st = (window as unknown as { __cabinStores?: { project: { getState(): { setActiveScene(id: string): void } }; ui: { getState(): { setSelectedTrackId(id: string | null): void; setCanvasView(v: string): void } }; time: { getState(): { setCurrentBeat(b: number): void } } } }).__cabinStores
        if (!st) return
        if (o.sceneId) st.project.getState().setActiveScene(o.sceneId)
        if (o.trackId !== undefined) st.ui.getState().setSelectedTrackId(o.trackId)
        if (o.view) st.ui.getState().setCanvasView(o.view)
        if (o.beat !== undefined) st.time.getState().setCurrentBeat(o.beat)
        if (o.eval) new Function(o.eval)()
      }, { sceneId: body.sceneId as string | undefined, trackId: body.trackId as string | null | undefined, view: body.view as string | undefined, beat: body.beat as number | undefined, eval: body.eval as string | undefined })
      await p.waitForTimeout(Number(body.settleMs ?? 600))
      // scripted input before the shot: "press c; type hello; press Meta+Enter; click [data-testid=x]; wait 300; move 400 300"
      for (const step of String(body.do ?? '').split(';').map((x) => x.trim()).filter(Boolean)) {
        const sp = step.indexOf(' ')
        const verb = sp < 0 ? step : step.slice(0, sp)
        const arg = sp < 0 ? '' : step.slice(sp + 1)
        if (verb === 'press') await p.keyboard.press(arg)
        else if (verb === 'type') await p.keyboard.type(arg)
        else if (verb === 'click') await p.click(arg, { timeout: 5000 })
        else if (verb === 'wait') await p.waitForTimeout(Number(arg) || 200)
        else if (verb === 'move') { const [x, y] = arg.split(/\s+/).map(Number); await p.mouse.move(x, y) }
        else if (verb === 'clickat') { const [x, y] = arg.split(/\s+/).map(Number); await p.mouse.click(x, y) }
        else if (verb === 'eval') await p.evaluate(new Function(arg) as () => unknown)
        else throw new Error(`ui --do: unknown step "${verb}" (press, type, click, clickat, move, wait, eval)`)
      }
      if (body.do) await p.waitForTimeout(250)
      const out = String(body.out)
      fs.mkdirSync(path.dirname(out), { recursive: true })
      await p.screenshot({ path: out })
      return { out }
    }
    case '/errors': {
      const p = await openOn(String(body.project))
      return { errors: await codeErrors(p), console: consoleLog.slice(-50) }
    }
    case '/eval': {
      const p = body.project ? await sync(String(body.project)) : await ensurePage()
      return { result: await p.evaluate(new Function(`return (async () => { ${String(body.js)} })()`) as () => Promise<unknown>) }
    }
    case '/reload': {
      if (page) await page.close()
      page = null
      openProject = null
      return { ok: true }
    }
    case '/stop':
      setTimeout(() => shutdown(0), 50)
      return { ok: true }
    default:
      throw new Error(`unknown endpoint ${url}`)
  }
}

async function shutdown(code: number) {
  try { await browser?.close() } catch { /* already gone */ }
  try { fs.unlinkSync(DAEMON_STATE) } catch { /* not there */ }
  process.exit(code)
}

const server = http.createServer((req, res) => {
  let raw = ''
  req.on('data', (c) => { raw += c })
  req.on('end', async () => {
    try {
      const body = raw ? (JSON.parse(raw) as Json) : {}
      const result = await route(req.url ?? '/', body)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(result))
    } catch (e) {
      log('error', (e as Error).message)
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: (e as Error).message, console: consoleLog.slice(-20) }))
    }
  })
})
server.timeout = 0
server.requestTimeout = 0

server.listen(0, '127.0.0.1', () => {
  const port = (server.address() as { port: number }).port
  fs.writeFileSync(DAEMON_STATE, JSON.stringify({ pid: process.pid, port, devUrl, startedAt: new Date().toISOString() }, null, 2))
  log(`cabin daemon on 127.0.0.1:${port} (dev ${devUrl})`)
})

setInterval(() => {
  if (!progress && Date.now() - lastUse > IDLE_MS) {
    log('idle - exiting')
    void shutdown(0)
  }
}, 60_000)

process.on('SIGTERM', () => void shutdown(0))
process.on('SIGINT', () => void shutdown(0))
