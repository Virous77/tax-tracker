# Browser E2E findings — regression round 2026-11-17

Run: `pnpm test:e2e` (Playwright 1.65, Chromium, image `tax-tracker-app:local` built from `main` at
`1cc6111`, after fix commits `f1f5394` server and `1cc6111` UI).
Result: **108 tests: 107 pass, 1 fail.** The failure is new bug N1 below and is left failing on purpose.

Global setup starts three throwaway Compose stacks: `taxe2e` (3102), `taxe2epw` (3103, `APP_PASSWORD`)
and `taxe2efresh` (3104, read-only empty-state checks), each on a fresh `/private/tmp` data dir; global
teardown stops them. Playwright's `webServer` runs the mock LLM on 11502.
`E2E_REUSE_STACK=1` reuses running stacks and `E2E_KEEP_STACK=1` leaves them running.

**The test-only Origin-rewriting proxy is gone.** Bug 1 is fixed, so every spec talks to the app ports
directly. The two tests that proved bug 1 now pass as "saves succeed".

Screenshots: `tests/e2e/screenshots/` (gitignored), refreshed in this run. `screen-<name>-{light,dark,mobile,mobile-dark}.png`
cover every screen; the other files are per-scenario captures.

---

## Status of earlier findings

| #   | Finding                                                         | Status         | Verified by                                                                                                     |
| --- | --------------------------------------------------------------- | -------------- | --------------------------------------------------------------------------------------------------------------- |
| 1   | Critical: every browser write rejected with 403 in Docker       | **FIXED**      | `import.spec.ts` › "a real browser upload is accepted…"; `password.spec.ts` › "a real browser can log in"; whole suite now runs without the proxy |
| 2   | High: wizard used "Side" as the row ID, dropping trades         | **FIXED**      | `recipe-wizard.spec.ts` › "the wizard's first guess does not use the Side column…" and "generic-ddmmyyyy.csv with the wizard's ID guess inserts 4 rows; re-import is 4 duplicates" |
| 3   | High: host.docker.internal "Local" in UI, cloud on server       | **FIXED**      | `settings.spec.ts` › "host.docker.internal is local in both UI and server" (saved with `cloudAcknowledged: false`) |
| 4   | Medium: balance mismatch never reached Review                   | **FIXED**      | `review.spec.ts` › "reportStatus banner prompts a compute, then the balance mismatch appears as a report item"; `report.spec.ts` › "TDS section, 26AS checklist and actual-balance mismatch" |
| 5   | Medium: Review said "clean" before any compute                  | **FIXED**      | `review.spec.ts` › "before any compute…" and the reportStatus test; `empty-states.spec.ts` › "review empty state asks for a compute instead of claiming clean" |
| 6   | Medium: Add-transaction error was a raw Zod dump                | **FIXED**      | `transactions.spec.ts` › "validation errors are shown and nothing is saved" (now a hard check: "Quantity received must be a valid number.") |
| 7   | Medium a11y: no visible focus on the file picker                | **FIXED**      | `import.spec.ts` › "the drop zone shows a visible focus ring…"; `responsive-a11y.spec.ts` › "keyboard focus is visible on import" |
| 8   | Medium a11y: mobile menu ignored Escape, didn't take focus      | **FIXED**      | `responsive-a11y.spec.ts` › "mobile navigation" (3 existing + "Escape returns focus to the toggle and Tab stays inside the open menu") |
| 9   | Medium a11y: dark primary buttons 2.94:1                        | **FIXED**      | `responsive-a11y.spec.ts` › "text meets WCAG AA contrast (dark)"                                                 |
| 10  | Low a11y: light muted text 4.28:1                               | **FIXED**      | `responsive-a11y.spec.ts` › "text meets WCAG AA contrast (light)"                                                |
| 11  | Low a11y: export links all named "CSV"/"XLSX"                   | **FIXED**      | `report.spec.ts` › "export links have distinguishable accessible names" (now also requires kind + format in each name) |
| 12  | Low: login always landed on Overview                            | **FIXED**      | `password.spec.ts` › "after login the user lands on the page they asked for"; off-site `?next=` values are refused (3 new tests) |
| 13  | Low a11y: drawer didn't return focus                            | **FIXED**      | `responsive-a11y.spec.ts` › "add-transaction drawer traps focus, closes on Escape and returns focus" (soft → hard) |
| 14  | Low: Difference sign differed between UI and export             | **FIXED**      | `report.spec.ts` › "TDS section…" asserts the CSV row `"ETH","0","0.5","0.5"` and the "Difference = Actual − Computed" note |

UX items from the last round:

| Item                                                           | Status         | Notes                                                                                          |
| -------------------------------------------------------------- | -------------- | ---------------------------------------------------------------------------------------------- |
| "TDS Possibly Due" warned on fully covered manual TDS          | **FIXED**      | Shows "Covered by recorded TDS"; a partial case shows "₹500.00 after recorded TDS" (`screen-report-light.png`) |
| Report Warnings listed 30 repeated lines                       | **FIXED**      | "10 distinct · 30 total", `(×13) View 13 transactions` links to the filtered list               |
| "Schedule VDA (1 rows)" plural                                 | **FIXED**      | "Schedule VDA (1 row)"                                                                         |
| Raw setting keys on Report                                     | **FIXED**      | "Fee & GST treatment: Exclude fees", "Surcharge rate: 10%"…; asserted in `report.spec.ts` and `settings.spec.ts` |
| Raw settings in CSV export (one JSON cell)                     | **STILL OPEN** | `"Settings","{""feeTreatment"":…}"` and `"Sections","{…}"` in every CSV export                 |
| Imports list on mobile hid status/actions off-screen           | **FIXED**      | 375 px card layout (`screen-imports-mobile.png`)                                               |
| Generic import labelled "generic" in lower case                | **FIXED**      | "Generic CSV"                                                                                  |
| Statement import shows overlap skips as red "errors"           | **STILL OPEN** | Not changed by the fix commits                                                                 |
| No banner explaining why reports disappear after a change      | **FIXED** (Review) / **STILL OPEN** (Report, Overview) | Review explains it; Report/Overview still fall back to the plain "No report computed" state |

---

## New findings (ranked)

### N1. Medium — Review "All years": Compute never clears the "not computed" banner

- **Screen:** Review with the default "All years" filter (the Import summary's CTA leads users here).
- **Steps:** import `sell-without-buy.csv` → open `/review` → click _Compute 2026-27 report_.
- **Expected:** the banner goes away, or names the year that is still missing (2025-26).
- **Actual:** the report is computed and the groups appear, but the banner still says
  "Report not computed for 2026-27 — some checks … appear only after computing." Clicking again
  recomputes 2026-27 and changes nothing, so the user is stuck in a loop.
- **Cause:** without `?taxYear` the server reports `current` only when **every** rule year has a stored
  report (`apps/web/src/server/transactions.ts:206`), but the button computes only
  `computeTargetYear = taxYear || defaultTaxYear` (`apps/web/src/components/ReviewClient.tsx:109`).
  Either compute every missing year from the All-years view, or have the API return which years are missing.
- **Test:** `review.spec.ts` › "All years: after Compute the banner no longer says that year is not computed" (fails).

### N2. Medium — negative holdings ("missing_history: Negative USDT holding") never reach Review

- **Screen:** Report → Report Warnings vs Review.
- **Steps:** import the E2E Binance/CoinDCX set (as `screenshots.spec.ts` does) → compute 2026-27 →
  Report lists `missing_history: Negative USDT holding: -413.737002` (`screen-report-light.png`).
- **Expected:** a Review item under "Missing acquisition history" (the same class of problem as bug 4).
- **Actual:** Review shows report items only for `report.unresolved` missing-history slices and
  `balances[].difference` mismatches; the negative-holding warning (no `txId`) is dropped.
- **Cause:** `apps/web/src/server/transactions.ts:131-163` builds `reportItems` from balances with a
  difference and `unresolved`, not from `balances` with `computed < 0` (raised in `packages/engine/src/balances.ts:66-70`).
- **Test:** none yet (found in exploration); seen in `screenshots/screen-report-light.png`.

### N3. Low — Review shows only the first flag message per transaction in a group

- A CoinDCX sell carrying three `parse_warning` flags (GST, gross INR derived, crypto fee) shows only
  "Export does not separate GST…" in Review's Details column
  (`ReviewClient.tsx:289`, `tx.reviewFlags.find(...)`). The other two are visible only in Report
  warnings or the transaction drawer.

### N4. Low — grouped `balance_mismatch` warning has no transaction ids; non-parse warnings coded `parse_warning`

- See `tests/api/BUGS.md` N1/N2. In the UI this means the balance warning on Report has no
  "View transaction" link, and "Section numbers pending CA verification" / "Import …: N excluded rows"
  are shown as `parse_warning`.

### N5. Low — Overview grammar

- "1 flagged transaction item need review before filing." (`OverviewClient.tsx:185`): "needs" for one.

---

## Exploration notes (≈25 min, Playwright scripts against the `taxe2e` / `taxe2epw` stacks)

Checked and working:

- **Import → review → compute → report → export → edit → recompute:** editing the sell's INR value
  to ₹3,00,000 in the transaction drawer deletes the stored report (Report shows "No report computed"),
  _Compute_ gives Consideration ₹3,00,000 / Taxable ₹1,00,000 / Total tax ₹31,200 / Net ₹28,700, and
  the Schedule VDA CSV carries `300000.00` / `100000.00`.
- **Tax-year switching** on Overview, Report, Transactions and Review updates the URL and data
  (2025-26 shows the 1961-Act sections, `india-vda/2025-26.json`, ₹62.40 tax on a ₹200 gain).
- **Default tax year** setting (2025-26) drives Overview, Report and Review's compute target.
- **Delete import** clears Imports, Review (back to "not computed") and Report.
- **Report warning links** open `/transactions?taxYear=…&flagged=true&source=…`.
- **Password mode end to end:** login with `?next=`, UI import, compute, export download, logout; the
  export URL then answers 401 (new test `password.spec.ts` › "password mode end to end…").
- **Mobile Imports** at 375 px: no page-level horizontal overflow.

Test-side fix found while exploring: the AI-wizard test asserted the suggested columns before the
`/api/recipes/suggest` reply had arrived (the wizard's own header guesses equal the mock's answer), so a
late reply could overwrite the hand edit. The test now waits for the response. Not an app defect.

## Not tested

- Real OS drag-and-drop onto the drop zone (Playwright can't send it); picker and keyboard paths only.
- `mock-slow` (120 s upstream timeout), for run time.
- Firefox and WebKit; Chromium only.
- EVM and US-stock flows (Phase 3; no UI yet).
- Dark-mode contrast inside dialogs and drawers (screenshots only).
- `reportStatus: "stale"`: the server never returns it (see `tests/api/BUGS.md`), so the stale wording can't be reached.
