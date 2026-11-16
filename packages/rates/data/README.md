# SBI USD/INR reference rates (bundled data)

`SBI_REFERENCE_RATES_USD.csv` is an unmodified copy of one file from the community project
**SBI FX RateKeeper**. It is third-party data: read it, validate it, never execute anything from that repo.

|                |                                                                                                                                                 |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Upstream repo  | <https://github.com/sahilgupta/sbi-fx-ratekeeper> (formerly `sahilgupta/sbi_forex_rates`)                                                       |
| Upstream path  | `csv_files/SBI_REFERENCE_RATES_USD.csv` (file name kept as upstream)                                                                            |
| Commit fetched | `477ed9d3ee653cefb596a9b2d943123074833f70` (committed 2026-11-15T17:17:02Z)                                                                     |
| Fetched on     | 2026-11-16                                                                                                                                      |
| Pinned URL     | <https://raw.githubusercontent.com/sahilgupta/sbi-fx-ratekeeper/477ed9d3ee653cefb596a9b2d943123074833f70/csv_files/SBI_REFERENCE_RATES_USD.csv> |
| SHA-256        | `d45075f5ac678650f9e04d6c107a38244a7178e0b75b5e2bd1ae9a056ab32d03`                                                                              |
| Size           | 260,310 bytes, 1 header line + 1,689 data rows                                                                                                  |
| Encoding       | ASCII, no BOM, **CRLF** line endings, 10 columns on every row                                                                                   |
| Licence        | MIT (text below)                                                                                                                                |

Refresh (then update the commit, date, SHA-256 and row counts above):

```sh
curl -fsSL -o packages/rates/data/SBI_REFERENCE_RATES_USD.csv https://raw.githubusercontent.com/sahilgupta/sbi-fx-ratekeeper/main/csv_files/SBI_REFERENCE_RATES_USD.csv && git ls-remote https://github.com/sahilgupta/sbi-fx-ratekeeper refs/heads/main && shasum -a 256 packages/rates/data/SBI_REFERENCE_RATES_USD.csv
```

## Columns

All rates are **rupees per 1 US dollar**, as printed on SBI's daily forex card-rate PDF.

| #   | Header (exact)           | Meaning                                                                                                                                                                        |
| --- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `DATE`                   | `YYYY-MM-DD HH:MM`, date and time printed on SBI's sheet. Time zone is not stated upstream; SBI publishes in India, so read it as IST. Only the date part matters for lookups. |
| 2   | `PDF FILE`               | URL of the archived SBI PDF for that row (evidence). 1,036 older rows use the repo's old name `sbi_forex_rates`.                                                               |
| 3   | **`TT BUY`**             | **Telegraphic transfer buying rate. This is the column the app uses** (Rule 115 of the 1962 Rules / Rule 206 of the 2026 Rules).                                               |
| 4   | `TT SELL`                | Telegraphic transfer selling rate.                                                                                                                                             |
| 5   | `BILL BUY`               | Bill buying rate.                                                                                                                                                              |
| 6   | `BILL SELL`              | Bill selling rate.                                                                                                                                                             |
| 7   | `FOREX TRAVEL CARD BUY`  | Forex travel card buying rate.                                                                                                                                                 |
| 8   | `FOREX TRAVEL CARD SELL` | Forex travel card selling rate.                                                                                                                                                |
| 9   | `CN BUY`                 | Currency notes buying rate.                                                                                                                                                    |
| 10  | `CN SELL`                | Currency notes selling rate.                                                                                                                                                   |

Numbers are plain decimals with 0, 1 or 2 decimal places (`86`, `85.1`, `83.05`). Parse them as decimal strings.

## Coverage

- First row `2020-01-04`, last row `2026-11-13`. Rows are in ascending date order.
- 1,677 distinct dates; **1,623 dates have a usable `TT BUY`** (min 70.45, max 96.45).
- SBI publishes no card on Sundays and bank holidays, and skips some working days.

## Known gaps and traps (found by inspecting this copy)

1. **`TT BUY` = `0` / `0.00` on 54 rows.** All are Saturdays between 2020-01-04 and 2022-09-17 (SBI printed
   card and note rates but no TT rate). Treat zero as "no rate published", never as a rate.
2. **12 dates appear twice** (SBI re-published during the day): 2024-06-04, 2024-09-20, 2024-11-26, 2025-01-22,
   2025-02-14, 2025-03-07, 2025-04-09, 2025-05-22, 2025-07-24, 2025-11-21, 2025-12-19, 2026-07-14.
   On 9 of them the two `TT BUY` values differ (by up to 0.70). The loader must pick one deterministically
   and say which; which publication counts for tax is an open question for the CA
   (see `docs/research/tax-open-questions.md`).
3. **Gaps longer than 4 days (16).** Longest: 2021-07-26 → 2021-08-18 (23 days), 2020-05-12 → 2020-05-30 (18),
   2020-04-30 → 2020-05-12 (12), 2020-08-14 → 2020-08-25 (11), 2020-04-04 → 2020-04-13 (9), 2020-04-20 → 2020-04-29 (9).
4. **Month ends without a nearby rate** (last usable `TT BUY` is 3 or more days before month end):
   May 2020 (12 May), Nov 2020 (27 Nov), Jul 2021 (26 Jul), Apr 2024 (26 Apr). This matters for the
   "last day of the preceding month" rule; the lookup returns the last published rate on or before the date
   and reports the date used.
5. **31 March is missing in some years**: 2024 (last rate 30 Mar) and 2025 (last rate 29 Mar).
6. Data before December 2022 was back-filled upstream from other archives (see credits below); it has not been
   re-checked against SBI's PDFs here.
7. The file ends at the fetch date. Dates after the last row have no rate: return "none", do not reuse the last row silently
   for a date far in the future.

## Attribution and licence

Data collected and published by Sahil Gupta and contributors of SBI FX RateKeeper. Upstream credits for data before
December 2022: Shivam Khandelwal (`skbly7/sbi-tt-rates-historical`), the forex rate card archives of
Maneesh K. Singh & Co., and the Internet Archive Wayback Machine. The underlying rates are published by State Bank of India.

Upstream `LICENSE`, reproduced in full:

```
MIT License

Copyright (c) 2022 Sahil Gupta

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
