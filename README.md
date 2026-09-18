# handella

A local-first engineering orchestrator that turns Linear issues, Slack threads, and ad hoc requests into supervised Codex jobs—handling planning, isolated worktrees, parallel execution, runbooks, CI fixes, and GitHub PRs while keeping humans in control.

## Requirements

- macOS
- Node.js 24 or newer and npm 11

The repository includes an `.nvmrc` for the preferred Node.js 24 LTS runtime.

## Setup

```sh
npm install
npm run dev
```

The development command starts the Fastify service on `127.0.0.1:4310` and the Vite dashboard on `http://localhost:5173`. Vite proxies `/api` to the local service.

To run the built, single-origin application:

```sh
npm run build
npm start
```

Open `http://127.0.0.1:4310`. The service applies pending database migrations before it begins listening.

## Configuration

Configuration is optional. Copy `.env.example` to `.env` only when overriding a default, then restrict it to the current account:

```sh
cp .env.example .env
chmod 600 .env
```

| Variable                  | Default                 | Purpose                                                                                                                                     |
| ------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `HANDELLA_PORT`           | `4310`                  | Local service port                                                                                                                          |
| `HANDELLA_DATABASE_PATH`  | `.data/handella.sqlite` | SQLite file, relative to the repository root unless absolute                                                                                |
| `HANDELLA_LINEAR_API_KEY` | _(unset)_               | Linear personal API key. Without it, intake and ad hoc issue creation answer `linear_not_configured` and the dashboard shows a setup notice |

Unknown `.env` keys, invalid values, and group/world-readable `.env` files stop startup. The service host is deliberately fixed to `127.0.0.1`.

## Development commands

| Command                | Purpose                                              |
| ---------------------- | ---------------------------------------------------- |
| `npm run dev`          | Start contracts, service, and dashboard with reload  |
| `npm run build`        | Build contracts, dashboard, and service              |
| `npm start`            | Start the previously built single-origin application |
| `npm test`             | Run focused tests across all workspaces              |
| `npm run typecheck`    | Type-check all workspaces                            |
| `npm run lint`         | Run ESLint                                           |
| `npm run format:check` | Verify Prettier formatting                           |
| `npm run format`       | Apply Prettier formatting                            |

Drizzle migration files are committed. After changing the database schema, generate a migration with:

```sh
npm run db:generate --workspace @handella/service
```

## Local data

Handella stores its SQLite database in the ignored `.data` directory by default. To reset this installation during early development, stop Handella and move `.data` somewhere safe; the next startup creates a new installation identity. Do not remove `.data` if its local history is still needed.
