import type { CommandGroup } from '../lib/command'
import { open, timeCtx } from '../lib/common'
import { parsePosition } from '../lib/time'

export const renderCommands: CommandGroup = {
  title: 'RENDER + LOOK',
  note: 'a headless Chrome daemon on your dev server (starts on demand): what you see is what export encodes',
  commands: [
    {
      name: 'shot', usage: '<name> --at 28,32.5,b120,45s,@drop [--view main|<scene>] [--w 960 --h 540] [--sheet] [--out dir]',
      summary: 'stills (+ one contact sheet, tiles labelled bar · beat)',
      async run(a) {
        const { shot } = await import('../lib/render')
        return shot(open(a.need('project name')), a)
      },
    },
    {
      name: 'strip', usage: '<name> --around <pos> [--span 1] [--frames 12] [--view ...] [--w 640 --h 360]',
      summary: 'a labelled strip of frames around a moment (span in bars) - how a transition or hit moves',
      async run(a) {
        const around = a.opt('around'), span = a.num('span', 1), frames = Math.max(2, Math.round(a.num('frames', 12)))
        if (!around) throw new Error('strip needs --around <pos>')
        const p = open(a.need('project name'))
        const c = parsePosition(around, timeCtx(p))
        const half = (span * p.beatsPerBar) / 2
        const beats = Array.from({ length: frames }, (_, i) => c - half + (2 * half * i) / (frames - 1))
        a.rest.push('--at', beats.map((b) => `b${b.toFixed(4)}`).join(','), '--sheet')
        if (!a.rest.includes('--w')) a.rest.push('--w', '640', '--h', '360')
        const { shot } = await import('../lib/render')
        return shot(p, a)
      },
    },
    {
      name: 'clip', usage: '<name> --range 28-32 [--fps 30] [--w 960 --h 540] [--mb 1] [--view main] [--no-audio] [--out f.mp4]', summary: 'a quick motion check with audio',
      async run(a) {
        const { clip } = await import('../lib/render')
        return clip(open(a.need('project name')), a, false)
      },
    },
    {
      name: 'render', usage: '<name> [--range ...] [--w 1920 --h 1080] [--fps 60] [--mb 3] [--vt] [--crf 18] [--out f.mp4]', summary: 'the full-quality video (motion blur by subframe averaging)',
      async run(a) {
        const { clip } = await import('../lib/render')
        return clip(open(a.need('project name')), a, true)
      },
    },
    {
      name: 'audit', usage: '<name> [--range ...] [--fps 4] [--strips] [--json]',
      summary: 'scan every frame for black, blown-out, noisy or frozen stretches; per-section look stats',
      async run(a) {
        const { audit } = await import('../lib/audit')
        return audit(open(a.need('project name')), a)
      },
    },
    {
      name: 'errors', usage: '<name>', summary: 'code-instrument errors + page console',
      async run(a) {
        const { errors } = await import('../lib/render')
        return errors(a.need('project name'))
      },
    },
    {
      name: 'ui', usage: '<name> [--at <pos>] [--select Scene/Track] [--comments] [--do "press c; type hi; click sel"] [--out f.png]',
      summary: 'a screenshot of the editor itself (timeline, panels), optionally after scripted input - for checking UI work',
      details: '--do steps (;-separated): press <key> · type <text> · click <css> · clickat <x> <y> · move <x> <y> · wait <ms> · eval <js>',
      async run(a) {
        const { uiShot } = await import('../lib/render')
        return uiShot(open(a.need('project name')), a)
      },
    },
    {
      name: 'daemon', usage: 'status|stop|restart', summary: 'the headless render page',
      async run(a) {
        const { daemon } = await import('../lib/render')
        return daemon(a.next() ?? 'status')
      },
    },
    {
      name: 'config', usage: 'dev-url [url]', summary: 'which dev server the daemon drives',
      async run(a) {
        const { setDevUrl, devUrl } = await import('../lib/client')
        if (a.next() === 'dev-url') {
          const v = a.next()
          if (v) setDevUrl(v)
        }
        console.log(`dev-url = ${devUrl()}`)
      },
    },
  ],
}
