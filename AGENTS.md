# Tax Tracker — agent rules

Free, open-source, self-hosted helper that turns crypto (Binance, CoinDCX, EVM) and US-stock
history into the rows the Indian income-tax return asks for (Schedule VDA, TDS, Form 67, Schedule FA).
The full build spec is `docs/SPEC.md`. Read it before writing code. It wins over your own assumptions.

## Non-negotiables

1. **Supply chain.** Use pnpm only. `pnpm-workspace.yaml` sets `minimumReleaseAge: 14400` (10 days)
   and `savePrefix: ''`. Never remove or weaken that. Never use `npm`/`yarn`/`npx <pkg>` to fetch
   packages and never install from git URLs or tarball URLs. Before adding a dependency, ask whether
   ~50 lines of our own code would do; prefer the standard library and packages already in the repo.
   Install scripts are blocked except the allow-list in `onlyBuiltDependencies`.
2. **Money.** Never use JS `number` for money or coin amounts. Use `decimal.js` (via helpers in
   `@tax/core`) and store/transport amounts as decimal strings.
3. **Tax rules live in data**, in `packages/rules`, one file per tax year. No rate, threshold or
   section number may be hard-coded in engine or app code.
4. **Engine is pure.** `packages/engine` has no I/O, no network, no DB, no Date.now(). Same input →
   same output.
5. **Never guess silently.** Uncertain data gets a `reviewFlags` entry, never a made-up value.
   Selling a coin with no buy history is flagged, never given zero cost silently.
6. **Never throw away the original.** Every imported row keeps its raw source row.
7. **Idempotent imports.** Same file imported twice → same ledger (dedupe on `source` + `sourceRef`).
8. **Privacy.** No telemetry, analytics or calls home. Outgoing network only for features the user
   turned on. Never log secrets or API keys.

## Code style

- TypeScript strict everywhere, ESM, Node 24. Formatter/linter: Biome (`pnpm lint`).
- Clean, small modules with one job each. Names that explain themselves.
- Comments only where they add something the code can't say (a tax-law reason, a non-obvious
  edge case, a source link). No narrating comments, no commented-out code, no banner comments.
- Validate at boundaries with Zod schemas from `@tax/core`; trust types inside.
- Tests with Vitest next to the package (`packages/x/test/**`). Golden tax cases must never be
  edited to make a failing build pass without a written reason in the commit.

## Repo layout

```
packages/core       shared Zod schemas: ledger transaction, recipe, settings, API contract, decimal helpers
packages/rules      one JSON rule file per regime + tax year, with a loader and schema
packages/engine     pure tax engine: transfer matching, valuation, lots, schedule rows, totals
packages/rates      bundled SBI TT buying rate table + lookup (last published rate on/before date)
packages/importers  Binance, CoinDCX, generic CSV (recipe-driven) parsers → ledger rows
packages/recipes    shared CSV recipes (JSON) contributed by users
packages/db         Drizzle + SQLite schema, migrations, repositories
apps/web            Next.js 16 app: UI + /api route handlers + in-process job runner
apps/cli            run engine/importers from the terminal
```

Internal package names are `@tax/<folder>`, consumed as workspace deps (`"workspace:*"`).

## Commands

```
pnpm install            # respects the 10-day cooldown
pnpm test               # all package tests
pnpm typecheck
pnpm lint
docker compose up --build
```

Do not commit unless your task says so. Never commit `data/`, `.env`, or real user exports.
