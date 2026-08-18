import { type NextRequest } from 'next/server'
import { updateSession } from './utils/supabase/middleware'

export async function middleware(request: NextRequest) {
  return await updateSession(request)
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - ingest (PostHog proxy - analytics events don't need a Supabase session)
     * - favicon.ico (favicon file)
     * - static media under /public (template clips, demo audio, fonts): each
     *   of those - and every RANGE request on a video - was invoking the edge
     *   function and parsing cookies for nothing.
     */
    '/((?!_next/static|_next/image|ingest|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|mp4|webm|mp3|m4a|wav|woff2|woff|glb)$).*)',
  ],
}