import { sql } from 'drizzle-orm'
import { integer, jsonb, pgPolicy, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { authUid, authUsers, authenticatedRole } from 'drizzle-orm/supabase'

// A valid empty project at schemaVersion 1 - what a row holds before its first save.
// Must stay hydratable by the editor (a default in the DB, not just in app code).
const EMPTY_PROJECT_DOCUMENT = sql`'{"schemaVersion":1,"bpm":120,"beatsPerBar":4,"totalBars":32,"tracks":{},"rootTrackIds":[]}'::jsonb`

export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    // The whole project document (tracks · blocks · notes · bpm · …) as one blob.
    // Its shape is versioned by schemaVersion inside the blob, not by migrations.
    data: jsonb('data').notNull().default(EMPTY_PROJECT_DOCUMENT),
    schemaVersion: integer('schema_version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    pgPolicy('projects_select_own', {
      for: 'select',
      to: authenticatedRole,
      using: sql`${authUid} = ${t.userId}`,
    }),
    pgPolicy('projects_insert_own', {
      for: 'insert',
      to: authenticatedRole,
      withCheck: sql`${authUid} = ${t.userId}`,
    }),
    pgPolicy('projects_update_own', {
      for: 'update',
      to: authenticatedRole,
      using: sql`${authUid} = ${t.userId}`,
      withCheck: sql`${authUid} = ${t.userId}`,
    }),
    pgPolicy('projects_delete_own', {
      for: 'delete',
      to: authenticatedRole,
      using: sql`${authUid} = ${t.userId}`,
    }),
  ],
)

// One row per user who has ever touched billing. Written ONLY by the service
// role (Stripe webhook / checkout confirm routes) - no client write policies
// exist on purpose; the browser can read its own row and nothing else.
export const subscriptions = pgTable(
  'subscriptions',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    stripeCustomerId: text('stripe_customer_id').notNull(),
    stripeSubscriptionId: text('stripe_subscription_id'),
    // Mirrors Stripe's subscription status ('active' | 'trialing' | 'canceled' |
    // 'past_due' | …); 'inactive' = customer created but never subscribed.
    status: text('status').notNull().default('inactive'),
    priceId: text('price_id'),
    currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    pgPolicy('subscriptions_select_own', {
      for: 'select',
      to: authenticatedRole,
      using: sql`${authUid} = ${t.userId}`,
    }),
  ],
)

// Ported verbatim from the pre-Drizzle dashboard policies (including the odd
// email-keyed update rule), so declaring them here changes no behavior.
export const profiles = pgTable(
  'profiles',
  {
    userId: uuid('user_id')
      .primaryKey()
      .default(authUid)
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    firstName: text('first_name'),
    lastName: text('last_name'),
    email: text('email'),
  },
  (t) => [
    pgPolicy('profiles_select_own', {
      for: 'select',
      to: authenticatedRole,
      using: sql`${authUid} = ${t.userId}`,
    }),
    pgPolicy('profiles_insert_own', {
      for: 'insert',
      withCheck: sql`${authUid} = ${t.userId}`,
    }),
    pgPolicy('profiles_update_own_email', {
      for: 'update',
      using: sql`((select auth.jwt()) ->> 'email') = ${t.email}`,
      withCheck: sql`((select auth.jwt()) ->> 'email') = ${t.email}`,
    }),
    pgPolicy('profiles_delete_own', {
      for: 'delete',
      using: sql`${authUid} = ${t.userId}`,
    }),
  ],
)
