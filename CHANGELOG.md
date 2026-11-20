# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Versions before 1.0 are pre-release: the tax rules are
pending review by a Chartered Accountant, and nothing here is tax advice.

## [Unreleased]

Phase 4: public release polish (in progress; see `docs/SPEC-phase4.md`).

### Added

- AGPL-3.0-only licence, `NOTICE.md`, and public documentation: README, install guide, user guide, architecture,
  contributing guide, security policy, Code of Conduct (Contributor Covenant 2.1) and this changelog.
- First-run disclaimer that must be acknowledged in the UI, a getting-started checklist on the Overview page, and an
  app footer with version, licence and source link.
- "Try with sample data": a synthetic Binance, CoinDCX and EVM dataset, a "Sample data loaded" banner, and
  "Includes sample data" on reports and exports.
- Settings → "Download backup", and an automatic database backup in `data/backups/` before each migration (newest
  five kept).
- Shared recipe library as data (`packages/recipes/library/<id>/`) with `pnpm recipes:check` and
  `pnpm recipes:new`.
- Multi-architecture image published to GitHub Container Registry; Docker Compose uses it by default, keeps
  `build: .` for local builds, and binds to `127.0.0.1`.
- CI, release, CodeQL and Dependabot workflows (with a 10-day cooldown), issue and PR templates.

## [0.1.0]

First version: Phases 0 to 2. Not published as a release or image until the tax rules are signed off.

### Added

- **Phase 0: engine.**
  - Shared ledger, recipe, settings, report and HTTP-contract schemas (`@tax/core`) with decimal helpers; amounts are
    decimal strings throughout.
  - Rule files for FY 2025-26 (Income-tax Act 1961) and tax year 2026-27 (Income-tax Act 2025), plus US-equity rule
    data for Phase 3; section labels marked pending CA verification.
  - Pure tax engine: transfer matching, valuation (trade INR, USDT × USD/INR, cache), FIFO lots (global or per
    source), one Schedule VDA row per disposal × lot, 30% tax with surcharge and 4% cess, no loss set-off, TDS credit
    and "may have been due" estimate, income and gifts, year-end balances, a full trail to raw rows.
  - Bundled SBI TT buying USD/INR rates; 20 hand-checked golden test cases; a command-line tool.
- **Phase 1: files and web app.**
  - Binance and CoinDCX importers, and a recipe-driven importer for any other CSV/XLSX, with an optional AI recipe
    suggestion over any OpenAI-compatible endpoint (local Ollama by default) that shows the exact payload before
    sending.
  - SQLite storage with migrations; idempotent imports; original rows always kept.
  - Web screens: Overview, Import with recipe wizard, Imports, Transactions (edit, manual gift/income/missing buy),
    Review grouped by code, Report with trail drawer, TDS and Form 26AS/AIS checklist, Settings; CSV and XLSX exports
    for Schedule VDA, TDS, Income and the full report.
  - Optional `APP_PASSWORD` login; Docker image and Compose file with an optional Ollama profile.
- **Phase 2: sync, wallets, prices.**
  - Read-only Binance sync (trades, deposits, withdrawals, Convert, dust, dividends, fiat, P2P, balances) and
    CoinDCX sync (trades, balances), resumable after interruption.
  - EVM wallets on Ethereum, Base, Arbitrum, Polygon and BNB Chain via Etherscan, Blockscout, Alchemy and NodeReal,
    with spam detection, gas fees, bridge and complex-transaction flags.
  - Encrypted key vault (scrypt + AES-256-GCM) with optional auto-unlock.
  - Opt-in historical price cache from Binance public daily klines with a CoinGecko fallback; reports never go
    online.
  - Transfer matching by transaction hash across exchanges and wallets; file/API dedupe by fingerprint with
    `possible_duplicate` for near matches.
  - Every documented Binance and CoinDCX export kind, fixed UTC-offset time zones (read from Binance file names),
    cross-export reconciliation, and Binance PDF account statements as balance snapshots that can be applied as
    year-end actual balances.
  - Connections page, provider keys, balance check per connection, price status on the report, spam exclusions.
  - New review codes, including `suspected_spam`, `possible_duplicate`, `ambiguous_transfer`,
    `fee_review_required`, `import_incomplete`, `fx_unavailable` and `ca_verification_pending`.
  - Mock servers for every upstream API and an OpenAI-compatible endpoint; API and browser test suites.

### Security

- Zod upgraded to 4.6.7 for GHSA-mrhx-c7xc-m3w5.
- pnpm installs refuse versions published less than 10 days ago; install scripts limited to an allow-list.

[Unreleased]: https://github.com/Virous77/tax-tracker/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Virous77/tax-tracker/releases/tag/v0.1.0
