# projects/

On-disk Cabin projects for the `cabin` CLI (`./cabin help`, guide: `tools/cabin/CLAUDE.md`).
Everything in here except this README is gitignored: projects carry songs and renders.

    projects/<name>/
      project.json   the Cabin document - open it live in the dev editor at /editor?file=<name>
      cabin.json     CLI metadata: sections, the song file, the analysis file, notes for the next session
      audio/         media the document references (served by app/api/dev/projects/.../files)
      analysis/      cabin analyze: analysis.json, analysis.mid, Demucs stems
      renders/       shots, clips and renders
