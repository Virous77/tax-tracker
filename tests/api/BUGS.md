# API defects found by `tests/api`

Run on 2026-11-16 against image `tax-tracker-app:local` built from `main` at `f12dd07`.
Result: **286 tests, 283 pass, 3 fail.** Each failure below is an app defect; the tests are left failing on purpose.

## 1. High — generic imports are not idempotent: the same file can be imported twice

- **Endpoint:** `POST /api/imports/:id/confirm`
- **Test:** `04-recipes.test.ts › the same generic file confirmed twice with differently-named recipes does not double the ledger`
- **Repro:**
  1. Upload `tests/data/out/generic-ddmmyyyy.csv` (`source=auto`, `timezone=IST`), so the import is `pending_recipe`.
  2. Confirm it with a recipe whose `id` is `layout-a`. 4 rows are inserted.
  3. Upload the same file again and confirm it with the same recipe, this time with `id: "layout-b"`.
- **Expected:** the second confirm gives `rowsInserted 0, rowsDuplicate 4`, and the ledger keeps 4 rows (AGENTS.md rule 7: the same file imported twice gives the same ledger).
- **Actual:** the second confirm gives `rowsInserted 4, rowsDuplicate 0`. The ledger has 8 rows, so every trade in the file is counted twice in the tax figures.
- **Cause:** `packages/importers/src/generic.ts:77` sets `source` to `csv:${recipe.id}`, and dedupe uses `(source, sourceRef)`. Two imports of one file produce different keys if the recipe id is different. That happens when the AI suggests a new id, when a recipe is deleted and recreated, or when the user writes the recipe by hand. The id should not be part of the dedupe key; the recipe fingerprint, or `csv:generic`, would stay the same across imports.

## 2. Low — settings accept a default tax year that has no rule file

- **Endpoint:** `PUT /api/settings`
- **Test:** `01-health-settings.test.ts › settings › PUT rejects bad tax year with 400`
- **Repro:** `curl -X PUT localhost:3101/api/settings -H 'content-type: application/json' -d '{"defaultTaxYear":"2030-31"}'`
- **Expected:** 400 `validation_error`. Only `2025-26` and `2026-27` exist in `GET /api/tax-years`.
- **Actual:** 200, and `defaultTaxYear` is stored as `"2030-31"`. Every compute for that year then fails with 404 "Rules are unavailable for this tax year.", so the UI would open on a year it cannot compute.
- **Cause:** `TaxYearSchema` (`packages/core/src/ledger.ts:24`) checks only the `YYYY-YY` shape. `apps/web/src/server/settings.ts:81` stores the value without checking it against the years in `listTaxYears()`.

## 3. Low — an oversize upload returns a different 413 message than documented

- **Endpoint:** `POST /api/imports`
- **Test:** `03-edge-data.test.ts › huge.csv → 413 file_too_large 'File exceeds 25 MB.'`
- **Repro:** `curl -F file=@tests/data/out/huge.csv -F source=binance -F timezone=UTC localhost:3101/api/imports`
- **Expected (tests/data/README.md):** `413 file_too_large "File exceeds 25 MB."`
- **Actual:** `413 file_too_large "Request exceeds the upload limit."` The status and code are correct; only the user-facing message differs.
- **Cause:** `apps/web/src/server/http.ts:76-79`. The `content-length` pre-check in `readBody` fires before the per-file check at line 39, which is the one that has the documented message.

## Observations (not counted as defects)

- **Logout:** sessions are stateless HMAC tokens. `POST /api/auth/logout` clears the cookie, but a copied token stays valid until it expires 12 hours later. This is acceptable for a local single-user app; noted for the auth design.
- **Wrong explicit source:** for example, a Binance CSV uploaded with `source=coindcx`. The import is stored as `status: "imported"` with every row reported as an error and 0 inserted. Nothing is guessed, but a 422 "this file does not look like CoinDCX" would be clearer.
- **Suggest on a finished import:** `POST /api/recipes/suggest` on an import that is already `imported` still sends that file's sample rows to the AI and returns 200.
- **AI errors:** an AI reply that fails the recipe schema, or is not JSON, gives `422 invalid_ai_recipe`. HTTP 500, an unreachable endpoint and a 30-second timeout give `502 ai_unavailable`. All are clean envelopes, and the tests assert these codes.

## Coverage

| Area                               | File                         | Tests   | Pass    | Fail  |
| ---------------------------------- | ---------------------------- | ------- | ------- | ----- |
| Health, tax years, settings        | `01-health-settings.test.ts` | 28      | 27      | 1     |
| Imports (fixtures, dedupe, delete) | `02-imports.test.ts`         | 36      | 36      | 0     |
| tests/data edge-case pack          | `03-edge-data.test.ts`       | 14      | 13      | 1     |
| Generic recipe + mock AI flow      | `04-recipes.test.ts`         | 23      | 22      | 1     |
| Transactions                       | `05-transactions.test.ts`    | 54      | 54      | 0     |
| Review groups                      | `06-review.test.ts`          | 10      | 10      | 0     |
| Reports, golden cases, balances    | `07-reports.test.ts`         | 29      | 29      | 0     |
| Exports (CSV/XLSX × 4 kinds)       | `08-exports.test.ts`         | 19      | 19      | 0     |
| Auth (`APP_PASSWORD`)              | `09-auth.test.ts`            | 35      | 35      | 0     |
| Security / robustness              | `10-security.test.ts`        | 31      | 31      | 0     |
| Research-flagged behaviours        | `11-research.test.ts`        | 7       | 7       | 0     |
| **Total**                          |                              | **286** | **283** | **3** |

## Not covered

- **Recipe preview `checks` for Binance edge files.** tests/data/README lists `datesOk` and `negativeBalances` for `binance-large`, `malformed`, `duplicates` and `sell-without-buy`. Preview applies only to generic recipes, so the HTTP API cannot produce those checks for a Binance import. The counts and row errors are asserted instead, and missing history is asserted through compute and review.
- **XLSX numeric text** such as `9074.400000000001` getting a `parse_warning` (libraries.md). No fixture contains it, and building a workbook would need a ZIP writer in the tests.
- **Brute-force lock expiry** (15 minutes) and **cookie expiry** (12 hours). Testing them would need clock control inside the container.
- **The `Secure` cookie flag**, which is set only on HTTPS. The stack serves plain HTTP.
