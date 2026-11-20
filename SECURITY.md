# Security policy

tax-tracker holds people's full trading history and exchange API keys, so security reports are very welcome.

## Reporting a vulnerability

**Please do not open a public issue.** Report privately through GitHub:

1. Open the repository's **Security** tab.
2. Choose **Report a vulnerability** (GitHub private vulnerability reporting / Security Advisories).
3. Describe the problem, the affected version or commit, and steps to reproduce. Use synthetic data only: never
   include real exports, API keys, wallet addresses or your database.

You should get an acknowledgement within a few days. Fixes are released as a new version with a GitHub Security
Advisory, and reporters are credited unless they prefer otherwise. The project is maintained by volunteers; there is
no bug bounty.

## Supported versions

The project is pre-1.0. Only the latest release and the `main` branch receive fixes.

## Scope

In scope:

- The web app and its `/api` routes (authentication with `APP_PASSWORD`, sessions, same-origin checks, file upload
  and parsing, exports).
- The key vault and anything that could expose stored exchange or provider keys.
- Parsers for untrusted files (CSV, XLSX, PDF): crashes, resource exhaustion beyond the documented limits, formula
  injection in exports.
- Outgoing requests: anything that makes the app contact a host the user did not turn on, or leaks keys, addresses or
  data to one.
- The Docker image and `docker-compose.yml` defaults.
- Supply-chain problems in this repository's dependencies or workflows.

Out of scope:

- Wrong tax results. Those are bugs (please open an issue), not vulnerabilities; the output is not tax advice.
- Attacks that need control of the host, the Docker daemon or the data folder.
- Exposing the app on a network without `APP_PASSWORD`, against the documentation.
- Weaknesses in third-party exchanges, explorers or AI services themselves.
- `SECRETS_PASSPHRASE` being readable by anyone who can inspect the container environment; this trade-off is
  documented.

## How keys are handled

- **Exchange and provider keys** (Binance, CoinDCX, Etherscan, Blockscout, Alchemy, NodeReal, CoinGecko) are stored
  only in the local database, encrypted with **AES-256-GCM** under a key derived from your vault passphrase with
  **scrypt** (N=2^17, r=8, p=1). Each secret has its own random 12-byte IV and is bound to its id and kind as
  authenticated data. A wrong passphrase or tampered ciphertext fails to decrypt.
- The derived key exists only in memory. The vault locks after 30 minutes idle, on lock, on logout and on restart.
  The passphrase itself is never stored.
- Keys are **never returned by the API** (only `keySet: true/false`) and **never logged**. The HTTP layer logs only
  method, host and path, status and duration: never query strings, bodies, headers, signatures or keys.
- The app asks for **read-only** exchange keys, checks the permissions after you save one, and warns loudly if a key
  can trade or withdraw. CoinDCX keys cannot be limited to read-only; the app says so.
- **AI endpoint key.** The optional `AI_API_KEY` (or the key typed in Settings) is kept in the settings table, not in
  the vault, and is never returned by the API. It is included in database backups.
- **PDF passwords** are used once for the import and never stored, returned or logged.
- No telemetry, analytics or calls home. Outgoing requests happen only for features the user turned on; see the
  README's Privacy section.

## What we never do

- Ask for withdrawal or trading permissions, private keys or seed phrases.
- Send your data, keys or addresses anywhere you did not configure.
- Ship a hosted service that holds user data.
