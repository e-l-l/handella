# Use embedded SQLite instead of PostgreSQL

Handella uses SQLite through `better-sqlite3`, with its database stored in an ignored repository-local data directory by default. PostgreSQL was considered, but requiring a separately installed and running service would undermine the local-first, one-command startup contract; the database path remains configurable for Handlers who need a different local location.
