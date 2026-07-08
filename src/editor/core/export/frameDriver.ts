// The seam between the export engine (plain module code) and the R3F canvas
// (React world). ExportDriver - mounted inside <Canvas> - registers itself
// here; the engine pulls frames through the interface without ever importing
// a component. One canvas, one driver: the visual engine is a singleton, so
// export borrows the live canvas rather than spinning up a second one.

export interface FrameDriver {
  /** Render exactly one frame at `beat` - the same setCurrentBeat → computeAtBeat
   *  path scrubbing takes, then a single R3F advance(). Synchronous: when this
   *  returns, the canvas holds the frame. */
  renderFrame(beat: number, timeMs: number): void
  /** Freeze the render loop and pin the canvas to the export resolution (DPR 1). */
  pin(width: number, height: number): void
  /** Restore frameloop, size, and DPR exactly as they were. Safe to call twice. */
  unpin(): void
  /** The live WebGL canvas - what VideoFrame captures from. */
  getCanvas(): HTMLCanvasElement
}

let driver: FrameDriver | null = null

export function registerFrameDriver(d: FrameDriver | null): void {
  driver = d
}

export function getFrameDriver(): FrameDriver | null {
  return driver
}
