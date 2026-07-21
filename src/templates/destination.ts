// Where a freshly created project from a template should land.
//
// The Lyric Video template opens its setup pipeline (its own /lyric-setup
// route: drop a song → transcribe → align) instead of a silent editor. Shared
// rather than duplicated so the projects page and the first-run template screen
// can't drift apart about it.
export const projectDestination = (templateId: string, projectId: string) =>
  templateId === 'lyricVideo' ? `/lyric-setup?project=${projectId}` : `/editor?project=${projectId}`
