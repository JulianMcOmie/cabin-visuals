import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { isThemeId, mergeThemeSettings, SETTINGS_KEY } from '@/settings/themes'

/** The request owns one auth session. An account switch cannot redirect an in-flight save. */
export async function POST(request: NextRequest) {
  if (request.headers.get('origin') !== request.nextUrl.origin) {
    return NextResponse.json({ error: 'Invalid origin' }, { status: 403 })
  }
  let body
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid settings' }, { status: 400 })
  }
  if (!isThemeId(body?.theme) || typeof body?.userId !== 'string') {
    return NextResponse.json({ error: 'Invalid settings' }, { status: 400 })
  }
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user || user.is_anonymous) {
    return NextResponse.json({ error: 'Sign in to save account settings' }, { status: 401 })
  }
  if (user.id !== body.userId) {
    return NextResponse.json({ error: 'Your account changed. Please try again.' }, { status: 409 })
  }
  const { error } = await supabase.auth.updateUser({ data: {
    [SETTINGS_KEY]: mergeThemeSettings(user.user_metadata, body.theme),
  } })
  if (error) return NextResponse.json({ error: 'Could not save your theme. Please try again.' }, { status: 503 })
  return NextResponse.json({ theme: body.theme })
}
