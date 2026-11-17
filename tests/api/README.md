# API tests

Black-box HTTP tests against a running Docker stack. Every 2xx body is validated with the contract
schemas from `packages/core/dist/api` and every error with the `{error:{code,message}}` envelope.

```sh
pnpm -r build                                   # contract schemas come from packages/core/dist
node tests/data/generate.mjs                    # edge-case files in tests/data/out/
D=$(mktemp -d /private/tmp/taxapi-XXXX)
APP_PORT=3101 DATA_HOST_DIR=$D docker compose -p taxapi up -d --no-build
node tools/mock-llm/server.mjs --port 11501 &   # reached from the container via host.docker.internal
pnpm test:api
docker compose -p taxapi down
```

Files run one at a time against one database; each file wipes the ledger, recipes, balances and
settings through the API before it starts. `09-auth.test.ts` recreates the `taxapi` app container
with `APP_PASSWORD` on a fresh data dir and recreates it again without a password afterwards.

Environment: `BASE_URL` (default `http://localhost:3101`), `APP_PORT`, `COMPOSE_PROJECT` (`taxapi`),
`MOCK_PORT` (11501), `MOCK_FROM_APP` (default `http://host.docker.internal:<MOCK_PORT>/v1`).

Known app defects are kept as failing tests and listed in `BUGS.md`.

## Phase 2 (`14-*` … `23-*`)

Sync tests need `tools/mock-sync/server.mjs` and `weight-proxy.mjs` (Binance only; see `BUGS.md`
P2-API-1), and the env in `phase2.env` (compose project `taxapi2`, port 3111, all `*_API_BASE`
overrides). Load it with `set -a && . tests/api/phase2.env && set +a` before `docker compose up` and
`pnpm test:api`. `API_BASE_URL` replaces `BASE_URL`, which Vite overwrites. The full suite takes about
35 minutes, mostly Binance syncs walking history from 2017.
