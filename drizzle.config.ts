import { config } from 'dotenv'
import { defineConfig } from 'drizzle-kit'

config({ path: '.env.local' })

export default defineConfig({
  dialect: 'postgresql',
  schema: './db/schema.ts',
  out: './db/migrations',
  dbCredentials: {
    // Session-mode pooler (port 5432) - required for migrations.
    url: process.env.DATABASE_URL!,
  },
  // Only projects + profiles are managed. The six legacy relational tables
  // (midi_blocks, midi_notes, project_settings, tracks, track_effects,
  // track_synths) are deliberately unmanaged fossils - filtering them out keeps
  // drizzle-kit from generating DROPs for them.
  tablesFilter: ['projects', 'profiles'],
  entities: {
    roles: { provider: 'supabase' },
  },
})
