# SQLite storage

`openDatabase(DATA_DIR)` opens `tax-tracker.db`, enables foreign keys, WAL and a busy timeout, and applies committed Drizzle migrations before returning a repository. The server opens it before the first API operation; Docker's readiness healthcheck opens it during startup. `DATA_DIR` defaults to `./data` relative to the running process. Database files and automatically generated session secrets have private permissions.

Stable Drizzle 0.45 uses better-sqlite3. The documented Node built-in SQLite adapter currently requires Drizzle's release-candidate line, so this build uses the stable adapter. better-sqlite3 13 ships platform binaries; the existing build allow-list remains restricted to better-sqlite3 and esbuild.

Generate a schema migration with `pnpm --filter @tax/db exec drizzle-kit generate`. Commit the SQL, snapshot and journal together. Tests open temporary databases, including migration re-entry, persistence, rollback, cascade and duplicate protection.

Transactions use TEXT amounts and unique `(source, sourceRef)`. Insert conflicts never update existing transactions, including user-edited ones. Deleting an import removes only transactions owned by that import; a duplicate import does not take ownership of an existing transaction. Ledger/settings/balance changes invalidate stored reports. Reports must then be recomputed.

The database uses WAL: for a backup, stop the app before copying the database (or use SQLite's backup facility). Copying only a live `.db` file can omit uncheckpointed changes. API keys are server-side settings and are included in a database backup; protect it accordingly.
