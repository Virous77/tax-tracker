# Server

All public endpoints use the existing `@tax/core/api` request and response schemas. Review responses include `reportStatus` and report-derived review items as described below. Thin route modules call a shared validator and services. Requests and downloads use `Cache-Control: no-store`. Errors use the shared envelope, with 400/404/409/413/422/500 and 502 `ai_unavailable`; password authentication additionally uses 401/403/429.

Build workspace packages before starting the Next development server:

```sh
pnpm install
pnpm --filter './packages/**' build
pnpm --filter @tax/web dev
```

For containers:

```sh
docker compose up --build -d
curl http://localhost:3000/api/health
docker compose down
```

`DATA_DIR` defaults to `./data` relative to the process (therefore `apps/web/data` for `pnpm --filter @tax/web dev`). Docker fixes it to `/data` with a `./data:/data` bind mount. `DATA_HOST_DIR` optionally overrides that host path; Docker Desktop must have access to it. A one-shot data-init service assigns the bind directory to the app UID (1000), allowing a clean Linux clone to start without running the app as root. Use an absolute DATA_DIR to share a development database between commands. Optional `APP_PASSWORD` gates pages and APIs; `/login`, login/logout and health remain public. `APP_SECRET` optionally supplies the HMAC secret; otherwise a secret is created privately in DATA_DIR. Cookies are httpOnly, SameSite=Strict, expire after twelve hours and use Secure on HTTPS. Logout rotates a private, persisted `.session-epoch` in DATA_DIR, invalidating all existing sessions for this single-user app, including copied cookies and sessions signed with APP_SECRET. Ten failed login attempts lock the process's login endpoint for fifteen minutes. Restarting a single-user server clears this in-memory rate limit.

AI configuration defaults to `AI_BASE_URL=http://ollama:11434/v1`, `AI_MODEL` and optional `AI_API_KEY`, with saved settings taking precedence. The API key never appears in settings or preview responses. The exact JSON payload preview contains headers and at most twenty sample rows; requesting a suggestion is the only action that calls the configured endpoint. Redirects are rejected, response reads are bounded, requests time out after thirty seconds, and Zod validates results. Endpoint locality uses `isLocalAiEndpoint` from @tax/core (including Docker host, `.local` and private IPv4 addresses). A cloud endpoint needs both a key and explicit `cloudAcknowledged: true`. The schema uses `strict: false` because Recipe contains optional mappings; optional columns are not rewritten as required strings. No AI SDK is used.

`docker compose --profile ai up -d` starts Ollama too. Pull a model explicitly, for example `docker compose exec ollama ollama pull <model>`, and configure that exact model name. Startup does not download models or contact an AI service.

Imports and report computation retain synchronous HTTP responses. Sync and price-fill jobs run in the background in the same Node process: POST returns 202 `{jobId}` before work starts, and GET `/api/jobs/:id` returns persisted progress, result and status. One sync runs per connection; overlapping requests return 409 `sync_running`. Interrupted jobs and their running connections become failed on boot; retry resumes from persisted cursors. Each connector batch writes raw rows, deduplicated ledger rows and its cursor in one database transaction. Import parsing retains all raw data rows, including rows reported as errors. Generic confirmation applies the selected sheet and reports other sheets as unmapped errors.

Vault setup, unlock, lock, passphrase change and reset are under `/api/vault`. The derived key exists only in memory and is wiped on lock, logout, restart or thirty minutes idle. The async scrypt KDF uses N=2^17, r=8, p=1 and 256 MiB maxmem. AES-GCM authenticates each secret's id and kind. Rotation re-encrypts every secret in a single storage transaction; reset requires exactly `{confirm:"RESET"}` and leaves connections and ledger history intact. `SECRETS_PASSPHRASE` optionally sets up/unlocks on boot. This is weaker because anyone reading the container environment can decrypt the vault. A wrong environment passphrase leaves the vault locked so the user can unlock or reset it.

Provider and exchange keys never appear in API responses; only `keySet` does. `/api/connections` manages exchanges and lower-case Ethereum mainnet addresses. `/check` returns the connector's permission assessment, including `readOnly:false` for keys that can trade. `/sync` starts an explicitly requested job. `/balances` compares fetched quantities against pure engine holdings; fetched balances remain separate from user-entered actual balances. Deleting a connection removes its secrets, cursors and balances while retaining sync imports. Deleting a sync import resets its connection's cursors. Deleting an import that owns cross-channel ledger rows also resets cursors for linked sync imports, allowing a later sync to restore those rows.

Cross-channel file/API dedupe uses normalized fingerprints and persistent raw-row links as a multiset. Each sibling row absorbs one source event; repeated syncs recognize the linked source reference. Near matches are inserted with `possible_duplicate`. An exact CoinDCX file match supplements a missing API-row TDS credit, with an audit warning pointing to its file import; existing deductions and user edits are preserved. Every raw row remains available. Existing fingerprints are backfilled with the same pure core helper during database initialization. Old price-cache rows lack provider identities and day bases; migration preserves them in `price_cache_legacy` without using guessed metadata.

Computing reports reads the price cache and bundled FX only. It never contacts a price service. Prices default off; explicitly enabling Settings `prices.enabled` permits user-started price-fill jobs and fills triggered by user-started syncs. `/api/prices/status?taxYear=...` reports gaps; `/api/prices/fill` requests a fill. Binance public IST daily klines precede CoinGecko Demo snapshots. CoinGecko uses a vault provider key and only the last 365 days. Close and VWAP are separate cache entries; final entries are immutable. Reports record source, provider id, date, day basis and price kind, and warn about UTC snapshots and ticker renames. Uncleared spam is listed in `report.excluded` and contributes no tax or holdings.

Empty `BINANCE_API_BASE`, `BINANCE_DATA_BASE`, `COINDCX_API_BASE`, `ETHERSCAN_API_BASE`, `BLOCKSCOUT_API_BASE` and `COINGECKO_API_BASE` use the connectors' production defaults. Set overrides only for a service the user intends to contact; Docker passes them through. No startup network calls are made.

Reports load all recorded history through the requested IST year end, bundled SBI FX, rules, engine settings and actual balances. Missing FX data remains an explicit warning. Report warnings are merged into transaction/review responses, so engine-generated issues appear after computation. Tax input changes mark the last report stale. Review keeps its report-derived items until the next compute. Exports contain the disclaimer, settings and section-verification status. CSV prefixes formula-leading cells; XLSX writes literal strings. Full exports also contain totals, balances, unresolved items, valuations, warnings and the ledger trail.

`.env.example` lists server variables. Next development reads `apps/web/.env.local`; Docker Compose reads a repository-root `.env`. Keep those and DATA_DIR out of commits. Stop the app before copying a SQLite backup, since WAL may contain recent changes.

Mutation origin checks compare Origin against the request protocol and Host header, so Docker port mappings use the browser's public host and port. Requests without Origin remain available to CLI clients. Forwarded host/protocol headers are deliberately ignored: a directly exposed local app has no trusted proxy boundary that strips client-supplied forwarding headers. TLS-terminating proxies must preserve the original request scheme at that boundary; forwarded headers alone cannot grant origin trust.

Generic ledger identities use `csv:<header fingerprint>` instead of a recipe id. Explicit mapped exchange ids remain source references; otherwise canonical raw-row hashes plus occurrence ordinals preserve identical trades. Pre-release data is not migrated: delete existing generic imports and re-import the original files before relying on cross-version deduplication. Reapply any manual edits after re-import. Existing stored reports should also be recomputed for the corrected balance difference convention.

`GET /api/review` returns:

- `connections: Connection[]`: connections whose last sync failed or was incomplete.
- `reportStatus` is `"stale"` if any requested report is stale, `"missing"` if a requested snapshot is absent, and `"current"` when every requested report is current.
- `reportStatuses` gives the same status per year, in rule order when no filter is supplied.
- `computeTaxYears` lists years whose reports are stale or missing.
- `groups: {code: ReviewCode, severity: "action" | "info", count: number, items: LedgerTx[], reportItems: ReportReviewItem[]}[]`. A code can have separate action and information groups. Each group's count is the sum of its two array lengths.
- `totals: {action: number, info: number}`. Counts the items in each severity across all groups. Import interpretation notes and the CA verification notice are informational.

Report items share `taxYear: string` and `message: string`, with three variants:

- `{kind: "balance", balance: Balance}` for each negative holding (`missing_history`) and each nonzero actual-minus-computed difference (`balance_mismatch`), including assets with no ledger rows. One balance can produce both problems.
- `{kind: "unresolved", unresolved: Unresolved}` for every unresolved slice and reason, including `missing_inr_value`. The corresponding transaction/code is omitted from ledger items. Separate slices remain separate review items.
- `{kind: "warning", warning: ReportWarning}` for report-wide warnings and warnings whose associated transactions lie outside the selected ledger year. The latter retain their original transaction links. Linked warnings on visible ledger rows remain ledger items. Balance warnings are represented only by balance items, so their ledger associations do not inflate counts.

Stale snapshots continue to supply report items. Importer and manual ledger flags can appear before any report is computed. Review groups transaction items once per transaction and code, with the pending reasons in `reviewFlags`.

`POST /api/review/resolve` acknowledges the selected year and code. Supply `txIds` to check linked items or omit it to check the current group, including report items without a transaction. Transaction PATCH with `resolveFlags` records the same acknowledgement for the transaction's currently visible flags. SQLite stores the tax year, review code, transaction or group scope, item fingerprint and optional note. Acknowledgements survive unchanged recomputes, and an item that disappears on a recompute needs a fresh acknowledgement if it returns. New or changed items remain visible. The calculation continues to use the original ledger and computed warnings. Acknowledged items drop out of Review totals immediately.

Review transactions and report review items can include `sourceLabel`. TDS rows expose it alongside the source ID, and the TDS export uses it in the source column. Generic CSV labels use the saved or bundled recipe name when available.

`GET /api/reports/:taxYear` (and export when its report is missing or stale) returns HTTP 404 with `error.code: "report_not_computed"`, `error.message: string`, and `error.details: {invalidatedAt: string | null, cause: "ledger_changed" | "settings_changed" | "balances_changed" | "never_computed"}`. `invalidatedAt` is a UTC ISO timestamp for the first input change after the last compute. `never_computed` has `invalidatedAt: null` when no invalidation has been recorded for that year. The database persists invalidation metadata across restarts; recomputing restores GET to 200. Unsupported rule years still return `not_found`.

`GET /api/reports/:taxYear?allowMissing=true` returns the last computed report with `stale: true` when its inputs have changed. A current report keeps its existing shape. A supported year without a stored snapshot returns HTTP 200 with `{status: "missing", invalidatedAt, cause}`. The report's `incomplete` flag marks provisional totals when there are unresolved disposals. The API serves only resolved slices in `scheduleVdaRows` and keeps unresolved slices available in `unresolved`.

Every import summary endpoint returns `rowsSkipped: number` and `skippedRows: {rowIndex: number, sheet: string, reason: string, kind?: "cancelled_order"}[]`. Row indices are zero-based data-row indices within the named sheet, matching row errors. Reasons include orders with zero executed quantity and statement legs already preserved in a grouped transaction. Raw skipped rows remain in `raw_rows`. For completed imports, `rowsRead = rowsInserted + rowsDuplicate + rowsError + rowsSkipped`, and `rowsSkipped === skippedRows.length`. Pending recipes have not yet classified their rows.

`GET /api/backup` streams a consistent SQLite snapshot and returns its byte count in `X-Backup-Size`. Next.js 16.4.5's Node response bridge strips `Content-Length` when forwarding App Router `Response` headers, so the HTTP download uses chunked transfer.

`ReviewCode` adds `ca_verification_pending` (unverified rule section references), `import_incomplete` (pending/failed imports or excluded row errors), `fx_unavailable` (bundled rate data unavailable), `ambiguous_transfer` (multiple possible transfer matches), and `fee_review_required` (fee tax treatment or fees exceeding consideration). `parse_warning` is reserved for source parsing/interpretation issues. CA verification is a notice and should receive informational styling in the UI. No separate report `notices` array was added. Recompute stored reports to refresh older warning codes.

CSV and each XLSX sheet begin with the disclaimer and contain the same readable metadata: a `Setting,Value` table and a `Section,Reference` table, plus a separate section verification row. Fee treatment, lot scope, rate source, income basis, head of income, percentages, hours and booleans have human-readable values. Formula-leading CSV cells remain escaped; XLSX uses literal strings.

`balances[].difference` is always **actual minus computed**, in coin quantities as a decimal string. Full CSV and XLSX exports write this same field without recalculating it.

Server report `warnings` are grouped by exact code, severity, message, asset, source and import ID when present. Each includes `count` (number of original warnings) and `txIds` (distinct associated ledger ids), retaining `txId` only when exactly one transaction is associated. Transaction/review flags still expand these associations to each affected ledger row.

Report warnings add optional `asset: string` and `source: string` context. Balance mismatch and negative-holding warnings carry the affected asset, a source only for per-source pools, and `txIds` for every ledger row contributing to that balance. A mismatch on an actual-only asset legitimately has `txIds: []`, with `asset`/`source` identifying the problem. A balance warning's `count` is one problem, regardless of the number of ledger links.

Review clients must handle warning, balance and unresolved report-item variants, current, stale and missing report statuses and every review code. Report clients should preserve `report_not_computed` details. Import lists should display skipped-row counts and reasons separately from errors.

The multichain/import handoff is specified field by field in `docs/SPEC-phase2.md` §9. Provider names add Alchemy and NodeReal; Etherscan stores a free/paid tier. Chain ids are exported once as `SUPPORTED_EVM_CHAIN_IDS` from core. Connection views expose nullable `runningJobId` and `lastSyncJobId`; poll their retained `/api/jobs/:id` rows to recover progress and per-stream results after reload.

Imports return report-kind labels, selected/detected timezone and its source, coverage, and import warnings. PDF passwords are optional multipart input only. PDF account statements become balance snapshots, available at `/api/balances/snapshots` and import details, with a year-end apply action. Superseded ledger originals remain stored and appear in report exclusions; deleting their replacing import restores them. `rowsInserted` counts snapshot/TDS records as well as ledger rows.

`ALCHEMY_API_BASE` accepts a URL such as `http://host.docker.internal:11601/alchemy/{network}/v2`; `NODEREAL_API_BASE` accepts `http://host.docker.internal:11601/nodereal`. Connectors append keys. Standalone builds externalize the importer package and trace its PDF worker and PDF.js modules, preserving Node worker URLs.

UI integration: `components/import/RecipeWizard.tsx` currently declares `buildInitialRecipe`'s timezone parameter as `"IST" | "UTC"`. Change it to the shared timezone type (`ImportSummary["timezone"]` or `NonNullable<Recipe["timezone"]>`) to accept the expanded contract. This server task deliberately leaves UI components/pages/client code untouched. Until the UI follow-up, that helper causes two diagnostics in `pnpm typecheck` and blocks a clean Next/Docker build. Cached Next builds may miss these diagnostics.
