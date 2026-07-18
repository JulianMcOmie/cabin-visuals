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
        <section className="mx-auto flex w-full max-w-[1200px] flex-col items-center gap-11 px-6 pt-24 pb-20 text-center">
          <Appear className="flex flex-col items-center gap-6">
            <CabinLogo className="block h-[150px] w-auto" />
            <h1 className="m-0 max-w-[880px] text-[44px] font-bold leading-[1.06] tracking-[-0.03em] text-[var(--text)] md:text-[64px]">
              <span>Create insanely great visuals for music</span>
            </h1>
            <p className="m-0 max-w-[620px] text-[17px] leading-[1.55] tracking-[-0.01em] text-[var(--text-3)]">
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
              // Not logged in: drop them straight into the editor to play.
              <CtaGlow>
                <Link
                  href="/editor"
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
            <div className="group/carousel relative grid grid-cols-[minmax(0,0.26fr)_minmax(0,1fr)_minmax(0,0.26fr)] items-center gap-3 sm:gap-5 lg:gap-7">
              <button
                type="button"
                onClick={() => switchVideo(previousVideoIndex, -1, 'thumb')}
                aria-label={`Show previous video: ${previousVideo.title}`}
                className="group relative aspect-video w-full scale-[0.96] overflow-hidden rounded-lg bg-[var(--bg-canvas-deep)] opacity-45 shadow-xl ring-1 ring-white/5 saturate-[0.6] transition-all duration-300 hover:scale-100 hover:opacity-90 hover:saturate-100 hover:ring-white/15 cursor-pointer"
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
                className="group relative aspect-video w-full scale-[0.96] overflow-hidden rounded-lg bg-[var(--bg-canvas-deep)] opacity-45 shadow-xl ring-1 ring-white/5 saturate-[0.6] transition-all duration-300 hover:scale-100 hover:opacity-90 hover:saturate-100 hover:ring-white/15 cursor-pointer"
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
                className="absolute left-2 top-1/2 z-20 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-black/55 text-white/90 shadow-lg backdrop-blur-md opacity-0 transition-all duration-200 hover:scale-105 hover:bg-black/80 hover:text-white focus-visible:opacity-100 group-hover/carousel:opacity-100 sm:left-3 sm:h-10 sm:w-10 cursor-pointer"
              >
                <ChevronLeft size={20} />
              </button>
              <button
                type="button"
                onClick={() => switchVideo(nextVideoIndex, 1, 'arrow')}
                aria-label="Next demo video"
                className="absolute right-2 top-1/2 z-20 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-black/55 text-white/90 shadow-lg backdrop-blur-md opacity-0 transition-all duration-200 hover:scale-105 hover:bg-black/80 hover:text-white focus-visible:opacity-100 group-hover/carousel:opacity-100 sm:right-3 sm:h-10 sm:w-10 cursor-pointer"
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
        <div className="mx-auto flex w-full max-w-[1200px] flex-col items-center justify-between gap-2 px-6 py-7 md:flex-row">
          <p className="m-0 text-[13px] text-[var(--text-muted)]">© {new Date().getFullYear()} Cabin Visuals. All rights reserved.</p>
          <p className="m-0 text-[13px] text-[var(--text-muted)]">Made with ♥ for musicians and visual artists</p>
        </div>
      </footer>
    </div>
    </MotionConfig>
  )
}
