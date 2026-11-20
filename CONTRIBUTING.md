# Contributing

Thank you for helping. The most useful contribution is usually small: a **CSV recipe** for an exchange you use, a
redacted header row for an export the app cannot read yet, or a bug report with a synthetic file that reproduces it.

By taking part you agree to the [Code of Conduct](CODE_OF_CONDUCT.md). Contributions are licensed under
[AGPL-3.0-only](LICENSE).

> [!CAUTION]
> **Never commit or paste real data.** No real export rows, account or order ids, API keys, wallet addresses,
> e-mail addresses, PAN numbers or screenshots of your account, not even "just the header and one row". Headers
> are fine; every value below them must be invented. The `data/` folder is gitignored; keep it that way.

## Dev setup

You need Node 24 and pnpm (the version is pinned in `package.json` `packageManager`; `corepack enable` picks it up).

```sh
git clone https://github.com/Virous77/tax-tracker.git
cd tax-tracker
corepack enable
pnpm install
pnpm -r build                    # packages export from dist/, so build before running the app or tests
pnpm --filter @tax/web dev       # http://localhost:3000, data in apps/web/data
```

For the dev server, put environment variables in `apps/web/.env.local` (same names as `.env.example`). Docker:
`docker compose up -d --build`.

Repository layout and data flow: [docs/architecture.md](docs/architecture.md). The build specs in `docs/SPEC*.md`
are authoritative; read the relevant one before changing behaviour.

## Rules

These come from [AGENTS.md](AGENTS.md) and are not negotiable.

1. **Supply chain.**
   - Use **pnpm only**. Never `npm install`, `yarn` or `npx <pkg>` to fetch packages; never install from git or
     tarball URLs.
   - `pnpm-workspace.yaml` sets `minimumReleaseAge: 14400`: pnpm will not resolve a version published less than
     **10 days** ago. Never remove or weaken it, and never set `savePrefix` to anything but `''` (exact versions).
   - Before adding a dependency, ask whether ~50 lines of our own code would do. Prefer the standard library and
     packages already in the repo. Install scripts are blocked except the `onlyBuiltDependencies` allow-list.
2. **Money.** Never use a JS `number` for money or coin amounts. Use the `decimal.js` helpers in `@tax/core` and
   store and transport amounts as decimal strings.
3. **Tax rules live in data** in `packages/rules`, one file per tax year. No rate, threshold or section number in
   engine or app code.
4. **The engine is pure.** No I/O, network, database or `Date.now()` in `packages/engine`.
5. **Never guess silently.** Uncertain data gets a `reviewFlags` entry, never a made-up value. Selling a coin with no
   buy history is flagged, never given zero cost.
6. **Never throw away the original.** Every imported row keeps its raw source row.
7. **Idempotent imports.** The same file imported twice gives the same ledger (dedupe on `source` + `sourceRef`).
8. **Privacy.** No telemetry or calls home. Outgoing network only for features the user turned on. Never log secrets
   or API keys.

Code style: TypeScript strict, ESM, Node 24, Biome for formatting and linting. Small modules with one job and
names that explain themselves. Comments only where they add something the code cannot say (a tax-law reason, an
edge case, a source link). Validate at boundaries with the Zod schemas from `@tax/core`.

## Tests

```sh
pnpm test          # unit and golden tests (Vitest) in every package
pnpm typecheck
pnpm lint          # Biome; `pnpm format` fixes formatting
pnpm recipes:check # every library recipe against its sample
```

Tests live next to each package in `packages/<name>/test/`. Two slower suites run against Docker:

- `pnpm test:api`: black-box HTTP tests; setup in [tests/api/README.md](tests/api/README.md).
- `pnpm test:e2e`: Playwright browser tests in `tests/e2e`.

They use the mock servers in `tools/mock-sync` (Binance, CoinDCX, explorers, CoinGecko) and `tools/mock-llm`
(an OpenAI-compatible endpoint), so no real network or key is ever needed.

## Adding a CSV recipe

A recipe tells the generic importer how to read one exchange's CSV/XLSX layout. It is a JSON file, no code. Shared
recipes live in `packages/recipes/library/<id>/`:

```
packages/recipes/library/<id>/
  recipe.json     the mapping, validated by RecipeSchema (@tax/core)
  sample.csv      synthetic rows, at most 20, header exactly as the exchange exports it
  expected.json   the ledger rows that sample.csv must produce
  README.md       source, how to export, quirks, verified: true|false
```

### Step by step

Worked example: a made-up exchange "ExampleX" whose trade export has this header.

```
Time (UTC),Market,Side,Filled,Avg Price,Total,Fee,Fee Coin,Order No
```

1. **Get the header only.** Open your real export, copy **just the header row**, and close the file. Nothing else
   from it goes into the repository.

2. **Scaffold the folder.** Use a lower-case id with the venue, the export and a version:

   ```sh
   pnpm recipes:new examplex-trades-v1 --header "Time (UTC),Market,Side,Filled,Avg Price,Total,Fee,Fee Coin,Order No"
   ```

   This creates the folder with a `recipe.json` whose `fingerprint` is computed from the header (empty column
   mappings for you to fill), a `sample.csv` holding only the header, an empty `expected.json` and a README
   template. Do not edit the fingerprint by hand; it is how the app recognises the file. Use
   [`library/generic-trades-v1`](packages/recipes/library/generic-trades-v1/) as a complete model.

   Ids are unique. If the folder already exists, `recipes:new` stops with a one-line error and changes nothing:
   pick another id (bump the version, `-v2`, for a new layout of the same export) or edit the existing folder.

3. **Fill in `recipe.json`.** Map each ledger field to a column. The app's recipe wizard (Import → Other CSV) can
   build this interactively, with or without the AI assistant, and show you a 10-row preview; copy the result.

   ```json
   {
   	"id": "examplex-trades-v1",
   	"name": "ExampleX trade history",
   	"version": 1,
   	"fingerprint": "<written by recipes:new>",
   	"sheet": "CSV",
   	"columns": {
   		"timestamp": "Time (UTC)",
   		"pair": "Market",
   		"side": "Side",
   		"amount": "Filled",
   		"price": "Avg Price",
   		"total": "Total",
   		"feeAmount": "Fee",
   		"feeAsset": "Fee Coin",
   		"id": "Order No"
   	},
   	"dateFormat": "yyyy-MM-dd HH:mm:ss",
   	"timezone": "UTC",
   	"signStyle": "side_column",
   	"sideMap": { "BUY": "buy", "SELL": "sell" },
   	"pairSplit": { "knownQuotes": ["INR", "USDT", "BTC"] }
   }
   ```

   Field notes: `signStyle` is `side_column` when a column says buy/sell, `negative_is_sell` when sells are negative
   amounts. `pairSplit.knownQuotes` splits a joined pair like `BTCINR`; use `baseAsset`/`quoteAsset` instead when
   the file has separate columns. Set `timezone` only if the export always uses one zone; otherwise users choose it
   at import. Map `tds` if the exchange deducts Indian TDS, and `id` whenever there is a stable trade or order id
   (it becomes the dedupe key).

4. **Write `sample.csv`** by hand: the exact header, then up to 20 **invented** rows that cover what the format
   can contain: a buy, a sell, a fee in a third coin, an INR pair and a USDT pair, a value with many decimals.

   ```csv
   Time (UTC),Market,Side,Filled,Avg Price,Total,Fee,Fee Coin,Order No
   2025-05-01 10:00:00,BTCINR,BUY,0.01,5000000,50000,50,INR,EX-0001
   2025-08-15 14:30:00,BTCINR,SELL,0.004,6000000,24000,24,INR,EX-0002
   2025-09-01 09:15:00,ETHUSDT,BUY,0.5,3000,1500,0.0005,BNB,EX-0003
   ```

   Use round numbers, obviously fake ids, no wallet addresses (unless one of the documented test addresses) and no
   e-mails. `recipes:check` rejects samples that look real.

5. **Write `expected.json`**: an array with one ledger row per sample row, in the same order, without the generated
   `id`. Every sample row must produce exactly one ledger row and no row errors. Samples are read as UTC unless the
   recipe sets `timezone`. Work each value out by hand from the sample, as a reviewer will, then let
   `recipes:check` confirm it (step 7). For the three sample rows above, the importer produces exactly this (the
   `source` is `csv:` plus the `fingerprint` from your `recipe.json`; yours differs if your header does):

   ```json
   [
   	{
   		"source": "csv:c510689a86e9639c3631338542298c03821c7a1cefb99eb7f590b49601363f5e",
   		"sourceRef": "EX-0001",
   		"importId": null,
   		"timestamp": "2025-05-01T10:00:00.000Z",
   		"type": "buy",
   		"assetIn": "BTC",
   		"amountIn": "0.01",
   		"assetOut": "INR",
   		"amountOut": "50000",
   		"feeAsset": "INR",
   		"feeAmount": "50",
   		"inrValue": "50000",
   		"inrRateSource": "trade_inr",
   		"priceQuote": { "asset": "INR", "price": "5000000" },
   		"raw": {
   			"Time (UTC)": "2025-05-01 10:00:00",
   			"Market": "BTCINR",
   			"Side": "BUY",
   			"Filled": "0.01",
   			"Avg Price": "5000000",
   			"Total": "50000",
   			"Fee": "50",
   			"Fee Coin": "INR",
   			"Order No": "EX-0001"
   		},
   		"reviewFlags": []
   	},
   	{
   		"source": "csv:c510689a86e9639c3631338542298c03821c7a1cefb99eb7f590b49601363f5e",
   		"sourceRef": "EX-0002",
   		"importId": null,
   		"timestamp": "2025-08-15T14:30:00.000Z",
   		"type": "sell",
   		"assetIn": "INR",
   		"amountIn": "24000",
   		"assetOut": "BTC",
   		"amountOut": "0.004",
   		"feeAsset": "INR",
   		"feeAmount": "24",
   		"inrValue": "24000",
   		"inrRateSource": "trade_inr",
   		"priceQuote": { "asset": "INR", "price": "6000000" },
   		"raw": {
   			"Time (UTC)": "2025-08-15 14:30:00",
   			"Market": "BTCINR",
   			"Side": "SELL",
   			"Filled": "0.004",
   			"Avg Price": "6000000",
   			"Total": "24000",
   			"Fee": "24",
   			"Fee Coin": "INR",
   			"Order No": "EX-0002"
   		},
   		"reviewFlags": []
   	},
   	{
   		"source": "csv:c510689a86e9639c3631338542298c03821c7a1cefb99eb7f590b49601363f5e",
   		"sourceRef": "EX-0003",
   		"importId": null,
   		"timestamp": "2025-09-01T09:15:00.000Z",
   		"type": "swap",
   		"assetIn": "ETH",
   		"amountIn": "0.5",
   		"assetOut": "USDT",
   		"amountOut": "1500",
   		"feeAsset": "BNB",
   		"feeAmount": "0.0005",
   		"priceQuote": { "asset": "USDT", "price": "1" },
   		"raw": {
   			"Time (UTC)": "2025-09-01 09:15:00",
   			"Market": "ETHUSDT",
   			"Side": "BUY",
   			"Filled": "0.5",
   			"Avg Price": "3000",
   			"Total": "1500",
   			"Fee": "0.0005",
   			"Fee Coin": "BNB",
   			"Order No": "EX-0003"
   		},
   		"reviewFlags": []
   	}
   ]
   ```

   How each field is worked out:
   - `timestamp`: the sample time read in the recipe's zone, written as UTC ISO with milliseconds.
   - `sourceRef`: the mapped `id` column. Without one, it is a hash of the row, which is harder to write by hand.
   - **INR pairs** (`BTCINR`) are a `buy` or `sell`. The coin is on one side and INR on the other, `inrValue` is the
     `Total`, `inrRateSource` is `trade_inr`, and `priceQuote` is the `Avg Price` in INR per coin.
   - **Crypto-to-crypto pairs** (`ETHUSDT`, `ETHBTC`) are a `swap`, with no `inrValue` and no `inrRateSource`: the
     engine values them in rupees later (USDT × USD/INR, or a cached price), according to the user's settings.
     **`priceQuote` is the price of the coin you give up (`assetOut`), in the quote asset.** So:
     - a **BUY** of `ETHUSDT` gives up USDT, and USDT priced in USDT is `"1"`, whatever the `Avg Price` says;
     - a **SELL** of `ETHUSDT` at 3500 gives up ETH, so it is `{ "asset": "USDT", "price": "3500" }`, with
       `assetIn: "USDT"` and `assetOut: "ETH"`.

     Writing the `Avg Price` (`3000`) for the buy is the most common mistake; `recipes:check` then reports
     `rows[2].priceQuote.price: expected "3000", received "1"`.
   - Fees are copied as they are (`feeAsset`, `feeAmount`). A fee in a third coin (BNB here) is not converted.
   - `raw` is the sample row exactly as text, keyed by the header. `reviewFlags` is `[]` unless the importer flags
     the row; a flag you did not expect usually means a wrong mapping.
   - Amounts are decimal strings (`"0.01"`), never JSON numbers.

6. **Write `README.md`**: the exchange, the export's menu path, the formats it comes in, time zone, quirks (units
   in cells, superscripts in headers, split files), and a line `verified: false`. It becomes `verified: true` only
   after someone confirms the header against a real, current export. If the sample needs a wallet address, invent
   one and list it on a line ``Test addresses: `0x…` ``; any other `0x` address fails the check.

7. **Check it.** After adding or changing a recipe, run:

   ```sh
   pnpm recipes:check   # validates every library recipe and compares each sample with its expected.json
   pnpm test            # all package tests, including the recipe library test
   pnpm lint
   ```

   `recipes:check` validates every `recipe.json`, runs each sample through the generic importer and compares the
   result with `expected.json`. When they differ, it lists every differing field with the value you wrote and the
   value the importer produced, for example
   `rows[2].priceQuote.price: expected "3000", received "1"`. It also checks that each `id` matches its folder, that
   fingerprints are unique, the row count (1 to 20), the `verified:` line, and that samples hold no e-mail addresses
   or undocumented wallet addresses. `pnpm test` reads the library folder directly, so a new recipe is picked up
   without rebuilding. The same checks run in CI.

8. **Open a pull request.** In the description, say where the header came from (your own export, the exchange's
   help page) and on what date. If you only have a header and no time to write a recipe, open a **recipe request**
   issue with the header row alone.

## Adding an importer

Write a dedicated importer (in `packages/importers`) only when a recipe cannot express the format: several sheets
with different meanings, an operation-per-row statement, amounts with units glued on, or a PDF. Then:

1. Add the header samples you found to `docs/research/export-samples/` (synthetic values) and the format notes to
   `docs/research/export-catalogue.md`, with the source and date. A full synthetic example file for users to try
   goes in `examples/`, listed in `examples/README.md`.
2. Add a report kind: a header detector (by header, never by file extension) and a parser that returns `LedgerTx`
   rows. Keep the `raw` row, use the exchange's id as `sourceRef` (or the package's canonical row hash), and account
   for every input row: `rowsRead = transactions + rowErrors + skippedRows`.
3. Add its label to `REPORT_KIND_LABELS`, and mark tolerant mappings `verified: false`.
4. Flag what you cannot be sure of (`unknown_type`, `parse_warning`, `ambiguous_timezone`, `fee_review_required`);
   never guess values. Derivatives are imported and flagged, never taxed.
5. Add synthetic fixtures and tests, including overlap with the venue's other exports
   (`reconcileReportKinds`).

Parsers make no network calls. Exchange **API** connectors belong in `packages/sync` or `packages/evm`, implement the
`Connector` contract in `packages/core`, and get a matching mock in `tools/mock-sync`.

## Tax rule changes need CA review

Changes to `packages/rules/data/`, to the engine's tax logic, or to any default that decides how much tax someone
pays need review by a **Chartered Accountant** before release. In the PR:

- quote the primary source (Act, Rules, CBDT circular or notification, ITR validation rules) with a link and the
  date you read it;
- update `docs/research/tax-open-questions.md` if an open question is affected;
- never set `sectionsVerified: true` without a CA's written confirmation.

Where the law is unclear, add a **setting** with the conservative default rather than changing behaviour for
everyone.

## Golden tests

`packages/engine/test/golden/<nn>-<name>/` (and `test/phase2-golden/`) hold `input.json`, `expected.json` and a
README with the arithmetic done by hand. They are the contract for the tax maths.

- **Never edit a golden `expected.json` to make a failing build pass.** If an expectation is genuinely wrong, fix it
  in its own commit whose message explains why, with the corrected hand arithmetic in the README.
- New behaviour gets a new golden case, with the arithmetic written out first.

## Commits and pull requests

- One logical change per PR. Short imperative commit subjects that say what changed.
- Link the issue. Describe what you checked by hand.

PR checklist:

- [ ] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass (and `pnpm recipes:check` for recipe changes).
- [ ] No real data: no real rows, ids, keys, addresses, e-mails or account screenshots in code, tests, fixtures or the
  PR text.
- [ ] Packages installed with pnpm only; no new dependency, or the PR explains why ~50 lines of our own would not
  do. The 10-day cooldown is untouched.
- [ ] Amounts use decimal strings and `@tax/core` helpers, never JS numbers.
- [ ] No rate, threshold or section number in code; rule changes cite a source and are marked for CA review.
- [ ] Uncertain data raises a review flag; original rows are kept; imports stay idempotent.
- [ ] No new outgoing network call, or it is opt-in, documented in the README's Privacy section, and has a mock.
- [ ] No secrets in logs.
- [ ] Golden expectations unchanged, or changed in a separate commit with a written reason.
- [ ] Docs updated (user guide, install guide, CHANGELOG `[Unreleased]`).
