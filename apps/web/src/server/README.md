# Phase 1 server

All public endpoints use the existing `@tax/core/api` request and response schemas. There are no HTTP contract changes. Thin route modules call a shared validator and services. Requests and downloads use `Cache-Control: no-store`. Errors use the shared envelope, with 400/404/409/413/422/500 and 502 `ai_unavailable`; password authentication additionally uses 401/403/429.

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

`DATA_DIR` defaults to `./data` relative to the process (therefore `apps/web/data` for `pnpm --filter @tax/web dev`). Docker fixes it to `/data` with a `./data:/data` bind mount. `DATA_HOST_DIR` optionally overrides that host path; Docker Desktop must have access to it. A one-shot data-init service assigns the bind directory to the app UID (1000), allowing a clean Linux clone to start without running the app as root. Use an absolute DATA_DIR to share a development database between commands. Optional `APP_PASSWORD` gates pages and APIs; `/login`, login/logout and health remain public. `APP_SECRET` optionally supplies the HMAC secret; otherwise a secret is created privately in DATA_DIR. Cookies are httpOnly, SameSite=Strict, expire after twelve hours and use Secure on HTTPS. Ten failed login attempts lock the process's login endpoint for fifteen minutes. Restarting a single-user server clears this in-memory rate limit.

AI configuration defaults to `AI_BASE_URL=http://ollama:11434/v1`, `AI_MODEL` and optional `AI_API_KEY`, with saved settings taking precedence. The API key never appears in settings or preview responses. The exact JSON payload preview contains headers and at most twenty sample rows; requesting a suggestion is the only action that calls the configured endpoint. Redirects are rejected, response reads are bounded, requests time out after thirty seconds, and Zod validates results. A non-localhost/non-ollama endpoint needs both a key and explicit `cloudAcknowledged: true`. The schema uses `strict: false` because Recipe contains optional mappings; optional columns are not rewritten as required strings. No AI SDK is used.

`docker compose --profile ai up -d` starts Ollama too. Pull a model explicitly, for example `docker compose exec ollama ollama pull <model>`, and configure that exact model name. Startup does not download models or contact an AI service.

Imports and report computation run synchronously inside a persisted in-process job lifecycle. This keeps the existing synchronous HTTP responses and suits a local, single-user application. There is no background queue or jobs endpoint. Interrupted pending/running jobs become failed when the process opens the database again; they are not replayed automatically. Import parsing retains all raw data rows, including rows reported as errors. Generic confirmation applies the selected sheet and reports other sheets as unmapped errors.

Reports load all recorded history through the requested IST year end, bundled SBI FX, rules, engine settings and actual balances. Missing FX data remains an explicit warning. Report warnings are merged into transaction/review responses, so engine-generated issues appear after computation. Data changes invalidate stored reports; recompute to refresh those flags. Exports contain the disclaimer, settings and section-verification status. CSV prefixes formula-leading cells; XLSX writes literal strings. Full exports also contain totals, balances, unresolved items, valuations, warnings and the ledger trail.

`.env.example` lists server variables. Next development reads `apps/web/.env.local`; Docker Compose reads a repository-root `.env`. Keep those and DATA_DIR out of commits. Stop the app before copying a SQLite backup, since WAL may contain recent changes.
