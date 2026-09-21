import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { unconfiguredLinearAdapter } from './adapters/linear.js'
import { createCodexAdapter } from './adapters/codex-cli.js'
import { unavailableFolderPicker } from './adapters/folders.js'
import { createFolderPicker } from './adapters/folders-macos.js'
import { createGitAdapter } from './adapters/git-cli.js'
import { createGitHubAdapter } from './adapters/github-cli.js'
import { unavailableTerminal } from './adapters/terminal.js'
import { createTerminalOpener } from './adapters/terminal-macos.js'
import { buildApp } from './app.js'
import { createDispatcher } from './domain/dispatch.js'
import { createScheduler } from './domain/scheduler.js'
import { loadConfig } from './config.js'
import { defaultMigrationsPath, openDatabase } from './database/database.js'
import { createRedactor } from './domain/redact.js'
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

  // Imported only when there is a key, so an installation without one never
  // depends on the Linear SDK loading cleanly.
  const linear =
    config.linearApiKey === undefined
      ? unconfiguredLinearAdapter
      : (await import('./adapters/linear-sdk.js')).createLinearAdapter({
          apiKey: config.linearApiKey,
        })

  const git = createGitAdapter()
  const dispatcher = createDispatcher({
    git,
    linear,
    store,
    worktreeRoot: config.worktreeRoot,
  })

  // Built from the configured secrets and handed to the adapter, so every line
  // Codex writes is redacted before anything downstream can persist it.
  const codex = createCodexAdapter({
    redact: createRedactor(config.secretValues),
  })
  const github = createGitHubAdapter()
  // The dialog is AppleScript, so anywhere else the Handler types the path
  // and is told so, rather than being told osascript is missing.
  // Both of these open something in the Handler's own login session, which
  // is a thing only the machine they are sitting at can do.
  const onMacOS = process.platform === 'darwin'

  const folders = onMacOS ? createFolderPicker() : unavailableFolderPicker

  const terminal = onMacOS
    ? createTerminalOpener({ preferred: config.terminalApp })
    : unavailableTerminal

  // Nothing this process started is still running, so anything the database
  // still calls planning or implementing was cut off mid-pass. Done before the
  // app is built, so no request can see a job in a state no runner is behind.
  const interrupted = store.markInterrupted()

  const app = await buildApp({
    broadcaster,
    codex,
    dispatcher,
    folders,
    git,
    github,
    linear,
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
    terminal,
    version: readVersion(),
  })

  // Started after the app is built, so the first pass sees a store that is
  // fully wired, and stopped before the database closes under it.
  if (interrupted.length > 0) {
    app.log.warn(
      { jobIds: interrupted.map((job) => job.id) },
      'Suspended the jobs a restart interrupted',
    )
  }

  const scheduler = createScheduler({
    broadcaster,
    codex,
    git,
    github,
    linear,
    logRoot: config.logRoot,
    logger: app.log,
    store,
  })
  scheduler.start()

  app.addHook('onClose', async () => {
    scheduler.stop()
    await scheduler.whenIdle()
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
