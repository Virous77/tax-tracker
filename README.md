# tax-tracker

> [!WARNING]
> **Pre-release (v0.x). Not tax advice.**
> The tax rules in this project are **pending review by a Chartered Accountant (CA)**. No CA has approved
> them yet. Use the output as working papers only, and have a CA check every figure before you file a return.

A free, open-source, self-hosted helper that turns your crypto history into the rows the Indian income-tax
return asks for: **Schedule VDA**, the **TDS** credit and its reconciliation, and the workings behind each
number. It reads Binance and CoinDCX exports, can sync read-only from those exchanges, and can read EVM
wallet history. US stocks (Form 67, Schedule FA) are planned.

## Why

Indian crypto tax is simple to state and tedious to compute: 30% on each gain, no loss set-off, cost of
acquisition the only deduction, 1% TDS on transfers. Getting there means matching transfers between your
own wallets, valuing USDT trades in rupees, running FIFO lots across years and reconciling TDS against
Form 26AS/AIS. Hosted tax tools do this, but they need your full trading history on their servers.

tax-tracker does it on your own computer:

- **Your data stays on your machine.** No accounts, no telemetry, no hosted copy.
- **Every number is traceable.** Each Schedule VDA row links to the ledger rows it came from, and each ledger
  row keeps the original exported or synced row untouched.
- **Missing history is flagged, never guessed.** A sale with no matching buy is shown as unresolved and left
  out of the totals, never given a zero cost.
- **Disputed tax points are settings**, printed on every report, so a CA can change them without code.

<!-- Screenshots: add images made from synthetic/demo data only (for example docs/images/report.png).
     tests/e2e/screenshots is gitignored, so do not link to it. -->

## Features

| Phase | What                                                                                                                                                                                                                                                                         | Status      |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| 0     | Shared ledger format, tax rule files for FY 2025-26 (Income-tax Act 1961) and tax year 2026-27 (Income-tax Act 2025), a pure tax engine (transfer matching, FIFO lots, Schedule VDA rows, tax, cess, surcharge, TDS), 20 hand-checked golden tests, a command-line tool      | Done        |
| 1     | Binance and CoinDCX file importers, any other CSV/XLSX through a column "recipe" (written by hand or suggested by an optional AI), SQLite storage, web screens for import, review, transactions, report and export (CSV/XLSX), Docker                                        | Done        |
| 2     | Read-only Binance and CoinDCX API sync, EVM wallets on Ethereum, Base, Arbitrum, Polygon and BNB Chain, an encrypted key vault, a historical price cache, every documented Binance/CoinDCX export kind, Binance PDF account statements as balance snapshots, file/API dedupe | Done        |
| 3     | US stocks: broker CSVs, SBI TT rates, long/short term, dividends, Form 67, Schedule FA                                                                                                                                                                                       | Planned     |
| 4     | Release polish: first-run disclaimer, getting-started checklist, sample data, backups, recipe library, published image, CI                                                                                                                                                   | In progress |

## Privacy

There is no telemetry, analytics or crash reporting, and nothing is sent at startup. Next.js telemetry is
turned off. Computing a report never goes online: it reads only your local database, the bundled SBI rate
table and the local price cache.

The app contacts other servers **only for features you turn on, and only when you start them**:

| Feature (off until you set it up)        | Hosts contacted                                                                                                                           | When                                                                                                               |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Binance connection                       | `api.binance.com`                                                                                                                         | When you save the key (an automatic read-only check) and when you click **Sync now**                               |
| CoinDCX connection                       | `api.coindcx.com`                                                                                                                         | Same as above                                                                                                      |
| EVM wallet connection                    | Whichever of `api.etherscan.io`, `api.blockscout.com`, `<network>.g.alchemy.com`, `bsc-mainnet.nodereal.io` you saved a key for           | When you click **Sync now** on that wallet                                                                         |
| Price lookups (Settings, off by default) | `data-api.binance.vision` (public daily prices, no key); `api.coingecko.com` only if the CoinGecko fallback is on and you saved a key     | When you click **Fetch missing prices** on the report, or after a sync you started finishes                        |
| AI recipe assistant (optional)           | The OpenAI-compatible endpoint you configure. Default is a local Ollama container (`http://ollama:11434/v1`), which stays on your machine | Only when you click **Send & suggest recipe**, after the app shows you the exact payload (headers + up to 20 rows) |

Every upstream address can be changed with an environment variable (see [install guide](docs/install.md)).
Explorer links on transactions open only when you click them. API keys are stored encrypted and are never
logged or returned by the API. See [SECURITY.md](SECURITY.md).

## Quick start

You need [Docker](https://docs.docker.com/get-docker/) (Docker Desktop on macOS and Windows).

```sh
git clone https://github.com/Virous77/tax-tracker.git
cd tax-tracker
cp .env.example .env
docker compose up -d --build
```

Open <http://localhost:3000>. Your data lives in `./data`. The first build takes a few minutes. The app is
reachable only from this computer unless you set `APP_PASSWORD` and `APP_BIND_ADDRESS`.

**Image name.** The image you build is tagged `tax-tracker:local` (the default in both `docker-compose.yml` and
`.env.example`), so it never takes the published name. No image is published until the tax rules are signed off by
a CA. After a release, you can switch to the published image: set
`TAX_TRACKER_IMAGE=ghcr.io/virous77/tax-tracker:<release-tag>` (for example `:v0.1.0`) in `.env`, then run
`docker compose pull && docker compose up -d`. Running more than one copy on one machine? Give each its own
`TAX_TRACKER_IMAGE`, `APP_PORT` and project name (`COMPOSE_PROJECT_NAME`).

**No exports of your own yet?** Click **Try with sample data** on the Overview page, or import the synthetic
files in [`examples/`](examples/) to try the import path. Details, `.env` options and troubleshooting are in the
[install guide](docs/install.md).

## Your first report in 5 steps

1. **Read and accept the notice** that opens on first visit, then pick the tax year and check the defaults in
   **Settings**. (Want to look around first? Click **Try with sample data** on the Overview page.)
2. **Import** your exchange exports on the **Import** page (Binance CSV/XLSX, CoinDCX Trade Report XLSX, or any
   other CSV), or add a read-only exchange key or wallet address under **Connections**. Import every year you
   ever traded, not only the current one: FIFO needs the earlier buys.
3. **Resolve the Review page.** Each item that needs action says what is wrong and links to the fix: missing
   buys, rows with no rupee value, unmatched transfers. Fix what you can, then click **Mark checked** on each
   item, or **Mark all as checked** on a group you have looked through. Marking an item checked never changes a
   tax figure, and it stays checked when you recompute. **Notes about your files** (how a file was read) need no
   action. The Overview checklist step is done once no action items are left for the computed report.
4. **Compute** the report on the **Report** page and walk through it: Schedule VDA rows, TDS, income, balances.
5. **Export** Schedule VDA, TDS, Income or the full report as CSV or XLSX, and take it to your CA.

The [user guide](docs/user-guide.md) covers each step in detail.

## Documentation

- [Install guide](docs/install.md): Docker on macOS, Windows and Linux, settings, updating, backup, troubleshooting
- [User guide](docs/user-guide.md): exports to download, imports, connections, Review codes, settings, report
- [Architecture](docs/architecture.md): packages, data flow, where tax rules live
- [Contributing](CONTRIBUTING.md): dev setup, rules, adding a CSV recipe or an importer
- [Security policy](SECURITY.md) · [Code of Conduct](CODE_OF_CONDUCT.md) · [Changelog](CHANGELOG.md) ·
  [Third-party notices](NOTICE.md)
- Build specs: [docs/SPEC.md](docs/SPEC.md), [docs/SPEC-phase2.md](docs/SPEC-phase2.md),
  [docs/SPEC-phase4.md](docs/SPEC-phase4.md); open tax questions for a CA:
  [docs/research/tax-open-questions.md](docs/research/tax-open-questions.md)

## Licence

[AGPL-3.0-only](LICENSE). You may use, change and share it. If you run a modified copy as a network service,
you must offer its source code to that service's users. Bundled third-party data keeps its own licence; see
[NOTICE.md](NOTICE.md).
