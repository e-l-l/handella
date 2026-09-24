import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { unconfiguredLinearAdapter } from './adapters/linear.js'
import { createCodexAdapter } from './adapters/codex-cli.js'
import { unavailableFolderPicker } from './adapters/folders.js'
import { createFolderPicker } from './adapters/folders-macos.js'
import { createGitAdapter } from './adapters/git-cli.js'
import { createCodexSessions } from './adapters/codex-sessions-fs.js'
import { createGitHubAdapter } from './adapters/github-cli.js'
import { createProcessInspector } from './adapters/processes-ps.js'
import { unavailableTerminal } from './adapters/terminal.js'
import { createTerminalOpener } from './adapters/terminal-macos.js'
import { buildApp } from './app.js'
import { createDispatcher } from './domain/dispatch.js'
import { createMergeCheck } from './domain/merge-check.js'
import { createPullRequestCheck } from './domain/pull-request-check.js'
import { createSessionWatch } from './domain/session-watch.js'
import { createReconciler } from './domain/reconcile.js'
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
  const processes = createProcessInspector()
  const mergeCheck = createMergeCheck({ git, github, store })
  const pullRequests = createPullRequestCheck({ git, github })
  const codexSessions = createCodexSessions()
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
    mergeCheck,
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

  // Built before the scheduler so every pass can tell it when the session is
  // Handella's and when it goes back to being the Handler's.
  const sessionWatch = createSessionWatch({
    codexSessions,
    logger: app.log,
    pullRequests,
    store,
  })

  const scheduler = createScheduler({
    broadcaster,
    codex,
    git,
    github,
    linear,
    logRoot: config.logRoot,
    logger: app.log,
    sessionWatch,
    store,
  })

  const reconciler = createReconciler({
    git,
    logger: app.log,
    mergeCheck,
    processes,
    store,
    worktreeRoot: config.worktreeRoot,
  })

  // After the app so it can use the app's logger, and before `listen` so it
  // finishes before any request can arrive: building the app opens no socket,
  // and `listen` at the end of this function is what admits the Handler.
  //
  // Before the scheduler above all: a leftover Codex may still be writing in a
  // worktree, and starting a new pass in that worktree would put two agents in
  // one directory (docs/adr/0012).
  //
  // Wrapped because housekeeping is never the reason Handella does not come
  // up. Everything below this line is what the Handler actually asked for, and
  // a reap that threw — `ps` gone, a signal refused, a database that would not
  // take the write — would otherwise take the dashboard down with it and leave
  // the leftover running anyway.
  try {
    const reaped = await reconciler.reapProcesses()
    if (reaped.killed.length > 0) {
      app.log.warn(
        { pids: reaped.killed.map((record) => record.pid) },
        'Stopped the Codex processes a restart left behind',
      )
    }
    if (reaped.reused.length > 0) {
      app.log.warn(
        { pids: reaped.reused.map((record) => record.pid) },
        'Left alone the recorded pids that now belong to something else',
      )
    }
  } catch (error) {
    app.log.error(
      { err: error },
      'Could not reap the Codex processes a restart left behind',
    )
  }

  scheduler.start()
  // Its first pass reports the worktrees no job claims, which is why nothing
  // asks for that here: it is not ordered against anything, and a synchronous
  // walk of the worktree root is not worth making the Handler wait for.
  reconciler.start()
  // After the scheduler, so a Job it has just claimed is already fenced off as
  // Handella's before the first read of anybody's session.
  sessionWatch.start()

  app.addHook('onClose', async () => {
    scheduler.stop()
    reconciler.stop()
    sessionWatch.stop()
    await Promise.all([
      scheduler.whenIdle(),
      reconciler.whenIdle(),
      sessionWatch.whenIdle(),
    ])
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
