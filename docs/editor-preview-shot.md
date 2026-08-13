# Recapturing the landing page's editor screenshot

`public/editor-preview.webp` is the product shot on the landing page
(`src/components/landing/LandingEditorial.tsx`). It is a real screenshot of
`/editor`, not a drawing — so it goes stale whenever the editor's chrome
changes, and it has to be retaken rather than edited.

The shot: **2560×1294 WebP q88** (~190 KB), captured at 1600×1000 CSS @2x and
cropped just under the last timeline row.

## The recipe

Run a dev server (`npm run dev`), then drive it with Playwright — `playwright`
is already a devDependency, and the editor needs no login or Supabase env at
`/editor?template=<id>`.

```js
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 })
await page.goto('http://localhost:3000/editor?template=wormhole')
```

Five things have to happen before the shutter, each of which cost a take:

1. **Launch chromium with software WebGL** — `--enable-unsafe-swiftshader
   --use-angle=swiftshader`. Without it the preview renders black and the shot
   looks like a broken canvas.
2. **Select an instrument track**, or the inspector shows the near-empty Scene
   panel instead of parameters. Clicking the track NAME does not select — the
   handler is on the row, so dispatch the mouse events at the row element.
   Clicking the row's CLIP selects the clip instead, which lights it with a
   full-width bloom that swamps the timeline.
3. **Move the playhead onto a beat where a lyric word is settled** (~14% across
   the ruler on the Wormhole template). Mid-transition the word is a solid blue
   rectangle: headless bakes the word canvas while it is still zooming, and it
   reads as a rendering fault.
4. **Force a render** with `window.__three.advance(performance.now(), true)`
   after every change — rAF does not run reliably in a headless/hidden page, so
   the canvas otherwise shows the pre-edit frame or nothing at all.
5. **Hide the demo-session chrome**: the "Not saved · sign up to save" and
   "Demo project · sign up to save it" nags in the top bar read as a warning on
   a marketing page. Hide the whole group, not just the link. Remove
   `<nextjs-portal>` too so the dev indicator can't appear.

Then crop to the bottom of the last track row (the timeline tail below it is
dead black), and encode with sharp: `.resize({width:2560}).webp({quality:88})`.
q88 keeps the 11px inspector labels crisp; sips cannot write WebP.

The working script is in the branch that introduced this file
(`claude/landing-page-color-mockups-6d20d0`), as `hero.mjs`.
