// Where a freshly created project from a template should land.
//
// The Lyric Video template opens its setup pipeline (its own /lyric-setup
// route: drop a song → transcribe → align) instead of a silent editor; the
// photo-slot templates (Crazy Edit) open the optional add-your-photos step;
// Midi Roll opens the add-your-MIDI-and-song step. Shared rather than
// duplicated so the projects page and the first-run template screen can't
// drift apart about it.
export const projectDestination = (templateId: string, projectId: string) =>
  templateId === 'lyricVideo'
    ? `/lyric-setup?project=${projectId}`
    : templateId === 'crazyedit'
      ? `/photo-setup?project=${projectId}`
      : templateId === 'midiRoll'
        ? `/midi-setup?project=${projectId}`
        : `/editor?project=${projectId}`
