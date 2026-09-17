import { sql } from 'drizzle-orm'
import { check, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const appInstallation = sqliteTable(
  'app_installation',
  {
    singletonKey: integer('singleton_key').primaryKey().default(1),
    installationId: text('installation_id').notNull().unique(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    lastStartedAt: integer('last_started_at', {
      mode: 'timestamp_ms',
    }).notNull(),
  },
  (table) => [
    check(
      'app_installation_singleton_key_check',
      sql`${table.singletonKey} = 1`,
    ),
  ],
)
