// Independent of editor imports: the projects page must never load the DAW.
let editorBusy = true
let editorMounted = false
const listeners = new Set<() => void>()
export function setPreviewBackfillEditor(mounted: boolean, busy = true) {
  editorMounted = mounted
  editorBusy = busy
  listeners.forEach(listener => listener())
}
export function previewBackfillBlockedInEditor() { return !editorMounted || editorBusy }
export function subscribePreviewBackfillActivity(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
