# Tax open questions: input for a Chartered Accountant

Researched 2026-11-16. **Not tax advice.** This lists what could be checked against primary text, what sources disagree on,
and what was not checked. A CA decides; the app keeps each disputed point as a setting.

Status: **verified** = read in statute / rule / official document text. **conflicting** = sources disagree or no authority found.
**unverified** = not checked or no primary source reachable.

Caveat on "verified": the Income Tax Department's own section pages blocked automated reading (HTTP 403), except Rule 206.
Section text was therefore read from mirrors that reproduce the Act (Indian Kanoon, EZTax), not from the Gazette.
Confirm against the Gazette copy before setting `sectionsVerified: true`.

## Naming trap first

"**AY 2026-27**" is the return for **financial year 2025-26** (1961 Act). "**Tax year 2026-27**" is 1 April 2026 – 31 March 2027 (2025 Act).
The same label means two different years. The app's rule-file id `2025-26` is what an "AY 2026-27" ITR form covers.
Reports and exports should print the period dates next to the label.

## 1. Section and rule numbers (SPEC §3 table)

| Key                      | SPEC value (2025 Act)                  | Status                                                                                                                                                                                          | What the text says                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Source                                                                                               |
| ------------------------ | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `vdaTax`                 | Section 194, table serial 4            | **verified**                                                                                                                                                                                    | s.194(1) Table, Sl. No. 4: "Any person. Any income from the transfer of any virtual digital asset. 30%". Column E: "(a) No deduction in respect of any expenditure (other than cost of acquisition, if any) or allowance or set off of any loss shall be allowed ... (b) no set off of loss from transfer of the virtual digital asset ... against income computed under any provision of this Act ... and such loss shall not be allowed to be carried forward". Suggested label: **"Section 194(1), Table: Sl. No. 4"**. | <https://indiankanoon.org/doc/170685219/>                                                            |
| `vdaTds`                 | Section 393(1), table serial 8(vi)     | **verified**, with an addition                                                                                                                                                                  | s.393(1) Table, Sl. No. 8(vi): "Any sum by way of consideration for transfer of a virtual digital asset", payer "Any person", "Rate: 1%", "Threshold limit: Nil". The ₹50,000 / ₹10,000 limits are **not** in that row; they are in the no-deduction table, **s.393(4), Table: Sl. No. 12**.                                                                                                                                                                                                                               | <https://eztax.in/income-tax-act-2025/section-393> (updated 2026-04-30)                              |
| `vdaDefinition`          | Section 2(111)                         | **verified** (indirectly)                                                                                                                                                                       | s.509 says "crypto-asset" has "the meaning assigned to it in section 2(111)(d)"; the s.2 text has "virtual digital asset" with four sub-clauses, the fourth being "any crypto-asset being a digital representation of value that relies on a cryptographically secured distributed ledger...". The clause number itself was not legible in the mirror.                                                                                                                                                                     | <https://eztax.in/income-tax-act-2025/section-509>, <https://eztax.in/income-tax-act-2025/section-2> |
| `platformReporting`      | Section 509                            | **verified**                                                                                                                                                                                    | "Obligation to furnish information on transaction of crypto-asset": a prescribed reporting entity "shall furnish information in respect of a transaction of such crypto-asset in a statement".                                                                                                                                                                                                                                                                                                                             | same; official page <https://www.incometaxindia.gov.in/w/section-509-2>                              |
| `currencyConversionRule` | Rule 206                               | **verified** (official page)                                                                                                                                                                    | Income-tax Rules, 2026, rule 206: "Rate of exchange for conversion into rupees of income expressed in foreign currency ... shall be the telegraphic transfer buying rate of such currency as on the specified date". "Telegraphic transfer buying rate" is defined in **rule 207**.                                                                                                                                                                                                                                        | <https://wm.incometaxindia.gov.in/w/rule-206-1>                                                      |
| 1961 Act column          | 115BBH, 194S, 2(47A), 285BAA, Rule 115 | 115BBH **verified** (the official ITR-2 AY 2026-27 validation rules say "Capital gain chargeable @ 30% u/s 115BBH"); the rest **unverified** this session (consistent across secondary sources) |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | see §2 source                                                                                        |

Rule 206 "specified dates" (verified, same page), relevant to Phase 3:

| Income                                                  | Specified date                                                                                                              |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Dividends                                               | "Last day of the month, immediately preceding the month in which dividend is declared, distributed, or paid by the company" |
| Capital gains                                           | "Last day of the month, immediately preceding the month ... in which the capital asset ... is transferred"                  |
| Salaries                                                | last day of the month before the month salary is due or paid                                                                |
| House property, business, other sources (not dividends) | "Last day of the tax year"                                                                                                  |

Points for the CA:

1. Add a label for the TDS threshold provision (s.393(4), Table: Sl. No. 12) or fold it into the `vdaTds` label. Secondary sources contradict each other
   ("no threshold" vs "₹10,000 / ₹50,000") precisely because the two numbers live in different tables.
2. The ₹50,000 limit applies to a payer who is an individual or HUF whose business turnover did not exceed ₹1 crore (profession: ₹50 lakh) in the preceding tax year,
   or who has no business income; ₹10,000 for everyone else (verified, same source). The limits are tied to the **payer**. SPEC's `specifiedPerson` is a setting on the user, who is usually the seller. Is that the right person?
3. Rule 206 is written for income in a **foreign currency**. USDT is a VDA, not a currency. Printing "Rule 206" as the authority for USDT→INR conversion may claim more than the rule says (see §4).

## 2. Schedule VDA columns (ITR-2 / ITR-3)

Source: CBDT "ITR 2 – Validation Rules for AY 2026-27", Version 1.0, 26 May 2026
(<https://www.incometax.gov.in/iec/foportal/sites/default/files/2026-05/CBDT__e-Filing_ITR%202_Validation%20Rules_AY%202026-27_V1.0.pdf>). Quotes:

- Rule 188: "In Schedule VDA, value at Sl. No. 7 should be equal to Sl. No. 6 - Sl. No. 5".
- Rule 189: "value at 'Total (Sum of all Positive Incomes of Capital Gain in Col. 7) should be equal to sum of col. 7 if head of income is selected as Capital Gain in col. 4".
- Rule 749: "In schedule VDA, Date of Acquisition or Date of transfer cannot be after 31st March of financial year".
- Rule 179: "In Schedule CG, SL. No. C2 Income from transfer of Virtual Digital Assets should be equal to Sl. No. B of Schedule VDA".

| Col | Field                                                                       | Status                                                                |
| --- | --------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| 1   | Sl. No.                                                                     | unverified (assumed)                                                  |
| 2   | Date of Acquisition                                                         | name **verified** (rule 749); position assumed                        |
| 3   | Date of Transfer                                                            | name **verified** (rule 749); position assumed                        |
| 4   | Head under which income to be taxed (Capital Gain / Business or profession) | **verified** (rule 189)                                               |
| 5   | Cost of Acquisition                                                         | position **verified** by rule 188 (7 = 6 − 5); exact label unverified |
| 6   | Consideration Received                                                      | same                                                                  |
| 7   | Income from transfer of Virtual Digital Assets (col. 6 − col. 5)            | **verified** (rules 188, 189)                                         |

| Question                                          | Status                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tax year 2026-27 form (2025 Act)                  | **unverified**: not notified yet. The AY 2026-27 document still cites 115BBH. Expect new labels in 2027; keep the column list in data.                                                                                                                                                                                                                                |
| ITR-3 uses the same schedule                      | **unverified** (ITR-3 validation rules not read)                                                                                                                                                                                                                                                                                                                      |
| Can col. 7 be negative?                           | **conflicting** with SPEC. Rule 188 says 7 = 6 − 5 with no floor, and rule 189 totals only "Positive Incomes", which implies a loss row shows a negative number and is left out of the total. SPEC §4.5 emits `income = max(consideration − cost, 0)`. The tax result is the same; the exported row value may need to be the signed difference. Check in the utility. |
| One row per transfer, or aggregated rows allowed? | **conflicting**: guides say both ("aggregated totals get rejected" vs "aggregated by VDA + holding period"). Nothing in the validation rules requires either.                                                                                                                                                                                                         |
| Asset name / quantity columns                     | Not part of the schedule per the rules above. Export the seven ITR columns first, extras after.                                                                                                                                                                                                                                                                       |
| Which date for a swap leg, and IST vs UTC         | Date fields are dates only; the 31 March check makes the IST conversion matter (fixtures include trades two seconds either side of midnight IST).                                                                                                                                                                                                                     |

## 3. Are trading fees deductible?

| Point                                                         | Status                                                         | Basis                                                                                                                                                                                                             |
| ------------------------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Only cost of acquisition is deductible; no other expenditure  | **verified**                                                   | s.194(1) Table Sl. No. 4, column E(a), quoted in §1 (same wording as old s.115BBH)                                                                                                                                |
| No set-off of a VDA loss even against another VDA gain        | **verified**                                                   | same clause: no "set off of any loss ... in computing the income"; SPEC's per-row `max(…, 0)` matches                                                                                                             |
| Sell-side fee reduces consideration                           | **conflicting**; strict reading says no (it is an expenditure) | no primary source found either way                                                                                                                                                                                |
| Buy-side fee (and GST on it) is part of "cost of acquisition" | **conflicting**                                                | "cost of acquisition" is not defined for VDAs. Guides mostly say fees are excluded; KoinX excludes by default and has a setting to include (<https://guides.koinx.com/guides/tax-reports/schedule-vda-report.md>) |
| TDS deducted is not a cost; it is a credit                    | consistent across sources, **unverified** in primary text here |                                                                                                                                                                                                                   |

SPEC default `feeTreatment = exclude` is the conservative reading. Keep the toggle.

Related, for the "TDS that may have been due" figure: CoinDCX states its TDS is computed on the order value net of fees, citing a CBDT circular of June 2022
(seen in a search snippet, **unverified**). SPEC computes 1% of consideration. Ask whether the base is gross or net of fees and GST.

## 4. Rupee value of a USDT-priced trade

| Point                                                                  | Status                                                                                                                                                                                                                                                                                      |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Crypto-to-crypto is a transfer, valued in INR at the time of the trade | consistent across guides; **unverified** in primary text. s.194 says that for Table Sl. No. 4 "the term 'transfer' as defined in section 2(109), shall apply to any virtual digital asset, whether capital asset or not" (**verified**, <https://eztax.in/income-tax-act-2025/section-194>) |
| Which INR rate to use for USDT                                         | **conflicting / no authority found**. No rule prescribes a method for VDA-to-VDA valuation.                                                                                                                                                                                                 |

Methods seen:

| Method                                                               | Who uses it                                                                                                                                      | Note                                                                                                                                                                  |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Exchange's own INR equivalent on the trade                           | CoinDCX's report has an INR column for USDT pairs (see `export-formats.md` B4); guides say Indian exchanges show an INR equivalent               | closest to a market value; only exists for Indian platforms                                                                                                           |
| USDT/INR market price at trade time                                  | tax tools ("INR Fair Market Value ... at the exact time of the swap", <https://www.koinx.com/in/tax-guides/tax-on-crypto-to-crypto-swaps-india>) | needs a price source; USDT in India usually trades above the bank USD rate                                                                                            |
| SBI TT buying rate for USD (Rule 115 / 206), treating 1 USDT = 1 USD | common shortcut for foreign-platform trades                                                                                                      | the rule is about foreign-currency income; and if it is followed literally for capital gains, the date is the **last day of the preceding month**, not the trade date |

SPEC default (`ledger_usdt_inr`, falling back to `sbi_usd_tt` on the trade date) mixes the second and third methods. Questions:

1. Is the SBI USD rate acceptable for USDT at all, given the usual USDT premium in India? It understates both cost and consideration.
2. If SBI is used: trade-date rate, or month-end-before rate as rule 206 prescribes for capital gains?
3. Must the same method be used for the buy and the later sale of the same coins?
4. On 12 dates the SBI file has two publications with different TT buying rates (`packages/rates/data/README.md`). First or last of the day?

## 5. Not checked this session (all **unverified**)

- 4% cess and the surcharge slabs under the 2025 Act / current Finance Act.
- Gift threshold ₹50,000 and its new section number.
- US equity: 24 months, 12.5%, no indexation; US withholding 25%.
- Schedule FA on calendar-year basis, and whether coins on a foreign platform belong in it.
- FIFO vs other lot methods, global vs per-exchange pools (plan §11; no rule found prescribing one).
- Cost basis of staking / airdrop receipts on later sale.
- Who must deduct TDS on a Binance P2P sale.
