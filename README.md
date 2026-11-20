# tax-tracker

> **Pre-release (v0.x). Not tax advice.** The tax rules have not yet been reviewed by a Chartered
> Accountant. Do not file a return based on this tool's output without a CA checking it.

A free, open-source, self-hosted helper that turns your crypto history (Binance, CoinDCX, EVM wallets) into
the rows the Indian income-tax return asks for: Schedule VDA, TDS and the supporting workings. US stocks
(Form 67, Schedule FA) are planned.

- **Your data stays on your machine.** No telemetry, no accounts, no hosted copy. Network calls happen only
  for features you turn on (exchange sync, chain lookups, price lookups).
- **Every number is traceable** to the original exported or synced row.
- **Missing history is flagged, never guessed.**

## Quick start

Requires Docker.

```sh
git clone https://github.com/Virous77/tax-tracker.git
cd tax-tracker
cp .env.example .env
docker compose up -d --build
```

Open <http://localhost:3000>. Your data lives in `./data` (back it up by copying `data/tax-tracker.db`).

Full install, user and contributor guides are being written for the first release.

## Licence

[AGPL-3.0-only](LICENSE). If you run a modified copy as a network service, you must offer its source to
its users.
