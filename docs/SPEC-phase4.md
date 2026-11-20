# Phase 4 spec — public release polish

Source: `docs/plan.txt` §9–10. Gate: **a stranger installs it and gets a report without asking anyone.**
Phase 3 (US stocks) is deferred; nothing here may block it.

## 0. Decisions (user, 2026-11-20)

- Licence **AGPL-3.0-only**. Name **tax-tracker** (repo, image, app title).
- Everything is built locally. Nothing is pushed or published until a CA signs off the tax rules; the user
  creates the GitHub repo later. Workflows must therefore work once pushed, without anything we can run now
  except `act`-free local checks (YAML lint by schema, the same commands run locally).
- Image: `ghcr.io/<owner>/tax-tracker`, with `<owner>` taken from `${{ github.repository_owner }}`, never hard-coded.
- Version **0.1.0** (pre-1.0 until CA sign-off). Single source: root `package.json` `version`; the app reads it.
- Supply-chain rules from AGENTS.md stay non-negotiable: pnpm only, `minimumReleaseAge: 14400`, no new
  runtime dependencies unless unavoidable; GitHub Actions pinned to full commit SHAs with a version comment.

## 1. Licence and notices

- `LICENSE`: full AGPL-3.0 text. Every `package.json`: `"license": "AGPL-3.0-only"`, `"private": true` kept.
- `NOTICE.md`: third-party data attributions (SBI TT rate table source, any bundled data), and that the
  rule files are not legal advice.
- The app footer shows: version, "AGPL-3.0", "Source" link (configurable `SOURCE_URL` env; hidden if empty —
  AGPL §13 offers source to network users), and the existing "not tax advice" notice.

## 2. First-run experience (the gate)

- **Disclaimer acknowledgement.** New setting `disclaimerAcceptedAt: string | null` (ISO). Until accepted,
  every page shows a blocking-but-accessible dialog: what the tool is, "not tax advice, rules pending CA
  review, verify with a CA", data stays local, then "I understand". Report/export APIs keep working
  (CLI/automation), the UI gate is client-side.
- **Getting started checklist** on the home page (dismissible, state derived from data, not stored):
  1. choose tax year & settings, 2. import a file or connect an exchange, 3. resolve Review items,
  2. open the report, 5. export. Each step links to its screen and shows done/not done.
- **Demo data.** "Try with sample data" loads a synthetic dataset (Binance + CoinDCX + one EVM wallet,
  all clearly fake) as imports tagged `demo: true`, so a stranger sees a full report in one click.
  A persistent banner "Sample data loaded — Remove sample data" while any demo import exists.
  Demo imports never mix silently with real ones: the report header says "includes sample data".
- **Backups.**
  - Before applying pending migrations on boot, copy the DB to `${DATA_DIR}/backups/tax-tracker-<UTC stamp>-pre-<migration>.db`
    using SQLite's online backup; keep the newest 5 pre-migration backups.
  - Settings → "Download backup" streams a consistent snapshot (`.db`) of the live DB. Restore is documented
    (stop, replace file, start); no restore endpoint.
- **Health/version.** `GET /api/health` already returns `version`; it must come from root `package.json`.

### API additions (Phase 4)

| Route                     | Request                                                                          | Response                                                                                                 |
| ------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| GET / PUT `/api/settings` | PUT accepts `disclaimerAccepted: true`; the server stamps `disclaimerAcceptedAt` | settings with `disclaimerAcceptedAt`                                                                     |
| GET `/api/demo`           | —                                                                                | `{ loaded: boolean, importIds: string[] }`                                                               |
| POST `/api/demo`          | —                                                                                | 201 `{ importIds }`; 409 if already loaded                                                               |
| DELETE `/api/demo`        | —                                                                                | 204; deletes demo imports and their rows only                                                            |
| GET `/api/backup`         | —                                                                                | `application/vnd.sqlite3` download, `Content-Disposition: attachment; filename="tax-tracker-<stamp>.db"` |

All new routes follow existing auth (password mode), CSRF/same-origin and error-shape rules.
Report response gains `includesDemoData: boolean`; exports print "Includes sample data" when true.

## 3. Shared recipe library (the easiest contribution)

- Recipes move from TypeScript to data: `packages/recipes/library/<id>/recipe.json` + `sample.csv`
  (synthetic, ≤ 20 rows, header exactly as the source exports it) + `expected.json` (the ledger rows the
  sample must produce) + `README.md` (source, export steps, quirks, `verified: true|false`).
- `packages/recipes` loads every folder at build time, validates with `RecipeSchema`, and exports
  `libraryRecipes` exactly as today (the app is unchanged).
- `pnpm recipes:check` (and a Vitest test) runs every sample through the generic importer and compares to
  `expected.json`, checks fingerprint uniqueness, ids, and that samples contain no real-looking data
  (no 0x addresses other than documented test ones, no emails).
- `pnpm recipes:new <id>` scaffolds a folder from a header row (`--header "Date,Pair,…"`).
- Seed: migrate `generic-trades-v1`. Add exchange recipes only for formats with a public, documented
  header; mark each `verified: false` until a user confirms with a real export.

## 4. Docker image

- Multi-arch `linux/amd64,linux/arm64`; `better-sqlite3` must build on both (verify with buildx locally).
- Base image pinned by digest (Dependabot keeps it fresh). OCI labels: title, description, source, licenses,
  version, revision. Non-root (already), healthcheck (already), `/data` volume declared.
- `docker-compose.yml` defaults to the published image (`image: ghcr.io/OWNER/tax-tracker:latest` via
  `TAX_TRACKER_IMAGE` env with that default) and keeps `build: .` for local builds; README explains both.
  Default bind is `127.0.0.1:${APP_PORT:-3000}` so a fresh install is not exposed on the LAN; docs explain
  how to expose it with `APP_PASSWORD` set.
- Image size reported in the PR; no dev dependencies or test data in the runner stage.

## 5. CI and release (GitHub Actions, `.github/`)

- `ci.yml` on push/PR: pnpm install `--frozen-lockfile`, lint, typecheck, `pnpm test`, `pnpm recipes:check`,
  `docker build` (no push). Node 24, pnpm from `packageManager`. Least-privilege `permissions:`.
- `release.yml` on `v*` tags: buildx multi-arch, push to GHCR with tags `vX.Y.Z`, `X.Y`, `latest`
  (not `latest` for pre-releases `-rc`), SBOM + provenance attestations, then a GitHub Release with
  CHANGELOG notes.
- `dependabot.yml`: ecosystems npm (pnpm), github-actions, docker; weekly; `cooldown: default-days: 10`
  (matches `minimumReleaseAge`); grouped minor/patch; security updates allowed.
- `codeql.yml` (JS/TS) weekly + on PR.
- Templates: bug report, recipe request (asks for the header row only and says never to paste real rows,
  keys or addresses), feature request, PR template with the checklist from AGENTS.md.

## 6. Documentation

- `README.md`: what/why, "not tax advice / pending CA review" box, screenshots (from the e2e run, synthetic
  data), features by phase, privacy (no telemetry; exactly which outgoing calls happen and only when the user
  enables them), quick start (Docker, 3 commands), first report in 5 steps, links to the docs below.
- `docs/install.md`: Docker Desktop on macOS/Windows/Linux, compose, ports, data folder, password mode,
  local AI (Ollama) optional, updating (pull + up; auto backup before migrations), backup/restore,
  uninstall, troubleshooting (port in use, permissions on data dir, health check).
- `docs/user-guide.md`: import each supported export (where to download it on Binance/CoinDCX), recipes and
  the AI recipe wizard, connections and read-only keys, Review codes explained, settings and what a CA should
  check, the report and exports, balance snapshots.
- `CONTRIBUTING.md`: dev setup, repo layout, rules (AGENTS.md summary), tests, **adding a recipe step by
  step** (the main path), adding an importer, rule files need CA review, commit/PR conventions.
- `SECURITY.md` (private vulnerability reporting via GitHub advisories; scope; what we never do with keys),
  `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1), `CHANGELOG.md` (Keep a Changelog; 0.1.0 entry
  summarising Phases 0–2), `docs/architecture.md` (short: packages, data flow, engine purity).
- Docs never contain the user's real data, personal names, emails or local paths.

## 7. Gate test

A fresh agent with **no repo context** receives only the repository files (as a stranger would after
cloning) and the instruction "install this and produce a Schedule VDA report for FY 2025-26 from the sample
exports in `docs/research/export-samples/`, and separately with demo data". It follows README/docs only,
on Docker, in a clean data dir, and records every point where it had to guess, read code, or got stuck.
Pass = report produced from both paths with zero code-reading and no blocking confusion.
