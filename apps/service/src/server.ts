import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { buildApp } from './app.js'
import { loadConfig } from './config.js'
import { defaultMigrationsPath, openDatabase } from './database/database.js'
import { createStore } from './domain/store.js'
import { createBroadcaster } from './events/broadcaster.js'

interface PackageMetadata {
  version: string
}

function readVersion(): string {
  const packagePath = fileURLToPath(new URL('../package.json', import.meta.url))
  const packageMetadata = JSON.parse(
    readFileSync(packagePath, 'utf8'),
  ) as PackageMetadata
  return packageMetadata.version
}

async function main(): Promise<void> {
  process.umask(0o077)
  const config = loadConfig()
  const production = process.env.NODE_ENV === 'production'

  if (production && !existsSync(`${config.dashboardPath}/index.html`)) {
    throw new Error(
      'Dashboard build is missing; run npm run build before npm start',
    )
  }

  const database = openDatabase({
    databasePath: config.databasePath,
    migrationsPath: defaultMigrationsPath(config.repositoryRoot),
  })
  const broadcaster = createBroadcaster()
  const store = createStore({ broadcaster, database: database.drizzle })

  const app = await buildApp({
    broadcaster,
    store,
    ...(production ? { dashboardPath: config.dashboardPath } : {}),
    logger: production
      ? true
      : {
          transport: {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'SYS:standard' },
          },
        },
    statusSource: database,
    version: readVersion(),
  })

  app.addHook('onClose', async () => {
    database.close()
  })

  let shuttingDown = false
  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) return
    shuttingDown = true
    app.log.info({ signal }, 'Stopping Handella')
    await app.close()
  }

  process.once('SIGINT', () => void shutdown('SIGINT'))
  process.once('SIGTERM', () => void shutdown('SIGTERM'))

  await app.listen({ host: config.host, port: config.port })
  database.markStarted()
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
