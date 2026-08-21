"use client"

import { type ReactNode } from "react"
import { MotionConfig } from "framer-motion"
import { CabinLogo } from "../CabinLogo"
import { SiteHeader } from "../SiteHeader"
import { Appear, Reveal } from "../motionPresets"
import { ProfileMenu } from "../ProfileMenu"
import { useAuth } from "../../persistence/hooks/useAuth"
import { getLastProjectId } from "../../persistence/lastProject"
import { track } from "../../analytics/analytics"
import { InstantLink as Link, useInstantNavigation } from "../instantNavigation"
import { EditorFacsimile } from "./EditorFacsimile"
import { SOCIAL_LINKS, VISUAL_EXAMPLES } from "./content"

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

function AppShowcase() {
  return (
    <div className="relative">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -inset-x-4 -inset-y-8 -z-10 bg-[radial-gradient(ellipse_at_center,rgba(53,167,230,0.14),transparent_66%)] blur-2xl"
      />
      <div className="mb-4 flex items-end justify-between gap-4 px-1">
        <div className="text-left">
          <p className="m-0 font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--accent)]">
            The visual music workstation
          </p>
          <p className="mt-1.5 mb-0 text-[13px] text-[var(--text-3)]">
            Compose, sync, and finish the whole show in one place.
          </p>
        </div>
        <span className="hidden items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--bg-panel)] px-3 py-1 font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--text-muted)] sm:flex">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)] shadow-[0_0_8px_var(--accent)]" />
          App preview
        </span>
      </div>

      <EditorFacsimile className="rounded-xl border border-[var(--border-strong)] bg-[var(--bg-app)] shadow-[0_28px_90px_-30px_rgba(0,0,0,0.9),0_22px_70px_-40px_rgba(53,167,230,0.8)]" />
    </div>
  )
}

function VisualExamples() {
  return (
    <section aria-label="Examples made with Cabin Visuals" className="w-full bg-black">
      {VISUAL_EXAMPLES.map((visual) => (
        <div
          key={visual.id}
          className="relative h-[100svh] w-full overflow-hidden bg-black"
        >
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${visual.id}?autoplay=1&mute=1&loop=1&playlist=${visual.id}&controls=0&modestbranding=1&rel=0&playsinline=1&disablekb=1&iv_load_policy=3&showinfo=0&fs=0`}
            title={visual.title}
            tabIndex={-1}
            loading="lazy"
            allow="autoplay; encrypted-media"
            className="pointer-events-none absolute left-1/2 top-1/2 max-w-none -translate-x-1/2 -translate-y-1/2 scale-[1.04] border-0"
            style={{
              width: "max(100vw, 177.7778vh)",
              height: "max(56.25vw, 100vh)",
            }}
          />
        </div>
      ))}
    </section>
  )
}

/** The pre-2026-redesign landing page, kept intact as a swappable cover.
 *  Restore it by pointing ACTIVE_LANDING at 'classic' in ./index.tsx. */
export function LandingClassic() {
  // Shared cached auth (not a private per-mount fetch), so navigating back to
  // the landing page renders the known sign-in state instead of re-running the
  // login/signup -> profile flip.
  const { user, isAnonymous } = useAuth()
  // Real accounts only - an anonymous session is a Supabase user too, and
  // the bare `user` check showed signed-out visitors "Continue creating".
  // Signed out (anon included) routes to the login screen: login is
  // required to use the editor.
  const signedIn = !!user && !isAnonymous
  const last = signedIn && user ? getLastProjectId(user.id) : null
  const destination = signedIn ? (last ? `/editor?project=${last}` : '/projects') : '/login'
  // The loading screen paints in the click itself, before the route is fetched.
  const { go } = useInstantNavigation(destination)

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
                {signedIn ? (
              // Logged in: straight back into the last project they opened
              // on this device; /projects only when there's nothing to resume.
              <CtaGlow>
                <button
                  onClick={() => {
                    track('continue_creating_clicked', { destination: last ? 'editor' : 'projects' })
                    go(destination)
                  }}
                  className={CTA_CLASSES}
                >
                  Continue creating
                </button>
              </CtaGlow>
            ) : (
              // Not logged in (anonymous sessions included): the login screen
              // first - login is required to use the editor.
              <CtaGlow>
                <Link
                  href="/login"
                  onClick={() => track('try_it_out_clicked')}
                  className={CTA_CLASSES}
                >
                  Start creating
                </Link>
              </CtaGlow>
            )}
          </Appear>
        </section>

        {/* Product showcase */}
        <section className="mx-auto flex w-full max-w-[1240px] justify-center px-4 pb-24 sm:px-6">
          <Reveal className="w-full">
            <AppShowcase />
          </Reveal>
        </section>

        <VisualExamples />
      </main>

      {/* Footer */}
      <footer className="border-t border-[var(--border-subtle)]">
        <div className="mx-auto flex w-full max-w-[1200px] flex-col items-center justify-between gap-3 px-6 py-7 md:flex-row md:gap-2">
          <p className="m-0 text-[13px] text-[var(--text-muted)]">© {new Date().getFullYear()} Cabin Visuals. All rights reserved. Made with ♥ for musicians and visual artists</p>
          {/* Grant condition: the ElevenLabs Grants badge, linked back to the
              program. White variant - the whole site is dark. */}
          <a
            href="https://elevenlabs.io/startup-grants"
            target="_blank"
            rel="noopener noreferrer"
            className="opacity-70 transition-opacity hover:opacity-100"
          >
            <img
              src="https://eleven-public-cdn.elevenlabs.io/payloadcms/cy7rxce8uki-IIElevenLabsGrants%201.webp"
              alt="ElevenLabs Grants"
              className="h-auto w-[200px]"
            />
          </a>
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
