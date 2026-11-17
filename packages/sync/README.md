# Exchange sync

`@tax/sync` exports `binanceConnector: Connector<BinanceSyncOptions>` and
`coindcxConnector: Connector<CoinDcxSyncOptions>`, their clients, signature functions and pure
`mapBinance*` / `mapCoinDcxTrade` mappers. Connectors perform no database writes. The app assigns
ledger ids, persists batches and cursors together, and handles cross-channel deduplication.

`@tax/sync/http` (also exported from the package root) exports `HttpClient`, `createHttpClient`,
`parseJsonWithSource`, `HttpOptions`, `HttpRequest`, and the four `Upstream*Error` classes.
`new HttpClient(options).request(url, init)` returns `Promise<unknown>`; all JSON numbers become
their original source strings. The options support fetch/clock/sleep/random injection, timeouts,
retry count, a host interval and an optional redacted logger. `prepare(url, request)` runs after
throttling on every attempt so authenticated requests receive fresh timestamps and signatures.
`notBeforeMs` permits a venue budget to defer the current request rather than just the next one.

Binance streams:

- `binance:myTrades:<symbol>` uses ascending `fromId` and stable trade ids; symbol discovery combines
  known ledger assets, non-trade movements, balances and explicit extra symbols. Missing metadata
  for a manually supplied pair uses known quote splitting; unavailable pairs are reported incomplete.
- Deposits and withdrawals walk 89-day windows with offset paging, seven-day overlaps and an
  oldest-pending timestamp. Only settled statuses affect the ledger.
- Convert walks 30-day windows, splitting ranges when `moreData` is true. Dividends walk 180-day
  windows backwards within each window, preserving timestamp ties and flagging saturated ties.
- Fiat orders and payments walk 89-day windows in both directions. P2P walks 30-day windows in both
  directions with its six-month limit explicitly reported. Their cursors overlap three days.
- Dust always re-fetches its latest records and reports the 100-record / 2020-12-01 history limit.
- Flexible and locked Earn rewards walk 30-day windows. They produce amount-free audit rows, not
  additional income: research §1.3 explicitly designates dividends as the single income feed until
  overlap is verified. Unknown reward types receive `unknown_type`.
- Balances include spot, funding and flexible/locked Earn positions, summed by wallet and asset.
  An unavailable Earn position route marks sync balance discovery incomplete; `balances()` fails
  rather than presenting a partial snapshot as complete.

CoinDCX syncs trades with an ascending, inclusive/exclusive-tolerant `from_id` cursor and fetches
balances. Deposit/withdrawal history and TDS/GST are unavailable in its API. Fee currency is assumed
to be quote with `parse_warning`. No TDS flag or invented TDS amount is added. `checkKey()` cannot
verify permissions and returns `readOnly: null` with the required notice.

Raw rows retain number text. The documented P2P privacy exception replaces only
`counterPartNickName` with `<removed>`. Unsupported classifications retain raw data in amount-free
`fee` review rows because the core contract has no `unknown` transaction type. Known unsettled
exchange statuses are not ledger events; pending timestamps keep those windows eligible for replay.

Public default hosts and custom mock hosts are contacted only when a caller invokes a connector.
No logger is enabled by default. No keys, signed URLs or raw response messages appear in logs/errors.

The shared mock's Earn position endpoints were unavailable during implementation. The integration
suite also uses an independent in-process HTTP stub to exercise the complete Binance contract.

Additional shared-mock differences to resolve before using it as a balance gate:

- Its withdrawal `amount` is gross (the wallet receives amount minus fee), and its dust received
  amount is already net of service charge. Research §1.3 calls both meanings unverified but §1.5
  requires the explicit fee fields. These mappings retain the supplied amounts/fees and flag
  `fee_review_required`; they do not silently change quantities to force reconciliation.
- Its Earn reward is credited to balances without a matching dividend, whereas the research
  requires dividend-only income pending overlap verification. Audit rows deliberately do not add
  another receipt. That fixture therefore cannot prove dividend-only income reconciles.
- Its April 2025 P2P acquisition is outside the real six-month API window at the current clock.
  An older file import is needed for complete Binance history, just as for a real account.

Integration assertions cover stream completion/notices, mapping, signatures, resume behaviour and
paging. They do not claim that these unresolved Binance fixture assumptions pass a balance gate.
