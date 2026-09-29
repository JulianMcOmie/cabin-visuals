import { useProjectStore } from '../store/ProjectStore'
import { useUIStore } from '../store/UIStore'
import { useTimeStore } from '../store/TimeStore'
import { useHistoryStore } from '../store/HistoryStore'
import { getPlaybackEngine } from '../core/playback'
import { useCommentsStore } from '../review/commentsStore'
import { useReviewStore } from '../review/ReviewBar'

// The editor's commands: ONE list behind the ⌘K palette and the cabin CLI
// (`cabin commands` / `cabin cmd <id> key=value`, through window.__cabinCommands).
// A command is a title, optional arguments, and a run() over the stores - so a
// new capability added here is reachable by both of you at once. Dynamic
// entries (go to each section, show each scene) are generated per call.

export interface CommandArg { name: string; hint: string; optional?: boolean }

export interface EditorCommand {
  id: string
  title: string
  group: 'Transport' | 'View' | 'Scenes' | 'Tracks' | 'Sections' | 'Review' | 'Edit'
  keywords?: string
  /** Shown by `cabin commands`; the palette runs commands without args, or with their defaults. */
  args?: CommandArg[]
  run(args: Record<string, unknown>): unknown
}

// play/pause live in a hook (usePlayback); the editor hands them in here.
let transport: { play(): void; pause(): void } | null = null
export function provideTransport(t: { play(): void; pause(): void } | null) { transport = t }

function seek(beat: number) {
  useTimeStore.getState().setCurrentBeat(Math.max(0, beat))
  if (useTimeStore.getState().isPlaying) getPlaybackEngine().seek(Math.max(0, beat))
}

function sceneByName(name: unknown): string {
  const { scenes, sceneOrder } = useProjectStore.getState()
  const id = sceneOrder.find((sid) => sid === name || scenes[sid]?.name.toLowerCase() === String(name).toLowerCase())
  if (!id) throw new Error(`no scene "${name}"`)
  return id
}

function trackByPath(path: unknown): { sceneId: string; trackId: string } {
  const s = String(path)
  const slash = s.indexOf('/')
  const { scenes, sceneOrder } = useProjectStore.getState()
  for (const sid of sceneOrder) {
    const scene = scenes[sid]
    if (!scene || (slash > 0 && scene.name.toLowerCase() !== s.slice(0, slash).toLowerCase())) continue
    const name = (slash > 0 ? s.slice(slash + 1) : s).toLowerCase()
    const t = Object.values(scene.tracks).find((x) => x.id === s || x.name.toLowerCase() === name)
    if (t) return { sceneId: sid, trackId: t.id }
  }
  throw new Error(`no track "${s}"`)
}

const STATIC: EditorCommand[] = [
  { id: 'transport.play', title: 'Play / pause', group: 'Transport', keywords: 'space start stop', run: () => {
    if (!transport) throw new Error('transport not ready')
    if (useTimeStore.getState().isPlaying) transport.pause(); else transport.play()
  } },
  { id: 'transport.start', title: 'Go to start', group: 'Transport', run: () => seek(0) },
  { id: 'transport.seek', title: 'Go to bar…', group: 'Transport', args: [{ name: 'bar', hint: 'bar number (0-based, fractional ok)' }], run: (a) => {
    const bar = Number(a.bar ?? 0)
    seek(bar * useProjectStore.getState().beatsPerBar)
  } },
  { id: 'view.composite', title: 'Canvas: show the Composite', group: 'View', run: () => useUIStore.getState().setCanvasView('main') },
  { id: 'view.current', title: 'Canvas: show the current scene', group: 'View', run: () => useUIStore.getState().setCanvasView('scene') },
  { id: 'scene.show', title: 'Show scene…', group: 'Scenes', args: [{ name: 'scene', hint: 'scene name' }], run: (a) => {
    useProjectStore.getState().setActiveScene(sceneByName(a.scene))
    useUIStore.getState().setCanvasView('scene')
  } },
  { id: 'scene.add', title: 'New scene', group: 'Scenes', run: () => useProjectStore.getState().addScene() },
  { id: 'track.select', title: 'Select track…', group: 'Tracks', args: [{ name: 'track', hint: 'Scene/Track or track name' }], run: (a) => {
    const { sceneId, trackId } = trackByPath(a.track)
    if (useProjectStore.getState().activeSceneId !== sceneId) useProjectStore.getState().setActiveScene(sceneId)
    useUIStore.getState().setSelectedTrackId(trackId)
    useUIStore.getState().revealTrack(trackId)
  } },
  { id: 'track.mute', title: 'Mute / unmute selected track', group: 'Tracks', args: [{ name: 'track', hint: 'Scene/Track (default: selected)', optional: true }], run: (a) => {
    const id = a.track ? trackByPath(a.track).trackId : useUIStore.getState().selectedTrackId
    if (id) useProjectStore.getState().toggleMute(id)
  } },
  { id: 'track.solo', title: 'Solo / unsolo selected track', group: 'Tracks', args: [{ name: 'track', hint: 'Scene/Track (default: selected)', optional: true }], run: (a) => {
    const id = a.track ? trackByPath(a.track).trackId : useUIStore.getState().selectedTrackId
    if (id) useProjectStore.getState().toggleSolo(id)
  } },
  { id: 'section.add', title: 'Add a section here…', group: 'Sections', args: [{ name: 'name', hint: 'section name' }, { name: 'bars', hint: 'length in bars (default 8)', optional: true }], run: (a) => {
    const { beatsPerBar, addMarker } = useProjectStore.getState()
    const from = Math.floor(useTimeStore.getState().currentBeat / beatsPerBar)
    return addMarker({ name: String(a.name ?? 'section'), from, to: from + Number(a.bars ?? 8) })
  } },
  { id: 'comments.open', title: 'Comments: open the panel', group: 'Review', keywords: 'review notes', run: () => useCommentsStore.getState().setPanelOpen(true) },
  { id: 'comments.toggle', title: 'Comments: open / close the panel', group: 'Review', keywords: 'review notes', run: () => {
    const s = useCommentsStore.getState(); s.setPanelOpen(!s.panelOpen)
  } },
  { id: 'comments.mode', title: 'Comments: pin mode (click a lane or the canvas)', group: 'Review', run: () => {
    const s = useCommentsStore.getState(); s.setMode(!s.mode)
  } },
  { id: 'comments.here', title: 'Comments: pin one at the playhead', group: 'Review', run: () => {
    useCommentsStore.getState().openComposer({ beat: useTimeStore.getState().currentBeat, trackId: useUIStore.getState().selectedTrackId ?? undefined, x: window.innerWidth / 2, y: window.innerHeight * 0.45 })
  } },
  { id: 'review.show', title: "Review: highlight Claude's last change", group: 'Review', run: () => useReviewStore.getState().setHighlight(true) },
  { id: 'edit.undo', title: 'Undo', group: 'Edit', run: () => useHistoryStore.getState().undo() },
  { id: 'edit.redo', title: 'Redo', group: 'Edit', run: () => useHistoryStore.getState().redo() },
]

function dynamic(): EditorCommand[] {
  const { markers, beatsPerBar, scenes, sceneOrder } = useProjectStore.getState()
  const out: EditorCommand[] = markers.map((m) => ({
    id: `section.go.${m.name}`, title: `Go to ${m.name} (bar ${m.from})`, group: 'Sections' as const, keywords: 'section marker jump',
    run: () => seek(m.from * beatsPerBar),
  }))
  for (const sid of sceneOrder) {
    const s = scenes[sid]
    if (!s || s.isMain) continue
    out.push({ id: `scene.show.${s.name}`, title: `Show scene ${s.name}`, group: 'Scenes', run: () => { useProjectStore.getState().setActiveScene(sid); useUIStore.getState().setCanvasView('scene') } })
  }
  return out
}

export function listCommands(): EditorCommand[] {
  return [...STATIC, ...dynamic()]
}

export async function runCommand(id: string, args: Record<string, unknown> = {}): Promise<unknown> {
  const cmd = listCommands().find((c) => c.id === id)
  if (!cmd) throw new Error(`no command "${id}" (cabin commands lists them)`)
  for (const a of cmd.args ?? []) if (!a.optional && args[a.name] === undefined) throw new Error(`${id} needs ${a.name} (${a.hint})`)
  return cmd.run(args)
}

declare global {
  interface Window {
    __cabinCommands?: { list(): Array<{ id: string; title: string; args?: string }>; run(id: string, args?: Record<string, unknown>): Promise<unknown> }
  }
}

if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  window.__cabinCommands = {
    list: () => listCommands().map((c) => ({ id: c.id, title: c.title, args: c.args?.map((a) => `${a.name}${a.optional ? '?' : ''}: ${a.hint}`).join(', ') })),
    run: runCommand,
  }
}
