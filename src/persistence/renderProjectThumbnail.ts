import { getSupabase } from './supabase'
import { cacheProjectThumbnail, withCachedThumbnail } from './projectThumbnailCache'
import type { ProjectSummary } from './projectStorage'
import type { PreviewWorkerMessage } from '../editor/core/visual/previewProtocol'

/** Never consumes editor preloads, hydrates live stores, or writes the document. */
export async function populateProjectThumbnail(owner: string, project: ProjectSummary, signal: AbortSignal) {
  if (signal.aborted || withCachedThumbnail(owner, project).preview?.image) return
  const fetchSignal = AbortSignal.any([signal, AbortSignal.timeout(10_000)])
  const { data, error } = await getSupabase().from('projects').select('data, rev')
    .eq('id', project.id).abortSignal(fetchSignal).maybeSingle()
  if (error) throw error
  if (!data || signal.aborted) return
  if (data.data?.thumbnail) {
    await cacheProjectThumbnail(owner, project.id, data.rev, data.data.thumbnail)
    return
  }
  const image = await new Promise<string>((resolve, reject) => {
    const worker = new Worker(new URL('../editor/core/visual/preview.worker.ts', import.meta.url), { type: 'module' })
    const timeout = setTimeout(() => finish(new Error('Thumbnail budget exhausted')), 8_000)
    function finish(error?: Error, image?: string) {
      clearTimeout(timeout)
      signal.removeEventListener('abort', abort)
      worker.terminate()
      if (error) reject(error)
      else resolve(image!)
    }
    const abort = () => finish(new DOMException('Interrupted', 'AbortError'))
    signal.addEventListener('abort', abort, { once: true })
    worker.onerror = () => finish(new Error('Thumbnail worker failed'))
    worker.onmessage = (event: MessageEvent<PreviewWorkerMessage | { kind: 'thumbnail'; image?: string; error?: string }>) => {
      const message = event.data
      if ('kind' in message && message.kind === 'thumbnail') {
        finish(message.image ? undefined : new Error(message.error ?? 'Thumbnail unavailable'), message.image)
      } else if ('kind' in message && (message.kind === 'media' || message.kind === 'waveform')) {
        // Decoding can fetch an entire song/video. Never cache a partial still.
        finish(new Error('Media-backed previews require an editor capture'))
      }
    }
    if (signal.aborted) abort()
    else {
      try { worker.postMessage({ kind: 'thumbnail', document: data.data }) }
      catch (error) { finish(error instanceof Error ? error : new Error(String(error))) }
    }
  })
  if (!signal.aborted) await cacheProjectThumbnail(owner, project.id, data.rev, image)
}
