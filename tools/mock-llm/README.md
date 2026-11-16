# mock-llm

A stand-in for an OpenAI-compatible `/v1/chat/completions` endpoint, so the import wizard and the
AI recipe path can be exercised without Ollama, a cloud key or a network. Node built-ins only; no
dependency, no install step.

It answers with a **valid `Recipe`** (`packages/core/src/recipe.ts`) built from the headers and
sample rows the app sends, and can fail on purpose in four ways.

## Run it

```sh
node tools/mock-llm/server.mjs --port 11500   # or: PORT=11500 node tools/mock-llm/server.mjs
```

Listens on `0.0.0.0`, so both the host and a Docker container can reach it. On start it prints the
base URL, the models it offers and the active failure mode.

### Local app

`apps/web/src/server/settings.ts` reads these when nothing is stored in Settings:

```sh
# apps/web/.env.local
AI_BASE_URL=http://127.0.0.1:11500/v1
AI_MODEL=mock-recipe
```

`127.0.0.1` counts as a local endpoint, so no API key and no cloud warning are needed.

### Inside Docker Compose

The app container reaches the mock running on your machine through the Docker host alias:

```sh
# repository-root .env (Compose) or the app service environment in docker-compose.yml
AI_BASE_URL=http://host.docker.internal:11500/v1
AI_MODEL=mock-recipe
```

- Docker Desktop (macOS, Windows) resolves `host.docker.internal` out of the box. On Linux add
  `extra_hosts: ["host.docker.internal:host-gateway"]` to the `app` service.
- `host.docker.internal` is not in the app's local-endpoint list (`localhost`, `127.0.0.1`,
  `[::1]`, `ollama`), so the app treats it as a cloud endpoint and insists on a key plus an
  acknowledgement. Set them once:

  ```sh
  curl -X PUT http://localhost:3000/api/settings \
    -H 'content-type: application/json' \
    -d '{"ai":{"baseUrl":"http://host.docker.internal:11500/v1","model":"mock-recipe","apiKey":"mock","cloudAcknowledged":true}}'
  ```

  The mock ignores `Authorization`; any non-empty key works.

## Endpoints

| Method | Path                   | Answer                                                                 |
| ------ | ---------------------- | ---------------------------------------------------------------------- |
| POST   | `/v1/chat/completions` | OpenAI-shaped completion whose `choices[0].message.content` is JSON    |
| GET    | `/v1/models`           | `mock-recipe`, `mock-invalid`, `mock-500`, `mock-slow`, `mock-garbage` |
| GET    | `/__last-request`      | The last chat request body (JSON), or `null` before the first one      |

`/__last-request` is for tests: it holds exactly what the app sent. The app sends the header row
and at most 20 sample rows; the stored copy truncates anything beyond 20 rows and leaves smaller
payloads byte-identical. Request bodies are never logged — only the method, path and model.

## Failure modes

| Mode      | Trigger                                     | What happens                                       |
| --------- | ------------------------------------------- | -------------------------------------------------- |
| `invalid` | `MOCK_MODE=invalid` / `x-mock-mode` / model | 200, JSON content that fails the Recipe schema     |
| `500`     | `MOCK_MODE=500` / `x-mock-mode` / model     | HTTP 500 with `{"error":{...}}`                    |
| `slow`    | `MOCK_MODE=slow` / `x-mock-mode` / model    | Waits 120 s, then answers normally (app times out) |
| `garbage` | `MOCK_MODE=garbage` / `x-mock-mode` / model | 200, content that is not JSON                      |

Model names for the modes are `mock-invalid`, `mock-500`, `mock-slow`, `mock-garbage`; the normal
model is `mock-recipe`. The header accepts the bare mode too (`x-mock-mode: 500`) and any `mock-`
prefix is optional.

Which one wins: `x-mock-mode` header, then a failure mode named in the request's `model`, then
`MOCK_MODE`, then normal. `mock-recipe` is the normal model, so `MOCK_MODE` still applies when the
app is configured with it. `MOCK_MODE` is read per request, so it can be flipped without a restart.
The chosen mode is echoed in the `x-mock-mode` response header.

## How the recipe is derived

The user message is JSON (the app's `sentPayload`): `{sheet, fingerprint, timezone, headers, rows}`.
A plain CSV prompt is also accepted, parsed into the same shape.

- **Columns** — header names are normalised to letters and digits (so `Date(UTC)`, `Txn Date`,
  `UTC_Time`, `Fee Currency`, `Ref No` match) and each role claims the first unused header:
  timestamp, side, pair, base/quote asset, amount, price, total, fee asset, fee amount, TDS, tx hash,
  id. A header is never used twice. Missing roles are omitted, never invented; with no usable amount
  column the first plausible numeric/text header is used so the object still satisfies the schema.
- **Dates** — the format is the first candidate that parses every sample in the timestamp column
  (`yyyy-MM-dd HH:mm:ss`, `dd/MM/yyyy HH:mm`, `dd-MM-yy HH:mm`, ISO with an offset, …). Day/month
  order in slashed dates is checked against real calendar ranges; if both orders fit, DD/MM wins.
- **Side** — sample values of the side column map to `buy`/`sell`/`deposit`/`withdrawal`/`income`.
  Unrecognised values are left out of `sideMap` so the importer reports them instead of guessing.
- **Sign style** — `side_column` when a side column produced a mapping, otherwise
  `negative_is_sell` only if some amount sample is negative.
- **Pair split** — `pairSplit.knownQuotes` is added when a pair column has cells without a `-`, `_`
  or `/` separator (`BTCINR`), using quote values seen in the file plus the usual quote assets.
- **Fingerprint and sheet** — copied verbatim from the request, so the app's own fingerprint and
  header checks pass. `timezone` is copied when it is `IST` or `UTC`.

## Tests

```sh
pnpm --filter @tax/core build
node --test tools/mock-llm/
```

The suite imports `RecipeSchema` from `packages/core/dist`, starts the server in-process on a random
port and checks: both generic fixtures from `packages/importers/test/fixtures/`, every failure mode,
the header/model/env precedence, `/__last-request` exactness and the 20-row cap, and that logs never
contain cell contents.

`tools/mock-llm/package.json` exists only so Node resolves the directory argument to the test file;
on Node 24.18 `node --test <dir>/` loads the directory as a module instead of expanding it.
