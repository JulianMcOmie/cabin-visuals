import type { CommandGroup } from '../lib/command'
import { open, resolveTrack } from '../lib/common'
import { UsageError } from '../lib/args'
import type { Cabin } from '../lib/api'

// The live editor as an API: anything the editor's stores can do, the CLI can
// ask it to do (the daemon's page runs it; file sync writes the result back to
// project.json). `cabin act` calls a ProjectStore action directly; `cabin cmd`
// runs one of the editor's palette commands (the same list ⌘K shows you).

/** `@Scene/Track` → track id (and the scene to activate), `@@Scene` → scene id, JSON, else a string. */
function parseArg(p: Cabin, raw: string, activate: { sceneId?: string }): unknown {
  if (raw.startsWith('@@')) {
    const s = p.scene(raw.slice(2), { create: false })
    activate.sceneId ??= s.id
    return s.id
  }
  if (raw.startsWith('@')) {
    const t = resolveTrack(p, raw.slice(1))
    activate.sceneId ??= t.scene.id
    return t.id
  }
  try { return JSON.parse(raw) } catch { return raw }
}

async function waitForWrite(project: string, before: string | null, ms = 4000) {
  const { devUrl } = await import('../lib/client')
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 150))
    try {
      const r = await fetch(`${devUrl()}/api/dev/projects/${encodeURIComponent(project)}?versionOnly=1`)
      const { version } = (await r.json()) as { version: string }
      if (version !== before) return true
    } catch { /* retry */ }
  }
  return false
}

async function fileVersion(project: string): Promise<string | null> {
  const { devUrl } = await import('../lib/client')
  try {
    const r = await fetch(`${devUrl()}/api/dev/projects/${encodeURIComponent(project)}?versionOnly=1`)
    return ((await r.json()) as { version: string }).version
  } catch { return null }
}

async function inPage<T>(project: string, js: string): Promise<T> {
  const { call, ensureDaemon } = await import('../lib/client')
  await ensureDaemon()
  const res = await call<{ result: T }>('/eval', { project, js })
  return res.result
}

export const liveCommands: CommandGroup = {
  title: 'LIVE EDITOR',
  note: 'drive the open editor (via the daemon page); results save back to project.json',
  commands: [
    {
      name: 'page', usage: '<name> "<js>"',
      summary: 'evaluate JavaScript in the live editor page and print the result',
      details: 'an expression, or statements with `return`; async is fine. Handy globals: __cabinStores, __previewRuntime, __cabinCommands, __three',
      async run(a) {
        const name = a.need('project name')
        const js = a.need('javascript')
        // an expression first; statements (with their own return) if that doesn't parse
        let result: unknown
        try {
          result = await inPage<unknown>(name, `return (${js}\n)`)
        } catch (err) {
          if (!/Unexpected|SyntaxError|missing|Invalid/i.test((err as Error).message)) throw err
          result = await inPage<unknown>(name, js)
        }
        console.log(typeof result === 'string' ? result : JSON.stringify(result, null, 1))
      },
    },
    {
      name: 'actions', usage: '[filter]', summary: 'every editor store action with its signature (generated from source)',
      async run(a) {
        const filter = a.next()?.toLowerCase()
        const { interfaceMembers } = await import('../lib/tsdoc')
        const members = interfaceMembers('src/editor/store/ProjectStore.ts', 'ProjectState', true)
        for (const m of members) {
          if (filter && !m.name.toLowerCase().includes(filter) && !m.doc.toLowerCase().includes(filter)) continue
          console.log(`${m.signature}${m.doc ? `\n    ${m.doc.split('\n')[0]}` : ''}`)
        }
      },
    },
    {
      name: 'act', usage: '<name> <action> [args...]', summary: 'call an editor store action in the live editor (args: JSON, @Scene/Track, @@Scene)',
      details: 'e.g. cabin act song addEffect @Signal/Orb \'"bloom"\'   ·   cabin act song addSceneEffect @@Plate \'"filmGrain"\'\nTrack args activate their scene first (store actions work on the active scene).',
      async run(a) {
        const p = open(a.need('project name'))
        const action = a.need('action')
        const activate: { sceneId?: string } = {}
        const args = a.rest.splice(0).map((r) => parseArg(p, r, activate))
        const before = await fileVersion(p.name)
        const result = await inPage<unknown>(p.name, `
          const S = window.__cabinStores?.project
          if (!S) throw new Error('window.__cabinStores missing (dev build only)')
          ${activate.sceneId ? `S.getState().setActiveScene(${JSON.stringify(activate.sceneId)})` : ''}
          const fn = S.getState()[${JSON.stringify(action)}]
          if (typeof fn !== 'function') throw new Error('no store action ' + ${JSON.stringify(action)} + ' (cabin actions lists them)')
          const out = fn(...${JSON.stringify(args)})
          return out instanceof Set ? [...out] : out ?? null`)
        const saved = await waitForWrite(p.name, before)
        console.log(`${action} → ${JSON.stringify(result)}${saved ? '' : '  (no change reached project.json - was it a no-op?)'}`)
      },
    },
    {
      name: 'commands', usage: '<name> [filter]', summary: 'the editor palette commands (what ⌘K offers) with their arguments',
      async run(a) {
        const name = a.need('project name')
        const filter = a.next()
        const list = await inPage<Array<{ id: string; title: string; args?: string }>>(name, `return window.__cabinCommands?.list() ?? []`)
        for (const c of list) if (!filter || c.id.includes(filter) || c.title.toLowerCase().includes(filter.toLowerCase())) console.log(`${c.id.padEnd(28)} ${c.title}${c.args ? `  (${c.args})` : ''}`)
      },
    },
    {
      name: 'cmd', usage: '<name> <command-id> [key=value ...]', summary: 'run an editor palette command in the live editor',
      async run(a) {
        const name = a.need('project name')
        const id = a.need('command id')
        const args: Record<string, unknown> = {}
        for (const kv of a.rest.splice(0)) {
          const eq = kv.indexOf('=')
          if (eq < 1) throw new UsageError(`expected key=value, got "${kv}"`)
          const v = kv.slice(eq + 1)
          try { args[kv.slice(0, eq)] = JSON.parse(v) } catch { args[kv.slice(0, eq)] = v }
        }
        const before = await fileVersion(name)
        const result = await inPage<unknown>(name, `
          if (!window.__cabinCommands) throw new Error('window.__cabinCommands missing (dev build only)')
          return (await window.__cabinCommands.run(${JSON.stringify(id)}, ${JSON.stringify(args)})) ?? null`)
        await waitForWrite(name, before, 1500)
        console.log(`${id} → ${JSON.stringify(result)}`)
      },
    },
  ],
}
