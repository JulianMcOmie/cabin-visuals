import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Two dev servers sharing one .next/ corrupt each other's build manifests
  // (Internal Server Error on both). A second server (another worktree/session)
  // sets NEXT_DIST_DIR to its own directory to stay isolated.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  transpilePackages: ['tone'],
  // Reverse proxy for PostHog: the browser sends events to our own domain
  // (/ingest/*), which Vercel forwards server-side. First-party requests
  // survive the ad blockers that drop anything aimed at *.posthog.com -
  // without this a large share of visitors never reach PostHog at all.
  // Mirrors https://posthog.com/docs/advanced/proxy/nextjs
  async rewrites() {
    return [
      {
        source: "/ingest/static/:path*",
        destination: "https://us-assets.i.posthog.com/static/:path*",
      },
      {
        source: "/ingest/:path*",
        destination: "https://us.i.posthog.com/:path*",
      },
    ];
  },
  // PostHog's ingestion API is sensitive to trailing slashes being rewritten.
  skipTrailingSlashRedirect: true,
};

export default nextConfig;
