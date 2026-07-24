# Social upload APIs: in-app publishing vs. personal automation

Research date: 2026-07-24. These APIs change often — every load-bearing claim below is cited with a URL; re-verify before building.

Two scenarios:

- **A) In-app**: cabin-visuals users click "Publish to TikTok/Reels/Shorts" after export.
- **B) Personal**: Julia posts her own daily marketing videos to her own accounts from a CLI, no browser.

## Verdict table

| Platform | A) In-app (users publish from cabin-visuals) | B) Personal automation (Julia's own accounts) |
|---|---|---|
| **TikTok** | **Feasible after audit.** Unaudited apps: posts locked to SELF_ONLY, max 5 posting users/24h, *and* the user's account must be private at post time. Audit reportedly ~1–2 weeks for a clean pass. Not worth shipping pre-audit. | **Don't use the official API solo** — the unaudited restrictions (private account, SELF_ONLY) make it useless for real posting, and auditing a personal app is overkill. Use a third-party posting API (their app is already audited). |
| **Instagram Reels** | **Feasible after review, with real friction.** "Instagram API with Instagram Login" (2024+) works without a Facebook Page, but needs App Review (2–4 wks) + business verification to serve other users, video must be on a **public HTTPS URL** Meta can cURL, and users need professional (Business) accounts. | **Feasible free-ish today**: your own account added as an app Tester works in Development Mode without App Review. Or route through a third-party API. Account must be professional (Creator/Business); publishing docs say "professional accounts". |
| **YouTube Shorts** | **Feasible-ish, best of the three — but audit still required.** `videos.insert` now costs ~100 units (was ~1600, changed 2025-12-04), so default 10k quota ≈ 100 uploads/day. BUT uploads from unaudited API projects (created after 2020-07-28) are **locked private** until the project passes a compliance audit. | **Easiest official path.** Own Google Cloud project + OAuth + a 50-line script uploads fine; submit the API audit form once to unlock public visibility (solo devs do get approved). Zero cost. |
| **Overall** | Ship a "Download MP4 + open TikTok" flow first; pursue TikTok audit + Meta App Review only if users demand one-click publish. Realistic timeline to all three approved: 1–2 months of paperwork. | **Recommended stack below**: YouTube direct (free) + Buffer's new API (free tier) or upload-post.com (~$33/mo) for TikTok+Reels. ~$0–33/month total. |

---

## Scenario A: In-app publishing for users

### TikTok — Content Posting API

**How it works.** OAuth the user with scopes `video.publish` (direct post) and/or `video.upload` (send to user's inbox/drafts, user finishes in the TikTok app). Two transfer modes: `FILE_UPLOAD` (chunked PUT to TikTok) or `PULL_FROM_URL` (TikTok pulls from a URL on a **domain you've verified** in the developer portal). Source: [TikTok Content Posting API — Get Started](https://developers.tiktok.com/doc/content-posting-api-get-started) (fetched 2026-07-24).

**Unaudited-client restrictions (the killer):**
- Every post is forced to `SELF_ONLY` visibility — only the creator sees it.
- Max **5 users may post in any 24-hour window** through an unaudited client.
- The posting user's **account must be set to private at time of posting**; to make content public later the user must flip their account public and then edit each video's privacy to "Everyone" by hand.
- Sources: [TikTok Content Sharing Guidelines](https://developers.tiktok.com/doc/content-sharing-guidelines) and [Direct Post reference](https://developers.tiktok.com/doc/content-posting-api-reference-direct-post) (fetched 2026-07-24).

**The audit.** Needed materials: privacy policy URL, end-to-end demo video of OAuth + upload, data-handling description. Community reports in 2026 put a clean first pass at ~1–2 weeks; common rejections are broken demos, missing scope coverage, and not answering TikTok's follow-up emails. Source: [PostPeer — TikTok Content Posting API in 2026](https://www.postpeer.dev/blog/best-tiktok-posting-api), [Postproxy TikTok guide](https://postproxy.dev/blog/how-to-post-to-tiktok-via-api/) (both 2026).

**Verdict:** *Feasible after review.* Small indie apps do pass the audit — it's paperwork, not a partnership program. But do NOT ship the button before the audit: "publishes as a private post and your account must be private" is a support-ticket generator. The `video.upload` → drafts/inbox flow (user opens TikTok, caption is pre-filled, they hit post) is the friendliest UX anyway and keeps TikTok's native editor in the loop.

### Instagram Reels — Instagram Platform API

**Two auth paths** ([Meta content-publishing docs](https://developers.facebook.com/docs/instagram-platform/content-publishing), fetched 2026-07-24):
1. **Instagram API with Instagram Login** (launched July 2024) — user logs in with their Instagram credentials, no Facebook Page needed. Scopes: `instagram_business_basic`, `instagram_business_content_publish` (the old `instagram_basic`/`instagram_content_publish` scopes were deprecated 2025-01-27). Calls go to `graph.instagram.com`.
2. **Facebook Login for Business** (older Graph API path) — needs a Facebook Page linked to the IG account, plus `pages_read_engagement` etc.

**Hard requirements:**
- Account must be an Instagram **professional account**. Meta's publishing docs say professional; several 2026 third-party writeups report Creator accounts are flaky/unsupported for publishing and recommend Business ([Postproxy Reels guide](https://postproxy.dev/blog/instagram-reels-api-publishing-guide/)). Plan for "switch to Business account" in onboarding.
- **The video must be hosted at a publicly accessible HTTPS URL** — Meta cURLs it during the container-publish flow. There is no direct byte upload on the Instagram Login path. For cabin-visuals that means uploading the exported MP4 to your Supabase/S3 bucket with a public (or signed-public) URL first, then handing that URL to Meta.
- Two-step flow: create media container (`media_type=REELS`, `video_url=...`) → poll container status → `media_publish`.
- Reels specs: 9:16, H.264/HEVC; trial reels supported.

**Limits:** **100 API-published posts per account per rolling 24h** (Meta docs, fetched 2026-07-24); ~200 API calls/hour/account platform rate limit reported in 2025–26 writeups ([Netrows Graph API guide](https://www.netrows.com/blog/instagram-graph-api-guide-2026)).

**App Review:** to serve third-party users you need Advanced Access on both scopes → App Review with a screencast per permission + business verification; expect 2–4 weeks ([Phyllo Instagram integration guide, 2026](https://www.getphyllo.com/post/instagram-api-integration-101-for-developers-of-the-creator-economy); [implementation gist for the July-2024 Instagram Login API](https://gist.github.com/PrenSJ2/0213e60e834e66b7e09f7f93999163fc)).

**Verdict:** *Feasible after review.* The Instagram Login path is genuinely simpler than the old Page-linked flow, and solo devs pass App Review routinely (screencast quality is what matters). The real product cost is the hosted-URL requirement (you already have a bucket, so fine) and forcing users onto professional accounts.

### YouTube Shorts — Data API v3 `videos.insert`

A Short is just a regular upload that is ≤3 min and vertical (optionally `#Shorts` in title/description) — there's no separate Shorts endpoint.

**Quota economics (changed!):** the task brief's 1600-unit figure is outdated. On **2025-12-04 Google cut `videos.insert` from ~1600 to ~100 units** ([official revision history](https://developers.google.com/youtube/v3/revision_history), fetched 2026-07-24). Default project quota is still 10,000 units/day (resets midnight PT), so a default project now supports ~100 uploads/day, not 6 ([Phyllo YouTube quota guide, 2026](https://www.getphyllo.com/post/youtube-api-limits-how-to-calculate-api-usage-cost-and-fix-exceeded-api-quota)). For per-user OAuth uploads (each user consumes *your* project's quota), 100/day is fine at cabin-visuals' current scale; beyond that, quota increase = the [API Compliance Audit form](https://developers.google.com/youtube/terms/developer-policies) — no pay-to-raise option.

**The private-lock (still in effect):** "All videos uploaded via the videos.insert endpoint from unverified API projects created after 28 July 2020 will be restricted to private viewing mode" — confirmed still active in the revision history (fetched 2026-07-24). The uploader gets an email saying their video was locked private. Lift = pass the compliance audit. Real-world example of indie tools hitting this: [porjo/youtubeuploader issue #86](https://github.com/porjo/youtubeuploader/issues/86).

Separately, Google **OAuth app verification** (the "unverified app" consent-screen warning + 100-user cap for sensitive scopes) applies to the `youtube.upload` scope — also a form, also passable solo.

**Verdict:** *Feasible after audit; cheapest of the three to operate.* The audit is a form, commonly approved for legitimate apps. Until it passes, uploads land private — which is arguably an acceptable beta behavior ("we upload it as private, you flip it public"), unlike TikTok's private-account requirement.

### Scenario A bottom line

One-click publish to all three is achievable for a solo dev, but it's ~3 parallel review processes (TikTok audit, Meta App Review + business verification, YouTube compliance audit + OAuth verification) plus ongoing policy surface area. Against the Sept 15 two-paying-users deadline: **ship "Export MP4" + a share sheet / deep links first**. The reviews only make sense once users actually complete exports and ask for it. If you do build it, build TikTok as `video.upload`-to-drafts (best UX, same audit), Reels via Instagram Login + your existing bucket for hosted URLs, YouTube direct.

---

## Scenario B: Personal automation for Julia

### Option 1 — Official APIs, single account

- **YouTube: yes, do this.** Own Cloud project, OAuth consent screen in Testing mode (your Google account as test user — note: refresh tokens in Testing mode expire after 7 days, so either publish the consent screen or re-auth weekly; publishing an app that only you use is fine), then `videos.insert` from a script. Costs 100 units of your own 10k/day. The one catch is the private-lock above: **submit the compliance audit form once** (describe it as a personal posting tool) to get public uploads; individuals do get approved, and until then you can upload private + flip public in Studio (one click, or via `videos.update` — which does *not* bypass the lock, so it's manual until audited).
- **Instagram: possible free, mildly annoying.** Create a Meta app (Instagram API with Instagram Login), add your own account as an **Instagram Tester** — Development Mode fully works for app-role accounts without App Review ([tester flow gist](https://gist.github.com/PrenSJ2/0213e60e834e66b7e09f7f93999163fc); [Postproxy guide](https://postproxy.dev/blog/post-to-instagram-via-api/)). You still need the video at a public URL (throwaway Supabase bucket path works) and a professional account. Long-lived tokens last 60 days and are refreshable programmatically.
- **TikTok: effectively no, solo.** Your own unaudited app forces SELF_ONLY + your account private at post time — useless for marketing posts. Passing the TikTok audit for a single-user personal app is possible but is the same paperwork as Scenario A. Skip; use a third party whose app is already audited.

### Option 2 — Third-party posting APIs / schedulers

| Service | TikTok + Reels + Shorts? | API? | Price | Notes |
|---|---|---|---|---|
| **Buffer (new API)** | Yes (11 channels incl. TikTok, IG, YouTube) | New GraphQL API, rebuilt 2026; **API key on the free plan** (1 key; paid = 5) | **Free**: 3 channels, 10 scheduled posts/channel; paid from ~$5/channel/mo | 3 free channels = exactly TikTok+IG+YT. Video-post-via-API support not explicitly confirmed in their announcement article — verify with one test post before committing. Sources: [Buffer's own API comparison article, 2026-06-11](https://buffer.com/resources/social-media-api-multi-platform-posting/) |
| **upload-post.com** | Yes (TikTok, IG, YouTube + 8 more) | REST, API-key auth (`api.upload-post.com`) | Free: 10 uploads/mo; Basic $16/mo; **API access requires Professional ~$33/mo** | Purpose-built "upload video everywhere" API; caps: TikTok 15 posts/24h, IG 50/24h. Sources: [Postqued alternatives roundup, 2026](https://postqued.com/blog/best-upload-post-alternatives), [LinkStart review](https://www.linkstartai.com/en/agents/upload-post) |
| **Post for Me** | 9 platforms | Yes, API-first | from **$10/mo** | Cheapest API-first option in Buffer's 2026 comparison; less battle-tested |
| **Ayrshare** | Yes (13+ networks) | Yes, the most mature API | Free: 20 posts, images only (no video); **Premium $149/mo** for 1 profile | Overkill/overpriced for one person; built for products embedding posting. Source: [ayrshare.com/pricing](https://www.ayrshare.com/pricing/) (2026) |
| **Postiz** (open-source) | Yes | Yes (all plans; self-host free, AGPL) | Self-host free (~$5–10/mo server); cloud $29/mo | **Self-hosting does NOT dodge platform reviews** — you must bring your own TikTok/Meta/Google apps, with all the Scenario-A restrictions (TikTok posts go SELF_ONLY until *your* app is audited). Cloud plan uses their approved apps. Sources: [postiz.com/pricing](https://postiz.com/pricing), [Railway deploy notes, 2026-07](https://railway.com/deploy/postiz) |
| **Mixpost** (self-hosted) | Yes | Yes | One-time license, self-hosted | Same bring-your-own-API-keys problem; their own docs have a TikTok troubleshooting page about audit restrictions ([docs.mixpost.app](https://docs.mixpost.app/services/social/tik-tok/troubleshooting/)) |
| **Later / Metricool** | Scheduling UIs, yes | No real public posting API | — | Fine as manual schedulers, not scriptable; Buffer deprecated its old API in 2019 and only re-launched one in 2026 ([Zernio Buffer-alternatives writeup](https://zernio.com/blog/buffer-alternative-for-developers)) |

### Option 3 — Unofficial routes (honest risk assessment)

- **instagrapi** (Python, private mobile-API emulation): works, but you're handing your real credentials to a reverse-engineered client. 2026 industry writeups put annual suspension rates for browser/private-API automation at **15–30%** vs <0.5% for official-API tools, and Meta has DMCA'd unofficial Instagram wrapper libraries ([PostEngage ban-risk analysis, 2026](https://postengage.ai/blog/instagram-automation-ban-risk-truth); [IceKulfi automation rules, 2026](https://www.icekulfi.com/blogs/instagram-automation-policies-guide)). Losing @cabinvisuals' IG to save $16/mo is a terrible trade for a marketing account you're growing.
- **tiktok-uploader / Selenium headless scripts**: cookie-based browser puppeting; TikTok actively fingerprints automation, scripts break on every UI change, and bans hit the account, not the script ([OpenHosst TikTok automation, 2026](https://openhosst.com/blog/tiktok-automation)). Same verdict: not for accounts you care about.
- Rule of thumb: unofficial routes are for burner/test accounts only. Julia's accounts are the marketing channel — treat them as production infrastructure.

### Recommended concrete setup

A ~150-line Node CLI in the repo (it's a Next.js/TS project; reuse the env handling): 

```
npm run post -- clip.mp4 --caption "text #fyp" [--only tiktok,ig,yt] [--title "..."]
```

Fan-out per platform:

1. **YouTube — direct, free.** `googleapis` npm package, OAuth refresh token stored in `.env.local`, `videos.insert` with `snippet.title`, `#Shorts`, `status.privacyStatus=public`. One-time: create Cloud project, enable Data API, OAuth client (Desktop), run an auth script once, **file the compliance-audit form** so uploads aren't private-locked; until approval, script uploads private and prints the Studio link to flip.
2. **TikTok + Instagram — via Buffer's new GraphQL API (free tier), with upload-post.com ($33/mo) as the fallback.** Setup: connect TikTok + IG (professional account) to Buffer in their UI once (their apps are already audited/approved, so posts are public and normal), grab the free-plan API key, and have the CLI create an immediate-publish post with the video attached. **First step: run one real video post per platform through the Buffer API to confirm video/Reels/TikTok publishing works via API on free tier** — their June 2026 announcement confirms post creation + media attach but I could not confirm video-to-TikTok specifically. If it can't, switch the fan-out to upload-post.com's REST API (`POST /api/upload` with multipart video + platform list) — that product exists precisely for this.
3. Nice-to-have later: a watched `to-post/` folder (chokidar) with a `caption.txt` sidecar, or a `--schedule` flag (Buffer natively schedules).

**Monthly cost:** $0 (YouTube direct + Buffer free) — or $33/mo if Buffer's free API can't push video and you go upload-post.com. Either is far below Ayrshare's $149.

**Time to working:** YouTube leg ~1 hour + audit form wait; Buffer leg ~1–2 hours including the verification post. No Meta App Review, no TikTok audit, no headless browsers, ~zero ban risk.

---

## Source index (all fetched/searched 2026-07-24)

- TikTok: [Get Started](https://developers.tiktok.com/doc/content-posting-api-get-started) · [Content Sharing Guidelines](https://developers.tiktok.com/doc/content-sharing-guidelines) · [Direct Post reference](https://developers.tiktok.com/doc/content-posting-api-reference-direct-post) · [PostPeer 2026](https://www.postpeer.dev/blog/best-tiktok-posting-api) · [Postproxy 2026](https://postproxy.dev/blog/how-to-post-to-tiktok-via-api/)
- Instagram: [Meta content publishing docs](https://developers.facebook.com/docs/instagram-platform/content-publishing) · [Instagram-Login implementation gist (July 2024 API)](https://gist.github.com/PrenSJ2/0213e60e834e66b7e09f7f93999163fc) · [Phyllo 2026](https://www.getphyllo.com/post/instagram-api-integration-101-for-developers-of-the-creator-economy) · [Netrows 2026](https://www.netrows.com/blog/instagram-graph-api-guide-2026) · [Postproxy Reels guide](https://postproxy.dev/blog/instagram-reels-api-publishing-guide/)
- YouTube: [Revision history (2025-12-04 quota change; 2020-07-28 private-lock)](https://developers.google.com/youtube/v3/revision_history) · [videos.insert](https://developers.google.com/youtube/v3/docs/videos/insert) · [Developer policies / audit](https://developers.google.com/youtube/terms/developer-policies) · [Phyllo quota guide 2026](https://www.getphyllo.com/post/youtube-api-limits-how-to-calculate-api-usage-cost-and-fix-exceeded-api-quota) · [youtubeuploader issue #86](https://github.com/porjo/youtubeuploader/issues/86)
- Schedulers/APIs: [Buffer multi-platform API comparison, 2026-06-11](https://buffer.com/resources/social-media-api-multi-platform-posting/) · [Ayrshare pricing](https://www.ayrshare.com/pricing/) · [Postiz pricing](https://postiz.com/pricing) · [Postiz on Railway](https://railway.com/deploy/postiz) · [upload-post alternatives (pricing details)](https://postqued.com/blog/best-upload-post-alternatives) · [Mixpost TikTok troubleshooting](https://docs.mixpost.app/services/social/tik-tok/troubleshooting/) · [Zernio on Buffer's API history](https://zernio.com/blog/buffer-alternative-for-developers)
- Risk: [PostEngage 2026](https://postengage.ai/blog/instagram-automation-ban-risk-truth) · [IceKulfi 2026](https://www.icekulfi.com/blogs/instagram-automation-policies-guide) · [OpenHosst 2026](https://openhosst.com/blog/tiktok-automation)
