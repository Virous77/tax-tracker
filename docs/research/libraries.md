# Dependency choices under the 10-day cooldown

Checked 2026-11-16 12:58 UTC. `minimumReleaseAge: 14400` means a version is installable only if published on or before
**2026-11-06 12:58 UTC**. pnpm applies this by itself; the "eligible" column is what it will resolve today.

How each column was obtained:

- Versions and dates: `npm view <pkg> time --json` (registry metadata only, nothing installed).
- Weekly downloads: `api.npmjs.org/downloads/point/last-week` for 2026-11-09 → 2026-11-15.
- Advisories: npm registry bulk advisory endpoint (`/-/npm/v1/security/advisories/bulk`) for the exact eligible version.
  GitHub's advisory API and OSV.dev were unreachable from this machine, so there is one source, not two.
- Install scripts / native code: `scripts`, `gypfile`, `dependencies`, `optionalDependencies` fields of the eligible version. No tarball was downloaded, so "ships prebuilt binaries" is inferred from metadata.
- Node facts: run locally on Node v24.18.1.

## Summary of decisions

| Need                            | Decision                                                                                                                                                                            | Deps added            |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| Money maths                     | `decimal.js@10.6.0`                                                                                                                                                                 | 1                     |
| Validation                      | `zod@4.6.7` (v4; `z.toJSONSchema()` built in, so no schema-converter package). **The repo pins 4.1.12, which has an open high advisory: bump**                                      | 1                     |
| Database                        | `drizzle-orm@0.45.4` + `better-sqlite3@13.0.3`; `drizzle-kit@0.31.11` as dev-only. `node:sqlite` not yet (Drizzle support is pre-release only)                                      | 2 + 1 dev             |
| Dates                           | **write our own** (two fixed zones, about 80 lines); no date library                                                                                                                | 0                     |
| CSV read                        | keep the strict parser already in `spreadsheet.ts` (throws on a stray or unclosed quote, strips BOM); `csv-parse@7.0.3` if delimiter sniffing is ever needed                        | 0                     |
| CSV write                       | **write our own** (about 15 lines, with formula-injection guard)                                                                                                                    | 0                     |
| XLSX read                       | keep the reader already in `packages/importers/src/spreadsheet.ts` (`fflate@0.8.3` + `fast-xml-parser@5.12.0`, `parseTagValue: false`); `read-excel-file@9.3.14` is the alternative | 2 (already installed) |
| XLSX write                      | keep the writer already in `spreadsheet.ts` (`fflate` `zipSync`); `write-excel-file@4.1.1` if styling is ever wanted                                                                | 0                     |
| CSS                             | `tailwindcss@4.3.4` + `@tailwindcss/postcss@4.3.4` (same version, both pinned)                                                                                                      | 2 dev                 |
| Headless UI                     | none; native `<dialog>`, `<details>`, Popover API                                                                                                                                   | 0                     |
| E2E tests                       | `@playwright/test@1.65.0` (dev)                                                                                                                                                     | 1 dev                 |
| CLI args                        | `node:util` `parseArgs`; no commander                                                                                                                                               | 0                     |
| Binance / CoinDCX API (Phase 2) | **write our own** signed-GET client; no ccxt                                                                                                                                        | 0                     |
| EVM (Phase 2)                   | defer; decide when the first decoder is written. If needed, `viem`                                                                                                                  | 0 for now             |
| Ids, hashes, cookies            | `crypto.randomUUID()`, `node:crypto` sha256 / HMAC                                                                                                                                  | 0                     |
| INR formatting                  | `Intl.NumberFormat("en-IN")` gives `2,50,000.00` (checked)                                                                                                                          | 0                     |

## Candidates

| Package               | Latest (published)           | Eligible today (published) | Weekly downloads | Maintainers   | Install script / native                                                                                                                               | Advisories on eligible version                                                                        |
| --------------------- | ---------------------------- | -------------------------- | ---------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| decimal.js            | 10.6.0 (2025-07-06)          | 10.6.0                     | 141.3M           | 1             | none; 0 deps                                                                                                                                          | none                                                                                                  |
| zod                   | 4.6.7 (2026-10-12)           | 4.6.7                      | 462.3M           | 1             | none; 0 deps                                                                                                                                          | none                                                                                                  |
| drizzle-orm           | 0.45.4 (2026-10-08)          | 0.45.4                     | 49.9M            | 4             | none; 0 deps, drivers are peers                                                                                                                       | none. `<0.45.2` has GHSA-gpj5-g38j-94v9 (high, SQL injection via identifiers): never pin below 0.45.2 |
| drizzle-kit           | 0.31.11 (2026-09-21)         | 0.31.11                    | 42.6M            | 4             | pulls `esbuild` (postinstall `node install.js`, already allow-listed), `tsx`, `@esbuild-kit/esm-loader`                                               | none                                                                                                  |
| better-sqlite3        | 13.2.0 (2026-11-14)          | **13.0.3** (2026-08-05)    | 17.0M            | 1             | native addon. 13.x has **no install script** and `gypfile: false`; package is 27 MB / 68 files, so binaries appear to ship inside it. Needs Node ≥ 22 | none                                                                                                  |
| date-fns              | 4.4.0 (2026-05-29)           | 4.4.0                      | 120.1M           | 1             | none; 0 deps                                                                                                                                          | none                                                                                                  |
| @date-fns/tz          | 1.5.0 (2026-05-21)           | 1.5.0                      | 44.0M            | 1             | none; 0 deps                                                                                                                                          | none                                                                                                  |
| papaparse             | 5.7.1 (2026-11-11)           | **5.7.0** (2026-08-24)     | 25.7M            | 2             | none; 0 deps; types in a separate `@types` package                                                                                                    | none                                                                                                  |
| csv-parse             | 7.0.3 (2026-09-25)           | 7.0.3                      | 28.1M            | 1             | none; 0 deps; ESM, types bundled, `csv-parse/sync`                                                                                                    | none                                                                                                  |
| exceljs               | 4.4.0 (2023-10-19)           | 4.4.0                      | 28.3M            | 2             | none; 9 deps incl. deprecated `uuid@8`, `unzipper@0.10`, `archiver@5`                                                                                 | none on exceljs; transitive `uuid@8` has GHSA-w5hq-g745-h8pq (moderate)                               |
| read-excel-file       | 9.3.17 (2026-11-13)          | **9.3.14** (2026-10-29)    | 5.5M             | 1             | none; deps `fflate`, `saxen`, `unzipper-esm`, `worker-f`; ESM                                                                                         | none                                                                                                  |
| write-excel-file      | 4.1.1 (2026-06-08)           | 4.1.1                      | 2.9M             | 1             | none; 1 dep (`fflate`)                                                                                                                                | none                                                                                                  |
| fflate                | 0.8.3 (2026-05-16)           | 0.8.3                      | 161.2M           | 1             | none; 0 deps                                                                                                                                          | none                                                                                                  |
| fast-xml-parser       | 5.12.1 (2026-11-13)          | **5.12.0** (2026-11-03)    | 113.2M           | 1             | none; 6 small deps                                                                                                                                    | none                                                                                                  |
| @e965/xlsx            | 0.20.3 (2024-07-19)          | 0.20.3                     | 1.8M             | 1             | none; 0 deps                                                                                                                                          | none                                                                                                  |
| xlsx (banned by SPEC) | 0.18.5 (2022-03-24)          | —                          | 15.1M            | 1             | —                                                                                                                                                     | 2 high: GHSA-4r6h-8v6p-xvw6 (prototype pollution), GHSA-5pgg-2g8v-p4x9 (ReDoS)                        |
| tailwindcss           | 4.3.5 (2026-11-06 15:16 UTC) | **4.3.4** (2026-11-02)     | 182.1M           | 3             | none                                                                                                                                                  | none                                                                                                  |
| @tailwindcss/postcss  | 4.3.5 (2026-11-06)           | **4.3.4**                  | 60.6M            | 3             | none. `@tailwindcss/oxide` is native but arrives as per-platform optional packages, no install script                                                 | none                                                                                                  |
| @playwright/test      | 1.65.1 (2026-11-13)          | **1.65.0** (2026-11-05)    | 133.4M           | Microsoft (5) | none; browsers are fetched only by an explicit `playwright install`                                                                                   | none                                                                                                  |
| commander             | 15.1.0 (2026-11-07)          | **15.0.0** (2026-05-29)    | 744.9M           | 2             | none; 0 deps                                                                                                                                          | none                                                                                                  |
| ccxt                  | 4.5.92 (2026-11-04)          | 4.5.92                     | 0.11M            | 2             | **`postinstall: node postinstall.js`** (blocked by our allow-list); 70.5 MB, 1,360 files                                                              | none                                                                                                  |
| viem                  | 2.57.20 (2026-11-15)         | **2.57.16** (2026-11-03)   | 9.8M             | 2             | none; 8 deps (`ox`, `abitype`, `ws`, `isows`, noble / scure)                                                                                          | none                                                                                                  |
| radix-ui              | 1.8.1 (2026-10-12)           | 1.8.1                      | 29.0M            | 2             | none; dozens of `@radix-ui/*` deps                                                                                                                    | none                                                                                                  |
| @headlessui/react     | 2.2.10 (2026-04-07)          | 2.2.10                     | 9.7M             | 3             | none; 5 deps                                                                                                                                          | none                                                                                                  |
| @base-ui/react        | 1.9.0                        | not checked                | 30.6M            | —             | not checked                                                                                                                                           | not checked                                                                                           |

Already in the repo and clean on the same check: `next@16.4.5`.

`tailwindcss@4.3.5` becomes eligible at 2026-11-06 15:16 UTC + 10 days, i.e. about two hours after this check; pin 4.3.4 or 4.3.5, but the same number for both Tailwind packages
(`@tailwindcss/postcss` depends on an exact `tailwindcss` version).

## Notes per area

### Database: better-sqlite3 vs `node:sqlite`

| Fact                                                                                                   | Evidence                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node 24.18.1 has `node:sqlite` (`DatabaseSync`), SQLite 3.53.1, and prints **no** experimental warning | ran locally                                                                                                                                                                           |
| `drizzle-orm@0.45.4` has **no** `node:sqlite` driver                                                   | its `exports` list has `better-sqlite3`, `libsql`, `bun-sqlite`, `sqlite-proxy`, `expo-sqlite`, `op-sqlite`, `durable-sqlite`; no `node-sqlite`                                       |
| A `node-sqlite` driver exists only in Drizzle 1.0 pre-releases                                         | Drizzle site: "v1.0.0-beta.17 release - New SQLite driver node-sqlite"; npm dist-tags `node-sqlite`, `kit/node-sqlite`; newest is `1.0.0-rc.5` (2026-10-21); `latest` is still 0.45.4 |

Options:

| Option                                                  | Verdict                                                                                                                       |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| A. drizzle-orm 0.45.4 + better-sqlite3 13.0.3 (SPEC §7) | **Recommended now.** Stable, and 13.x needs no build step.                                                                    |
| B. drizzle-orm 1.0.0-rc + `node:sqlite`                 | No. Pre-release ORM under a tax tool.                                                                                         |
| C. `node:sqlite` + hand-written SQL, no ORM             | Workable for ten tables and removes 3 packages plus esbuild. Keep as the fallback if the native binary causes Docker trouble. |
| D. drizzle 0.45 `sqlite-proxy` over `node:sqlite`       | No. Async proxy around a sync driver, more glue than C.                                                                       |

Do: keep the driver behind `packages/db` (one file creates the connection), so moving to `drizzle-orm/node-sqlite` after 1.0 is stable is a one-file change.
Keep `drizzle-kit` dev-only: generate SQL migrations at dev time, commit them, apply at boot with `drizzle-orm/better-sqlite3/migrator`; the Docker runtime image then has no esbuild or tsx.

To verify on first install (could not be checked without installing):

- that `better-sqlite3@13.0.3` loads on the Docker base image. Use a glibc image (`node:24-bookworm-slim`) unless a musl prebuild is confirmed.
- whether `better-sqlite3` still needs to be in `onlyBuiltDependencies` (13.x declares no install script; the entry is harmless).
- Next.js standalone output must trace the `.node` binary; keep `better-sqlite3` external to the bundle.

### Dates: no library

- `Temporal` is **not** available: `typeof Temporal === "undefined"` on Node 24.18.1.
- The app supports exactly two zones (SPEC: `"IST" | "UTC"`). IST is UTC+05:30 all year with no daylight saving, so conversion is "subtract 330 minutes".
- date-fns `parse` reads in the machine's local zone unless every call passes a `tz()` context from `@date-fns/tz`; that is an easy mistake that only shows up on a server in another zone.

Write a strict parser for the recipe `dateFormat` tokens we allow (`yyyy yy MM M dd d HH H hh h mm ss SSS a MMM` plus literals), returning a UTC ISO string
or an error; reject anything else. State the allowed tokens in the AI JSON schema description. The engine needs only "UTC ISO → IST calendar date", a few lines, which keeps it pure.
Display uses `Intl.DateTimeFormat` with `timeZone: "Asia/Kolkata"`. If recipes later need many more formats, add `date-fns@4.4.0` + `@date-fns/tz@1.5.0` (both zero-dependency) in `packages/importers` only.

### CSV

The repo already has its own reader (`csvRecords` in `packages/importers/src/spreadsheet.ts`): comma-delimited, RFC 4180 quoting, BOM stripped,
and it **throws** on a quote in the wrong place or an unclosed quote instead of guessing. That is the right failure mode (a parser that shifts
columns silently produces a wrong tax number), so a library is not needed. Limits to know: comma is the only delimiter (a `;`-separated
European export fails loudly) and input must be UTF-8. If those bite, `csv-parse@7.0.3` (ESM, bundled types, `csv-parse/sync`, zero deps) is the pick over
papaparse 5.7.0 (zero deps too, but browser-oriented with types in a separate package).

Writing CSV is our own code: quote fields containing `"`, `,`, CR or LF, double the quotes. Exports contain strings that came from user files
(asset names, notes), so prefix any text cell starting with `=`, `+`, `-`, `@`, tab or CR with `'` to stop spreadsheet formula injection; leave cells we know are numbers alone.

### XLSX

Requirement that decides it: xlsx stores numbers as IEEE doubles, and rule 2 forbids JS `number` for money. The reader must hand back the stored digits as text.

| Option                                                          | Read                                                                                                                                                               | Write           | Verdict                                                                                                                                                                    |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| own reader/writer on `fflate` + `fast-xml-parser` (in the repo) | yes; `parseTagValue: false` keeps cell text as written; 25 MB input cap, expanded-size and entry-count caps, path checks                                           | yes (`zipSync`) | **Keep.** Two healthy packages, no advisories, exact digits preserved.                                                                                                     |
| read-excel-file 9.3.14                                          | yes; README documents `parseNumber: (string) => string` to get numbers "exactly as they are written in the .xlsx file"; returns every sheet as `[{ sheet, data }]` | no              | Good alternative if the own reader meets files it cannot read. Pulls `fflate`, `saxen`, `unzipper-esm`, `worker-f`. Six releases in five weeks: pin exactly.               |
| write-excel-file 4.1.1                                          | no                                                                                                                                                                 | yes             | Fine, one dependency. Only if styled output is wanted.                                                                                                                     |
| exceljs 4.4.0                                                   | yes                                                                                                                                                                | yes             | No. Last release October 2023, nine dependencies with deprecated ones, returns JS numbers.                                                                                 |
| @e965/xlsx 0.20.3                                               | yes                                                                                                                                                                | yes             | No. A third party's re-upload of SheetJS's CDN build by a single account, not updated since July 2024. Zero deps and no advisories, but the trust chain is the weak point. |
| SheetJS from cdn.sheetjs.com                                    | —                                                                                                                                                                  | —               | Not allowed (tarball URL).                                                                                                                                                 |
| xlsx (npm)                                                      | —                                                                                                                                                                  | —               | Not allowed (SPEC), two open high advisories.                                                                                                                              |

Things for the own reader to keep handling: shared strings with rich-text runs, inline strings, sheets whose header is not on row 1 (CoinDCX: row 9),
date cells stored as serial numbers, and numeric text such as `9074.400000000001` (flag with `parse_warning`, do not round silently).
Formulas are never evaluated; only stored values are read.

### UI

Tailwind v4 needs no config file (CSS-first `@import "tailwindcss"`), only the PostCSS plugin. No component or headless library: the screens need a confirm dialog,
drawers, a file drop zone and tables, all doable with `<dialog>`, `<details>`, the Popover API and native form controls, which also gives keyboard and focus handling for free.
If a combobox or date picker is needed later, `@base-ui/react` is the one to evaluate first.

### Playwright

Dev dependency only. Browsers are downloaded by `pnpm exec playwright install chromium`, a network call to Microsoft's CDN outside the pnpm cooldown; run it in CI and on developer machines only, never in the app image.

### CLI

`node:util` `parseArgs` handled `--year 2026-27 file.csv` with positionals in a local check. Two subcommands (`import`, `compute`) do not justify commander.

### ccxt (Phase 2)

Skip. It has an install script, 70 MB of code for 100+ exchanges we do not use, a release every few days (the cooldown will always trail), about 0.1M weekly downloads, and no CoinDCX.
Phase 2 needs four or five read-only signed GET endpoints per exchange; a client is `fetch` + `node:crypto` HMAC-SHA256, and CoinDCX needs hand-written code anyway.

### viem (Phase 2)

Defer. Explorer APIs return token transfers already decoded, so plain transfers and simple swaps may need no ABI decoding at all.
Add viem only when a decoder needs it; it releases almost daily, so expect to run several patch versions behind.

## Repo state against these recommendations (commit `e164cf0`)

| In the repo                                                                               | Status                                                                                                                                                                                                        |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `zod@4.1.12` in `packages/core`, `packages/rules`, `apps/web`                             | **Bump to `4.6.7`.** npm reports GHSA-mrhx-c7xc-m3w5 (high; "can exhaust memory while validating oversized constrained collections") for `<4.6.6`. 4.6.7 was published 2026-10-12, so it clears the cooldown. |
| `decimal.js@10.6.0`, `drizzle-orm@0.45.4`, `better-sqlite3@13.0.3`, `drizzle-kit@0.31.11` | match the recommendation; no advisories                                                                                                                                                                       |
| `fflate@0.8.3`, `fast-xml-parser@5.12.0`                                                  | fine; no advisories                                                                                                                                                                                           |
| `tailwindcss@4.3.4`, `@tailwindcss/postcss@4.3.4`                                         | match                                                                                                                                                                                                         |
| `next@16.4.5`, `react@19.3.1`, `react-dom@19.3.1`, `lucide-react@1.70.0`                  | no advisories. `lucide-react` publishes several times a week; it is icons only, so there is no reason to chase versions                                                                                       |
| CLI on `node:util` `parseArgs`, no date library, no CSV library                           | match                                                                                                                                                                                                         |
| `@playwright/test`                                                                        | not installed yet; `1.65.0` is the eligible version                                                                                                                                                           |
