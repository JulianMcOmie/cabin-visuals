export type PreviewMediaKind = 'video' | 'photo'
export type PreviewMediaSource = Blob | string
let resolver: ((kind: PreviewMediaKind, ref: string) => Promise<PreviewMediaSource>) | undefined
/** Installed only in the worker. Authentication and session File ownership stay
 * on the editor thread; decoding and rasterization stay with the worker renderer. */
export function setPreviewMediaResolver(value: typeof resolver) { resolver = value }
export function requestPreviewMedia(kind: PreviewMediaKind, ref: string) { return resolver?.(kind, ref) }
