"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { AnimatePresence, motion, MotionConfig } from "framer-motion"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { CabinLogo } from "./CabinLogo"
import { SiteHeader } from "./SiteHeader"
import { Appear, Reveal } from "./motionPresets"
import { ProfileMenu } from "./ProfileMenu"
import { useAuth } from "../persistence/hooks/useAuth"
import { getLastProjectId } from "../persistence/lastProject"
import { track } from "../analytics/analytics"

const DEMO_VIDEOS = [
  { id: "8jPhqXtWIUw", title: "Cabin Visuals demo 1" },
  { id: "6dU7HrvZNbY", title: "Cabin Visuals demo 2" },
  { id: "M61NUKQFCJg", title: "Cabin Visuals demo 3" },
  { id: "7rfGIBAizbA", title: "Cabin Visuals demo 4" },
]

const SOCIAL_LINKS = [
  {
    label: "Instagram",
    href: "https://www.instagram.com/cabin_visuals/",
    path: "M12 0C8.74 0 8.333.015 7.053.072 5.775.132 4.905.333 4.14.63c-.789.306-1.459.717-2.126 1.384S.935 3.35.63 4.14C.333 4.905.131 5.775.072 7.053.012 8.333 0 8.74 0 12s.015 3.667.072 4.947c.06 1.277.261 2.148.558 2.913.306.788.717 1.459 1.384 2.126.667.666 1.336 1.079 2.126 1.384.766.296 1.636.499 2.913.558C8.333 23.988 8.74 24 12 24s3.667-.015 4.947-.072c1.277-.06 2.148-.262 2.913-.558.788-.306 1.459-.718 2.126-1.384.666-.667 1.079-1.335 1.384-2.126.296-.765.499-1.636.558-2.913.06-1.28.072-1.687.072-4.947s-.015-3.667-.072-4.947c-.06-1.277-.262-2.149-.558-2.913-.306-.789-.718-1.459-1.384-2.126C21.319 1.347 20.651.935 19.86.63c-.765-.297-1.636-.499-2.913-.558C15.667.012 15.26 0 12 0zm0 2.16c3.203 0 3.585.016 4.85.071 1.17.055 1.805.249 2.227.415.562.217.96.477 1.382.896.419.42.679.819.896 1.381.164.422.36 1.057.413 2.227.057 1.266.07 1.646.07 4.85s-.015 3.585-.074 4.85c-.061 1.17-.256 1.805-.421 2.227-.224.562-.479.96-.899 1.382-.419.419-.824.679-1.38.896-.42.164-1.065.36-2.235.413-1.274.057-1.649.07-4.859.07-3.211 0-3.586-.015-4.859-.074-1.171-.061-1.816-.256-2.236-.421-.569-.224-.96-.479-1.379-.899-.421-.419-.69-.824-.9-1.38-.165-.42-.359-1.065-.42-2.235-.045-1.26-.061-1.649-.061-4.844 0-3.196.016-3.586.061-4.861.061-1.17.255-1.814.42-2.234.21-.57.479-.96.9-1.381.419-.419.81-.689 1.379-.898.42-.166 1.051-.361 2.221-.421 1.275-.045 1.65-.06 4.859-.06zM12 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm7.846-10.405a1.44 1.44 0 1 1-2.88 0 1.44 1.44 0 0 1 2.88 0z",
  },
  {
    label: "TikTok",
    href: "https://www.tiktok.com/@cabinvisuals?lang=en",
    path: "M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z",
  },
  {
    label: "YouTube",
    href: "https://www.youtube.com/@CabinVisuals",
    path: "M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z",
  },
  {
    label: "X",
    href: "https://x.com/Cabin_Visuals",
    path: "M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z",
  },
  {
    label: "Discord",
    href: "https://discord.gg/ZrbQMFwCsb",
    path: "M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z",
  },
]

const CTA_CLASSES =
  "relative z-10 inline-flex h-12 items-center justify-center rounded-lg bg-[var(--accent)] px-8 text-[15px] font-bold text-[var(--on-accent)] transition-colors duration-200 hover:bg-[var(--accent-hover)] cursor-pointer"

/** Hover-only halo behind the hero CTA: a blurred accent glow that breathes,
 *  plus a thin conic highlight sweeping the button's edge. Both fade in via
 *  the wrapper's group-hover so the resting state stays quiet. */
function CtaGlow({ children }: { children: ReactNode }) {
  return (
    <span className="group relative inline-flex">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -inset-2.5 rounded-2xl bg-[var(--accent)] opacity-0 blur-2xl transition-opacity duration-500 group-hover:opacity-35 motion-safe:animate-[landing-glow-breathe_3s_ease-in-out_infinite]"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -inset-px overflow-hidden rounded-[9px] opacity-0 transition-opacity duration-300 group-hover:opacity-100"
      >
        <span className="absolute left-1/2 top-1/2 aspect-square w-[220%] -translate-x-1/2 -translate-y-1/2 bg-[conic-gradient(from_0deg,transparent_0deg,rgba(255,255,255,0.55)_55deg,transparent_115deg)] motion-safe:animate-[landing-glow-spin_3.5s_linear_infinite]" />
      </span>
      {children}
    </span>
  )
}

export default function LandingPage() {
  // Track slide direction alongside the index so the carousel can animate
  // toward the side the user actually navigated.
  const [[activeVideo, direction], setVideoState] = useState<[number, number]>([0, 0])
  // A play can't be observed inside the cross-origin YouTube iframe, but
  // clicking INTO it blurs the window with the iframe focused - the only
  // signal that someone actually engaged the demo (bounce analysis needs it;
  // watching alone fires no events and would count as a bounce otherwise).
  const activeVideoRef = useRef(activeVideo)
  activeVideoRef.current = activeVideo
  const engagedRef = useRef(false)
  useEffect(() => {
    const onBlur = () => {
      if (engagedRef.current) return
      if (document.activeElement instanceof HTMLIFrameElement) {
        engagedRef.current = true
        track('demo_video_engaged', { video: DEMO_VIDEOS[activeVideoRef.current].id })
      }
    }
    window.addEventListener('blur', onBlur)
    return () => window.removeEventListener('blur', onBlur)
  }, [])
  const switchVideo = (index: number, dir: number, method: 'arrow' | 'dot' | 'thumb') => {
    track('demo_video_switched', { method, video: DEMO_VIDEOS[index].id })
    setVideoState([index, dir])
  }
  const previousVideoIndex = (activeVideo - 1 + DEMO_VIDEOS.length) % DEMO_VIDEOS.length
  const nextVideoIndex = (activeVideo + 1) % DEMO_VIDEOS.length
  const previousVideo = DEMO_VIDEOS[previousVideoIndex]
  const nextVideo = DEMO_VIDEOS[nextVideoIndex]
  const router = useRouter()
  // Shared cached auth (not a private per-mount fetch), so navigating back to
  // the landing page renders the known sign-in state instead of re-running the
  // login/signup -> profile flip.
  const { user } = useAuth()

  return (
    <MotionConfig reducedMotion="user">
    <div className="flex min-h-screen flex-col bg-[var(--bg-page)] text-[var(--text)] font-sans">
      {/* Nav - 64px, hairline border (shared SiteHeader) */}
      <SiteHeader>
        <Link
          href="/pricing"
          onClick={() => track('nav_clicked', { from: 'landing', to: 'pricing' })}
          className="px-3 text-[13px] text-[var(--text-3)] transition-colors hover:text-[var(--text)] cursor-pointer"
        >
          Pricing
        </Link>
        {user && !user.is_anonymous ? (
          // Real account: the shared profile menu (anonymous sessions get
          // the sign-in affordances instead).
          <ProfileMenu />
        ) : (
          // Show login/signup buttons if not logged in
          <>
            <Link
              href="/login"
              onClick={() => track('nav_clicked', { from: 'landing', to: 'login' })}
              className="inline-flex h-8 items-center rounded-[5px] border border-[var(--border)] px-3.5 text-[13px] font-medium text-[var(--text-2)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text)] cursor-pointer"
            >
              Log in
            </Link>
            <Link
              href="/signup"
              onClick={() => track('nav_clicked', { from: 'landing', to: 'signup' })}
              className="inline-flex h-8 items-center rounded-[5px] bg-[var(--accent)] px-3.5 text-[13px] font-bold text-[var(--on-accent)] transition-colors hover:bg-[var(--accent-hover)] cursor-pointer"
            >
              Sign up
            </Link>
          </>
        )}
      </SiteHeader>

      <main className="flex-1">
        {/* Hero */}
        <section className="mx-auto flex w-full max-w-[1200px] flex-col items-center gap-8 px-5 pt-14 pb-14 text-center sm:gap-11 sm:px-6 sm:pt-24 sm:pb-20">
          <Appear className="flex flex-col items-center gap-6">
            <CabinLogo className="block h-[104px] w-auto sm:h-[150px]" />
            <h1 className="m-0 max-w-[880px] text-[34px] font-bold leading-[1.06] tracking-[-0.03em] text-[var(--text)] sm:text-[44px] md:text-[64px]">
              <span>Create insanely great visuals for music</span>
            </h1>
            <p className="m-0 max-w-[620px] text-[15px] leading-[1.55] tracking-[-0.01em] text-[var(--text-3)] sm:text-[17px]">
              The best workstation for music-synced visuals
            </p>
          </Appear>
          <Appear delay={0.1} className="flex flex-col items-center gap-[18px]">
            {user ? (
              // Logged in: straight back into the last project they opened
              // on this device; /projects only when there's nothing to resume.
              <CtaGlow>
                <button
                  onClick={() => {
                    const last = getLastProjectId(user.id)
                    track('continue_creating_clicked', { destination: last ? 'editor' : 'projects' })
                    router.push(last ? `/editor?project=${last}` : '/projects')
                  }}
                  className={CTA_CLASSES}
                >
                  Continue creating
                </button>
              </CtaGlow>
            ) : (
              // Not logged in: pick a template first (/start), which creates a
              // real project on an anonymous session - the Lyric Video pipeline
              // needs one to upload the song at all.
              <CtaGlow>
                <Link
                  href="/start"
                  onClick={() => track('try_it_out_clicked')}
                  className={CTA_CLASSES}
                >
                  Start creating
                </Link>
              </CtaGlow>
            )}
          </Appear>
        </section>

        {/* Video Section */}
        <section className="mx-auto flex w-full max-w-[1200px] justify-center px-6 pb-24">
          <Reveal className="w-full">
            {/* Under sm the peek thumbnails would be ~55px slivers - the
                carousel collapses to the main video alone, arrows always on
                (touch has no hover to reveal them). */}
            <div className="group/carousel relative grid grid-cols-1 items-center gap-3 sm:grid-cols-[minmax(0,0.26fr)_minmax(0,1fr)_minmax(0,0.26fr)] sm:gap-5 lg:gap-7">
              <button
                type="button"
                onClick={() => switchVideo(previousVideoIndex, -1, 'thumb')}
                aria-label={`Show previous video: ${previousVideo.title}`}
                className="group relative hidden aspect-video w-full scale-[0.96] overflow-hidden rounded-lg bg-[var(--bg-canvas-deep)] opacity-45 shadow-xl ring-1 ring-white/5 saturate-[0.6] transition-all duration-300 hover:scale-100 hover:opacity-90 hover:saturate-100 hover:ring-white/15 cursor-pointer sm:block"
              >
                <AnimatePresence initial={false}>
                  <motion.span
                    key={previousVideo.id}
                    aria-hidden="true"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.3, ease: "easeOut" }}
                    className="absolute inset-0 bg-cover bg-center"
                    style={{ backgroundImage: `url(https://i.ytimg.com/vi/${previousVideo.id}/mqdefault.jpg)` }}
                  />
                </AnimatePresence>
                <span aria-hidden="true" className="absolute inset-0 bg-gradient-to-r from-[var(--bg-page)]/60 to-black/10 transition-opacity duration-300 group-hover:opacity-40" />
              </button>

              <div className="relative z-10 aspect-video w-full overflow-hidden rounded-xl bg-[var(--bg-canvas-deep)] ring-1 ring-white/10 shadow-[0_18px_50px_-12px_rgba(0,0,0,0.7),0_30px_90px_-24px_rgba(53,167,230,0.28)]">
                <AnimatePresence initial={false} mode="popLayout">
                  <motion.div
                    key={DEMO_VIDEOS[activeVideo].id}
                    initial={{ opacity: 0, x: direction * 48, scale: 0.985 }}
                    animate={{ opacity: 1, x: 0, scale: 1 }}
                    exit={{ opacity: 0, x: direction * -48, scale: 0.985 }}
                    transition={{ duration: 0.35, ease: [0.32, 0.72, 0, 1] }}
                    className="absolute inset-0"
                  >
                    <iframe
                      className="absolute top-0 left-0 h-full w-full border-0"
                      src={`https://www.youtube.com/embed/${DEMO_VIDEOS[activeVideo].id}`}
                      title={DEMO_VIDEOS[activeVideo].title}
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      allowFullScreen
                      loading="lazy"
                    ></iframe>
                  </motion.div>
                </AnimatePresence>
              </div>

              <button
                type="button"
                onClick={() => switchVideo(nextVideoIndex, 1, 'thumb')}
                aria-label={`Show next video: ${nextVideo.title}`}
                className="group relative hidden aspect-video w-full scale-[0.96] overflow-hidden rounded-lg bg-[var(--bg-canvas-deep)] opacity-45 shadow-xl ring-1 ring-white/5 saturate-[0.6] transition-all duration-300 hover:scale-100 hover:opacity-90 hover:saturate-100 hover:ring-white/15 cursor-pointer sm:block"
              >
                <AnimatePresence initial={false}>
                  <motion.span
                    key={nextVideo.id}
                    aria-hidden="true"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.3, ease: "easeOut" }}
                    className="absolute inset-0 bg-cover bg-center"
                    style={{ backgroundImage: `url(https://i.ytimg.com/vi/${nextVideo.id}/mqdefault.jpg)` }}
                  />
                </AnimatePresence>
                <span aria-hidden="true" className="absolute inset-0 bg-gradient-to-l from-[var(--bg-page)]/60 to-black/10 transition-opacity duration-300 group-hover:opacity-40" />
              </button>

              <button
                type="button"
                onClick={() => switchVideo(previousVideoIndex, -1, 'arrow')}
                aria-label="Previous demo video"
                className="absolute left-2 top-1/2 z-20 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-black/55 text-white/90 shadow-lg backdrop-blur-md transition-all duration-200 hover:scale-105 hover:bg-black/80 hover:text-white focus-visible:opacity-100 group-hover/carousel:opacity-100 sm:left-3 sm:h-10 sm:w-10 sm:opacity-0 cursor-pointer"
              >
                <ChevronLeft size={20} />
              </button>
              <button
                type="button"
                onClick={() => switchVideo(nextVideoIndex, 1, 'arrow')}
                aria-label="Next demo video"
                className="absolute right-2 top-1/2 z-20 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-black/55 text-white/90 shadow-lg backdrop-blur-md transition-all duration-200 hover:scale-105 hover:bg-black/80 hover:text-white focus-visible:opacity-100 group-hover/carousel:opacity-100 sm:right-3 sm:h-10 sm:w-10 sm:opacity-0 cursor-pointer"
              >
                <ChevronRight size={20} />
              </button>
            </div>
            <div className="mt-6 flex items-center justify-center gap-2.5" aria-label="Demo video selection">
              {DEMO_VIDEOS.map((video, index) => (
                <button
                  key={video.id}
                  type="button"
                  onClick={() => switchVideo(index, index > activeVideo ? 1 : -1, 'dot')}
                  aria-label={`Show demo video ${index + 1}`}
                  aria-pressed={activeVideo === index}
                  className={`h-1.5 rounded-full transition-all duration-300 cursor-pointer ${
                    activeVideo === index
                      ? "w-6 bg-[var(--accent)]"
                      : "w-1.5 bg-[var(--border-strong)] hover:bg-[var(--text-muted)] hover:scale-125"
                  }`}
                />
              ))}
            </div>
          </Reveal>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-[var(--border-subtle)]">
        <div className="mx-auto flex w-full max-w-[1200px] flex-col items-center justify-between gap-3 px-6 py-7 md:flex-row md:gap-2">
          <p className="m-0 text-[13px] text-[var(--text-muted)]">© {new Date().getFullYear()} Cabin Visuals. All rights reserved. Made with ♥ for musicians and visual artists</p>
          <div className="flex items-center gap-5">
            {SOCIAL_LINKS.map((social) => (
              <a
                key={social.label}
                href={social.href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={social.label}
                className="group relative text-[var(--text-muted)] transition-colors hover:text-[var(--text)]"
              >
                <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="h-[18px] w-[18px]">
                  <path d={social.path} />
                </svg>
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md border border-[var(--border)] bg-[var(--bg-panel)] px-2 py-1 text-[11px] text-[var(--text-2)] opacity-0 transition-opacity duration-150 group-hover:opacity-100"
                >
                  {social.label}
                </span>
              </a>
            ))}
          </div>
        </div>
      </footer>
    </div>
    </MotionConfig>
  )
}
