/**
 * The dev escape hatch for the account gates.
 *
 * Signed out, `EditorSignupGate` walls off the whole editor and ExportDialog's
 * own gate stands in front of Export - which between them make `/editor`
 * un-previewable on a dev server without first logging in. With this on, both
 * stand down so a dev server shows the real editor.
 *
 * `npm run build` never turns it on: Next inlines NODE_ENV as a literal, so the
 * whole branch is dead code in a production bundle and no deploy setting can
 * revive it. Set `NEXT_PUBLIC_EDITOR_GATE=on` in `.env.local` to face the real
 * gates in dev - the only way to work on the cards themselves.
 *
 * It is deliberately NOT wired into `permanent` in App.tsx: everything else
 * that reads the account (the Save-to-cloud chip, the plan tier) keeps telling
 * the truth in dev, so only the two doors move.
 */
export const DEV_GATES_OFF =
  process.env.NODE_ENV === 'development' && process.env.NEXT_PUBLIC_EDITOR_GATE !== 'on'
