/** One job in flight and one replaceable request. Capture/clone inputs only when
 * dispatched, never in the editor's store/pointer callback. No trailing debounce:
 * continuous edits still produce frames, and the final edit cannot be lost. */
export class LatestPreview {
  private dirty = false
  private busy = false
  private disposed = false
  private timer: ReturnType<typeof setTimeout> | undefined
  constructor(private readonly run: () => Promise<void>, private readonly delay = () => 0, private readonly onError = (error: unknown) => { console.error(error) }) {}
  request() {
    if (this.disposed) return
    this.dirty = true
    this.schedule()
  }
  private schedule() {
    if (this.disposed || this.busy || !this.dirty || this.timer !== undefined) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      if (this.disposed) return
      this.dirty = false
      this.busy = true
      void this.run().catch(this.onError).finally(() => {
        this.busy = false
        this.schedule()
      })
    }, this.delay())
  }
  dispose() { this.disposed = true; this.dirty = false; clearTimeout(this.timer) }
}
