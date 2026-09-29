/** One job per quiet interval. Cancellation returns the job to the tail so an
 * expensive/broken project cannot starve the rest. No forced idle deadlines. */
export class PreviewBackfillQueue<T> {
  private pending: T[]
  private active?: AbortController
  private nextAt: number
  private stopped = false
  constructor(items: T[], now: number, private run: (item: T, signal: AbortSignal) => Promise<void>, private clock = Date.now) {
    this.pending = [...items]
    this.nextAt = now + 15_000
  }
  enqueue(item: T) { if (!this.stopped) this.pending.push(item) }
  interrupt(now: number) {
    this.nextAt = now + 15_000
    this.active?.abort()
  }
  stop() { this.stopped = true; this.active?.abort() }
  async tick(now: number, allowed: boolean, idleBudget: number) {
    if (this.stopped || this.active || !allowed || now < this.nextAt || idleBudget < 10) return
    const item = this.pending.shift()
    if (item === undefined) return
    const controller = new AbortController()
    this.active = controller
    const startedAt = this.clock()
    try { await this.run(item, controller.signal) }
    catch { /* Failed jobs retry on a future visit, never in a hot loop. */ }
    finally {
      if (controller.signal.aborted && !this.stopped) this.pending.push(item)
      this.active = undefined
      // Long jobs buy proportionally more silence (at most ~5% wall-time
      // duty cycle), including failures that exhausted the worker budget.
      const finishedAt = this.clock()
      this.nextAt = Math.max(this.nextAt, finishedAt + Math.max(30_000, (finishedAt - startedAt) * 20))
    }
  }
}
