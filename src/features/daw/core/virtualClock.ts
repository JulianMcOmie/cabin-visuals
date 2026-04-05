// Virtual Clock — drop-in replacement for performance.now()
// During normal playback: returns performance.now()
// During export: returns a controlled virtual time set by the export engine

let exportTimeMs: number | null = null;

export const virtualClock = {
  /** Returns performance.now() normally, or the virtual time during export */
  now(): number {
    return exportTimeMs !== null ? exportTimeMs : performance.now();
  },

  /** Set the virtual export time in milliseconds, or null to return to real time */
  setExportTime(ms: number | null): void {
    exportTimeMs = ms;
  },

  /** Returns true if currently in export mode */
  isExporting(): boolean {
    return exportTimeMs !== null;
  },
};
