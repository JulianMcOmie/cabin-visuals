import { createClient } from '../utils/supabase/client'

// The persistence module's single import point for Supabase. Reuses the existing
// browser client (session cookie rides along, so RLS sees auth.uid()) — nothing
// here re-implements auth. Lazy singleton so importing this module stays free of
// side effects during SSR.
let client: ReturnType<typeof createClient> | undefined

export function getSupabase() {
  client ??= createClient()
  return client
}
