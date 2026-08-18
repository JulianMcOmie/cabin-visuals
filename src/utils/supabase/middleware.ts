import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({
            request,
          })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Do not run code between createServerClient and the session read below. A
  // simple mistake could make it very hard to debug issues with users being
  // randomly logged out.

  // getSession(), not getUser(). This runs in front of EVERY full page load -
  // nothing is sent to the browser until it resolves - and getUser() is
  // unconditionally a network round trip to the auth server. That is the same
  // round trip that was taken off the client in "Auth resolves from the stored
  // session"; leaving it here just moved it from after the HTML to before it,
  // which is why a client-side navigation to /projects got fast and a refresh
  // did not.
  //
  // Sessions still refresh. The rotation lives in GoTrueClient.__loadSession(),
  // which both getSession() and getUser() go through, and it is NOT gated on
  // the `autoRefreshToken: false` that createServerClient sets: a token inside
  // EXPIRY_MARGIN_MS (90s) of expiring is refreshed there and the rotated
  // cookies go out through the setAll adapter above on TOKEN_REFRESHED. So the
  // network cost is paid once an hour when the token actually needs it, instead
  // of on every request.
  //
  // What is given up: getSession() reads the cookie without verifying its
  // signature, so a forged one is believed HERE. That is deliberate and matches
  // useAuth/usePlan - this value only decides which way to redirect. Every page
  // is a client component that re-derives auth for itself, no server component
  // reads user data, and every API route and server action does its own
  // getUser(). So the worst a forged cookie buys is the /projects shell instead
  // of a bounce to /login, where RLS still returns an empty list.
  //
  // Read only whether a session EXISTS - never session.user. On the server that
  // property is behind a Proxy that logs an "insecure" warning on access.
  const {
    data: { session },
  } = await supabase.auth.getSession()
  const signedIn = !!session

  const pathname = request.nextUrl.pathname;

  // Define public paths that don't require authentication
  const publicPaths = [
    '/', 
    '/editor',
    '/login',
    '/signup',
    '/reset-password',
    '/update-password',
    // Add any other public paths like /about, /pricing, etc.
  ];

  // Define auth-related paths that logged-in users should be redirected away from
  const authRoutes = [
    '/login',
    '/signup',
    '/reset-password',
    // Don't usually redirect away from update-password as user needs to be there after clicking link
  ];

  // Check if the current path starts with any of the public paths
  const isPublicPath = publicPaths.some(path => pathname.startsWith(path));
  
  // Check if the current path starts with any of the auth routes
  const isAuthRoute = authRoutes.some(path => pathname.startsWith(path));

  // Redirect unauthenticated users from *protected* pages to login
  if (!signedIn && !isPublicPath) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  // Redirect authenticated users from auth pages (login, signup, reset) to the projects page
  if (signedIn && isAuthRoute) {
      const url = request.nextUrl.clone();
      url.pathname = '/projects';
      return NextResponse.redirect(url);
  }

  // IMPORTANT: You *must* return the supabaseResponse object as it is.
  // If you're creating a new response object with NextResponse.next() make sure to:
  // 1. Pass the request in it, like so:
  //    const myNewResponse = NextResponse.next({ request })
  // 2. Copy over the cookies, like so:
  //    myNewResponse.cookies.setAll(supabaseResponse.cookies.getAll())
  // 3. Change the myNewResponse object to fit your needs, but avoid changing
  //    the cookies!
  // 4. Finally:
  //    return myNewResponse
  // If this is not done, you may be causing the browser and server to go out
  // of sync and terminate the user's session prematurely!

  return supabaseResponse
}