# Deploy on Railway

> **Pre-release. Not tax advice.** Have a Chartered Accountant check every figure before filing.

1. **Connect the repository.** In Railway, create a project, choose **Deploy from GitHub repo**, and select
   `Virous77/tax-tracker` or your fork. Deploy a **single service** with its root directory at the repository
   root so Railway builds the root `Dockerfile` (which runs the web app). You do not need a separate service for
   `apps/cli` — the CLI is for local terminal use only.
2. **Add a persistent volume.** Attach a volume to the Tax Tracker service and set the mount path to `/data`.
   This keeps the SQLite database, encrypted Secrets Vault and session files across redeploys. Use one replica
   for the single SQLite database. Expect a brief interruption during redeploys with a volume attached.
   [Railway volume guide](https://docs.railway.com/volumes).
3. **Add variables.** In the service's **Variables → Raw Editor**, paste
   [`.env.railway.example`](../.env.railway.example) and replace `APP_PASSWORD` with a strong, unique
   passphrase. `RAILWAY_RUN_UID=0` lets the entrypoint set volume ownership before switching to the unprivileged
   `node` user. Leave `PORT` unset to use the port Railway assigns. When `APP_SECRET` is blank, the app
   generates a signing secret and stores it in `/data/.session-secret`.
4. **Check deployment settings.** In **Settings → Deploy**, set **Healthcheck Path** to `/api/health`,
   **Healthcheck Timeout** to `120` seconds and **Restart Policy** to **On Failure** with `5` retries. Keep one
   replica. Existing services using Railway's legacy Config as Code get these values from `railway.toml`
   until Railway's December 1, 2026 cutoff. [Railway Config as Code reference](https://docs.railway.com/config-as-code).
5. **Open the app.** Apply the staged changes, wait for the deployment to become healthy, then use
   **Settings → Networking → Generate Domain**. Railway provides HTTPS, and Tax Tracker marks its session
   cookies `Secure` using the proxy's `X-Forwarded-Proto` header.
   [Railway public networking reference](https://docs.railway.com/networking/public-networking/specs-and-limits).

## After you deploy

- Open the public HTTPS URL and sign in with your `APP_PASSWORD` before importing tax files.
- In **Connections** (`/connections`), set up the encrypted Secrets Vault with its own passphrase if you plan
  to store provider keys. Leave `SECRETS_PASSPHRASE` blank to unlock it manually. Anyone who can read that
  variable can unlock the Vault when it is set.
- Enable market price lookups in **Settings** if you want them. In **Connections**, optionally add Polygon.io
  (Massive) or Finnhub keys for US stock prices, or a CoinGecko Demo key for fallback crypto prices. Check each
  provider's free-tier coverage for the history you need.
- Download periodic database backups from **Settings** (`/settings`) and keep them somewhere private.

## Public demo

Keep `DEMO_MODE=false` for private deployments. On a separate instance with synthetic data only,
set `DEMO_MODE=true` to show a public-demo warning on `/login` and in the workspace and offer
synthetic CSV downloads on `/login`. The login page displays the configured `APP_PASSWORD` by
default. Set `DEMO_PASSWORD` to publish a separate passphrase that also unlocks the demo.

## Troubleshooting

If Railway's monorepo importer fills in a **Custom Start Command** for `@tax/web`, such as a
`pnpm` command, clear it in **Settings → Deploy**. Railway will then use the Dockerfile's
`CMD ["node", "scripts/docker-entrypoint.mjs"]`.
