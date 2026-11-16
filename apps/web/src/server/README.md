# Phase 1 server

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

Imports and report computation run synchronously inside a persisted in-process job lifecycle. This keeps the existing synchronous HTTP responses and suits a local, single-user application. There is no background queue or jobs endpoint. Interrupted pending/running jobs become failed when the process opens the database again; they are not replayed automatically. Import parsing retains all raw data rows, including rows reported as errors. Generic confirmation applies the selected sheet and reports other sheets as unmapped errors.

Reports load all recorded history through the requested IST year end, bundled SBI FX, rules, engine settings and actual balances. Missing FX data remains an explicit warning. Report warnings are merged into transaction/review responses, so engine-generated issues appear after computation. Data changes invalidate stored reports; recompute to refresh those flags. Exports contain the disclaimer, settings and section-verification status. CSV prefixes formula-leading cells; XLSX writes literal strings. Full exports also contain totals, balances, unresolved items, valuations, warnings and the ledger trail.

`.env.example` lists server variables. Next development reads `apps/web/.env.local`; Docker Compose reads a repository-root `.env`. Keep those and DATA_DIR out of commits. Stop the app before copying a SQLite backup, since WAL may contain recent changes.

Mutation origin checks compare Origin against the request protocol and Host header, so Docker port mappings use the browser's public host and port. Requests without Origin remain available to CLI clients. Forwarded host/protocol headers are deliberately ignored: a directly exposed local app has no trusted proxy boundary that strips client-supplied forwarding headers. TLS-terminating proxies must preserve the original request scheme at that boundary; forwarded headers alone cannot grant origin trust.

Generic ledger identities use `csv:<header fingerprint>` instead of a recipe id. Explicit mapped exchange ids remain source references; otherwise canonical raw-row hashes plus occurrence ordinals preserve identical trades. Pre-release data is not migrated: delete existing generic imports and re-import the original files before relying on cross-version deduplication. Reapply any manual edits after re-import. Existing stored reports should also be recomputed for the corrected balance difference convention.

`GET /api/review` returns:

- `reportStatus: "current" | "missing"`: compatibility aggregate, current only when every requested year has a stored report. The unreachable `"stale"` value has been removed from the schema.
- `reportStatuses: {taxYear: string, status: "current" | "missing"}[]`: one entry for the requested `taxYear`, or every supported year in rule order when no filter is supplied.
- `computeTaxYears: string[]`: exactly the missing years from `reportStatuses`. All-years compute controls must use these years, rather than repeatedly computing the default year.
- `groups: {code: ReviewCode, count: number, items: LedgerTx[], reportItems: ReportReviewItem[]}[]`: count is the sum of both array lengths.

Report items share `taxYear: string` and `message: string`, with three variants:

- `{kind: "balance", balance: Balance}` for each negative holding (`missing_history`) and each nonzero actual-minus-computed difference (`balance_mismatch`), including assets with no ledger rows. One balance can produce both problems.
- `{kind: "unresolved", unresolved: Unresolved}` for every unresolved slice and reason, including `missing_inr_value`. The corresponding transaction/code is omitted from ledger items. Separate slices remain separate review items.
- `{kind: "warning", warning: ReportWarning}` for report-wide warnings and warnings whose associated transactions lie outside the selected ledger year. The latter retain their original transaction links. Linked warnings on visible ledger rows remain ledger items. Balance warnings are represented only by balance items, so their ledger associations do not inflate counts.

All of these items come only from stored, current reports. A missing report can still leave importer/manual ledger flags in Review. `items` are grouped once per transaction/code; their `reviewFlags` retain every distinct message.

`GET /api/reports/:taxYear` (and export when its report is absent) returns HTTP 404 with `error.code: "report_not_computed"`, `error.message: string`, and `error.details: {invalidatedAt: string | null, cause: "ledger_changed" | "settings_changed" | "balances_changed" | "never_computed"}`. `invalidatedAt` is a UTC ISO timestamp for the change that deleted a stored report; subsequent changes while it is missing retain that first reason. `never_computed` has `invalidatedAt: null` when no invalidation has been recorded for that year. The database persists invalidation metadata across restarts; recomputing restores GET to 200. Unsupported rule years still return `not_found`.

Every import summary endpoint now returns `rowsSkipped: number` and `skippedRows: {rowIndex: number, sheet: string, reason: string}[]`. Row indices are zero-based data-row indices within the named sheet, matching row errors. These are intentional Binance statement overlaps with dedicated trade/deposit/withdrawal exports, not errors or duplicates; skip-only imports have no parse warning. Raw skipped rows remain in `raw_rows`. For completed imports, `rowsRead = rowsInserted + rowsDuplicate + rowsError + rowsSkipped`, and `rowsSkipped === skippedRows.length`. Pending recipes have not yet classified their rows. Existing import records default to zero skips; re-import old statements to obtain the new classifications.

`ReviewCode` adds `ca_verification_pending` (unverified rule section references), `import_incomplete` (pending/failed imports or excluded row errors), `fx_unavailable` (bundled rate data unavailable), `ambiguous_transfer` (multiple possible transfer matches), and `fee_review_required` (fee tax treatment or fees exceeding consideration). `parse_warning` is reserved for source parsing/interpretation issues. CA verification is a notice and should receive informational styling in the UI. No separate report `notices` array was added. Recompute stored reports to refresh older warning codes.

CSV and each XLSX sheet begin with the disclaimer and contain the same readable metadata: a `Setting,Value` table and a `Section,Reference` table, plus a separate section verification row. Fee treatment, lot scope, rate source, income basis, head of income, percentages, hours and booleans have human-readable values. Formula-leading CSV cells remain escaped; XLSX uses literal strings.

`balances[].difference` is always **actual minus computed**, in coin quantities as a decimal string. Full CSV and XLSX exports write this same field without recalculating it.

Server report `warnings` are grouped by exact code, message, asset and source. Each includes `count` (number of original warnings) and `txIds` (distinct associated ledger ids), retaining `txId` only when exactly one transaction is associated. Transaction/review flags still expand these associations to each affected ledger row.

Report warnings add optional `asset: string` and `source: string` context. Balance mismatch and negative-holding warnings carry the affected asset, a source only for per-source pools, and `txIds` for every ledger row contributing to that balance. A mismatch on an actual-only asset legitimately has `txIds: []`, with `asset`/`source` identifying the problem. A balance warning's `count` is one problem, regardless of the number of ledger links.

The UI follow-up must update `apps/web/src/components/ReviewClient.tsx`: line 48 and lines 355/385
assume every non-balance report item has `unresolved`; handle `kind: "warning"` separately and use its
message and warning links. Lines 159, 174, 211, 216 and 230 compare against the removed `"stale"`
status. `apps/web/src/lib/client/review-codes.ts:12` must add metadata for all five new codes. Those
are the only TypeScript failures from this server contract change (11 diagnostics total). Overview
and Report should preserve `error.details` on `report_not_computed` and explain the cause. Import
summaries/lists should show skips separately from row errors and render their reasons.
