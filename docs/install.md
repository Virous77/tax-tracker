# Install guide

> **Pre-release. Not tax advice.** The tax rules are pending review by a Chartered Accountant. Check every
> figure with a CA before you file.

For a local Docker install, tax-tracker runs in one app container and stores its data in `./data`, next to
`docker-compose.yml`.

## Deploy on Railway

For a hosted instance, connect the GitHub repository to Railway, mount a persistent volume at `/data`, and paste
the [Railway variables template](../.env.railway.example) into the service's **Variables → Raw Editor**. Set a
strong password before making the service public. Follow the [Railway deployment guide](deploy-railway.md).

## 1. Install Docker

| System  | What to install                                                                                                                                                                                                                        |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| macOS   | [Docker Desktop for Mac](https://docs.docker.com/desktop/setup/install/mac-install/) (Apple silicon or Intel). Start it once and wait until it says it is running.                                                                     |
| Windows | [Docker Desktop for Windows](https://docs.docker.com/desktop/setup/install/windows-install/) with the WSL 2 backend. Clone the repository inside your WSL distribution (for example `~/tax-tracker` in Ubuntu) for faster file access. |
| Linux   | [Docker Engine](https://docs.docker.com/engine/install/) and the [Compose plugin](https://docs.docker.com/compose/install/linux/), or Docker Desktop for Linux.                                                                        |

Check it works:

```sh
docker compose version
```

You also need `git`, or download the repository as a ZIP from GitHub and unpack it.

## 2. Start the app

```sh
git clone https://github.com/Virous77/tax-tracker.git
cd tax-tracker
cp .env.example .env
docker compose up -d --build
```

The first build takes a few minutes. Open <http://localhost:3000>. On first visit a notice explains what the tool is and is not; accept it to
continue.

No exports of your own yet? Use **Try with sample data** on the Overview page, or import the synthetic files in
[`examples/`](../examples/) (see the [user guide](user-guide.md#try-it-with-the-example-files)).

### Published image or local build

`docker-compose.yml` keeps `build: .` and runs whatever image `TAX_TRACKER_IMAGE` names:

- **Local build (the default).** `docker compose up -d --build` builds from the source you cloned and tags the
  result `tax-tracker:local`. That name is the default in `docker-compose.yml` and in `.env.example`, so it applies
  with or without a `.env` file. It never takes the published name, and `docker compose pull` never replaces it. Use
  this until the first release is published (no image is published before the tax rules are signed off by a CA), if
  you changed the code, or if you want to run exactly the source you read.
- **Published image (after a release).** Set `TAX_TRACKER_IMAGE=ghcr.io/virous77/tax-tracker:<release-tag>` in
  `.env` (for example `ghcr.io/virous77/tax-tracker:v0.1.0`), then run
  `docker compose pull && docker compose up -d`. It is built for `linux/amd64` and `linux/arm64`. Your `data/`
  folder is the same either way.

**Running more than one copy on one machine?** Give each its own `TAX_TRACKER_IMAGE`, `APP_PORT` and project name
(`COMPOSE_PROJECT_NAME` in its `.env`). Otherwise two clones build into the same `tax-tracker:local` tag and
overwrite each other's image, and their ports clash.

To see which version is running, ask the app itself (use your `APP_PORT`):

```sh
curl http://localhost:3000/api/health     # {"ok":true,"version":"…","dbOk":true}
```

`docker compose images app` shows the image name, but after a rebuild it can show `<none>` or a bare image id;
`/api/health` is the reliable check.

## 3. Configuration (`.env`)

Every setting is optional. To change one, copy the example file and edit it:

```sh
cp .env.example .env
```

Docker Compose reads `.env` from the repository root. Restart after a change with `docker compose up -d`.

| Variable                  | Default                              | What it does                                                                                                                                                                                |
| ------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NEXT_TELEMETRY_DISABLED` | `1`                                  | Keeps Next.js telemetry off. The image sets this too. Leave it as is.                                                                                                                       |
| `APP_BIND_ADDRESS`        | `127.0.0.1`                          | Host address the port is published on. The default allows only this computer. See [§4](#4-ports-and-network-exposure) before changing it.                                                   |
| `APP_PORT`                | `3000`                               | Port on your computer that serves the app.                                                                                                                                                  |
| `DATA_DIR`                | `./data`                             | Data folder when running with `pnpm dev`. Docker always uses `/data` inside the container.                                                                                                  |
| `DATA_HOST_DIR`           | `./data`                             | Folder on your computer that Docker mounts as `/data`. Set an absolute path if your clone is somewhere Docker Desktop cannot share.                                                         |
| `APP_PASSWORD`            | empty                                | Empty: no login (fine for `localhost`). Set it to require a password for every page and API. **Required before you expose the app on a network.**                                           |
| `APP_SECRET`              | empty                                | Secret that signs login cookies. Empty: a private one is generated in `data/.session-secret`.                                                                                               |
| `AI_BASE_URL`             | `http://ollama:11434/v1`             | OpenAI-compatible endpoint for the optional AI recipe assistant. The default is the local Ollama container. Settings saved in the app take precedence.                                      |
| `AI_MODEL`                | empty                                | Model name for the AI assistant, for example one you pulled into Ollama.                                                                                                                    |
| `AI_API_KEY`              | empty                                | Key for a cloud AI endpoint. Not needed for Ollama.                                                                                                                                         |
| `SECRETS_PASSPHRASE`      | empty                                | Unlocks the key vault automatically at startup. **Weaker:** anyone who can read the container environment can decrypt your stored exchange keys. Leave empty and unlock in the app instead. |
| `BINANCE_API_BASE`        | `https://api.binance.com`            | Binance account API used by sync. Override only for a server you intend to contact (tests use a local mock).                                                                                |
| `BINANCE_DATA_BASE`       | `https://data-api.binance.vision`    | Binance public market data, used for daily prices.                                                                                                                                          |
| `COINDCX_API_BASE`        | `https://api.coindcx.com`            | CoinDCX API used by sync.                                                                                                                                                                   |
| `ETHERSCAN_API_BASE`      | `https://api.etherscan.io/v2/api`    | Etherscan V2 API for EVM wallets.                                                                                                                                                           |
| `BLOCKSCOUT_API_BASE`     | `https://api.blockscout.com/v2/api`  | Blockscout API for EVM wallets.                                                                                                                                                             |
| `ALCHEMY_API_BASE`        | `https://{network}.g.alchemy.com/v2` | Alchemy API for EVM wallets (`{network}` is filled per chain).                                                                                                                              |
| `NODEREAL_API_BASE`       | `https://bsc-mainnet.nodereal.io/v1` | NodeReal API for BNB Chain wallets.                                                                                                                                                         |
| `COINGECKO_API_BASE`      | `https://api.coingecko.com/api/v3`   | CoinGecko Demo API, the optional price fallback.                                                                                                                                            |
| `POLYGON_API_BASE`        | `https://api.polygon.io`             | Polygon.io (Massive) API for optional historical US stock prices.                                                                                                                           |
| `FINNHUB_API_BASE`        | `https://finnhub.io/api/v1`          | Finnhub API for optional historical US stock prices.                                                                                                                                        |

Image and build variables (compose only):

| Variable                     | Default             | What it does                                                                                                                 |
| ---------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `TAX_TRACKER_IMAGE`          | `tax-tracker:local` | Image to run or to tag a local build as. Give each copy on one machine its own; see [§2](#published-image-or-local-build).   |
| `TAX_TRACKER_VERSION`        | empty               | Version label written into a local build's image metadata.                                                                   |
| `TAX_TRACKER_REVISION`       | empty               | Git commit written into a local build's image metadata.                                                                      |
| `TAX_TRACKER_REPOSITORY_URL` | empty               | Source repository written into a local build's image metadata.                                                               |
| `SOURCE_URL`                 | empty               | Link shown as **Source code** in the app footer (AGPL §13). Set it if you run a modified copy for others. Hidden when empty. |

An empty `*_API_BASE` uses the production address shown. Nothing is contacted until you turn on the matching
feature; see [Privacy in the README](../README.md#privacy).

## 4. Ports and network exposure

By default Docker publishes the app on `127.0.0.1:3000`, so only your own computer can open it. Change the port
with `APP_PORT`.

To open it from another device on your home network (a phone, another laptop):

1. Set a strong `APP_PASSWORD` in `.env`. **Never expose the app without one**: in local mode anyone who can
   reach the port can read your whole tax history.
2. Set `APP_BIND_ADDRESS` in `.env` to your computer's LAN address (for example `192.168.1.20`), or to `0.0.0.0`
   for all interfaces.
3. Run `docker compose up -d` and open `http://<your-computer's-LAN-IP>:3000`.

Do not expose it to the internet. If you must reach it remotely, use a VPN or an HTTPS reverse proxy you
control. Login cookies are marked `Secure` over HTTPS, expire after 12 hours, and ten failed logins lock the
login for 15 minutes.

## 5. The data folder

Everything lives in `./data` (or `DATA_HOST_DIR`):

| Path                                          | Contents                                                                                        |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `data/tax-tracker.db`                         | The SQLite database: imports, original rows, ledger, recipes, settings, reports, encrypted keys |
| `data/tax-tracker.db-wal`, `-shm`             | SQLite write-ahead log files. Part of the database while the app runs                           |
| `data/backups/`                               | Automatic copies made before each database upgrade (the newest 5 are kept)                      |
| `data/.session-secret`, `data/.session-epoch` | Login cookie secret and session generation, only used with `APP_PASSWORD`                       |

Treat this folder as sensitive: it holds your full trading history. It is in `.gitignore`; never commit it.
Exchange and provider keys inside it are encrypted with your vault passphrase.

## 6. Optional: local AI with Ollama

The AI assistant only helps write a column mapping ("recipe") for an unknown CSV. It is never needed for
Binance or CoinDCX files, and you can always fill the recipe in by hand.

```sh
docker compose --profile ai up -d
docker compose exec ollama ollama pull <model>
```

Pick a model that supports structured JSON output (see `docs/research/ollama-structured-output.md`). Then in
**Settings → AI Recipe Assistant** keep the base URL `http://ollama:11434/v1` and enter the exact model name
you pulled. Startup never downloads a model or contacts an AI service.

A cloud endpoint also works (any OpenAI-compatible `/v1/chat/completions` with JSON-schema output), but it
needs your own key and an explicit acknowledgement in Settings that the CSV headers and up to 20 sample rows
will be sent to it.

## 7. Updating

```sh
git pull
docker compose up -d --build --force-recreate    # local build
```

`--force-recreate` makes sure the container restarts on the new image; without it, compose can report the
container as `Running` and keep the old one. With the published image:
`docker compose pull && docker compose up -d`.

Confirm what is running with `curl http://localhost:3000/api/health` (use your `APP_PORT`): the `version` field is
the version of the running app.

When a new version includes database changes, the app copies the database to
`data/backups/tax-tracker-<UTC time>-pre-<migration>.db` **before** applying them, using SQLite's online
backup, and keeps the newest five. You still should take your own backup before a big update (next section).

After an update, recompute your reports: stored reports are invalidated when the calculation changes.

## 8. Backup and restore

**Back up** in either of two ways:

- In the app: **Settings → Download backup** saves a consistent copy of the live database as
  `tax-tracker-<time>.db`.
- By hand: stop the app (`docker compose stop`), copy `data/tax-tracker.db` (and any `-wal` file next to it),
  then start it again (`docker compose start`). Copying while the app runs can miss recent changes.

Keep backups somewhere encrypted. They contain your history and your encrypted keys.

**Restore** (there is no restore button, on purpose). Run these from the repository folder, in this order:

1. Stop the app, so nothing writes to the database:

   ```sh
   docker compose stop
   ```

2. Delete the write-ahead log files. A leftover `-wal` file belongs to the old database and can roll back or
   corrupt the restored one:

   ```sh
   rm -f data/tax-tracker.db-wal data/tax-tracker.db-shm
   ```

3. Replace the database with your backup:

   ```sh
   cp /path/to/backup.db data/tax-tracker.db
   ```

4. **Linux only:** give the file to uid 1000, the user the app runs as:

   ```sh
   sudo chown 1000:1000 data/tax-tracker.db
   ```

5. Start the app again:

   ```sh
   docker compose start
   ```

If you set `DATA_HOST_DIR`, use that folder instead of `data/`.

**Restoring into a new, empty data folder** (for example on a new machine): create the folder, copy the backup
in as `tax-tracker.db`, chown it on Linux as in step 4, point `DATA_HOST_DIR` in `.env` at it, then run
`docker compose up -d` instead of `docker compose start`. `start` reuses the existing container and ignores a
changed `DATA_HOST_DIR`; `up -d` recreates the container with the new folder.

Your vault passphrase is the one that was in use
when the backup was taken. Stored reports come back with the backup; recompute them if you changed settings since.

## 9. Uninstall

From the repository folder, one command stops and removes the containers, the Ollama model volume (`ollama`,
if you used the AI profile) and every image the services use:

```sh
docker compose --profile ai down --volumes --rmi all
```

`--rmi all` removes the app image under the name compose resolves from `TAX_TRACKER_IMAGE`, and the
`ollama/ollama` image when `--profile ai` is given. To remove the images by hand instead, first read the app
image's name: it is the `TAX_TRACKER_IMAGE` line in `.env`, or `tax-tracker:local` (the compose default) when that
line is missing or commented out.

```sh
grep '^TAX_TRACKER_IMAGE=' .env           # prints the name, if it is set
docker compose images                     # or list what the running stack uses (before `down`)
docker image rm tax-tracker:local         # the name you found
docker image ls ollama/ollama             # AI users: the Ollama image (pinned by digest, so its tag may show <none>)
docker image rm <IMAGE ID from the line above>
```

Optional: Docker keeps a build cache after the image is gone. `docker builder prune` frees it, but that cache is
shared with every other project you build with Docker on this machine, so they will rebuild from scratch next time.

Then delete the `tax-tracker` folder. **This deletes `data/` and your whole history**; download a backup first
if you might need it.

## 10. Troubleshooting

**Port already in use** (`bind: address already in use`): another program uses port 3000. Set `APP_PORT=3001`
in `.env` and run `docker compose up -d`, then open <http://localhost:3001>.

**Permission denied on the data folder (Linux).** The app runs as uid 1000, not root. A one-shot `data-init`
service hands the bind folder to uid 1000 on start. If you created `data/` yourself, use another
`DATA_HOST_DIR`, or SELinux blocks it, fix ownership by hand:

```sh
sudo chown -R 1000:1000 data
```

On SELinux systems (Fedora, RHEL) you may also need to add `:z` to the volume lines in `docker-compose.yml`.

**Is it healthy?**

```sh
docker compose ps                         # STATUS should say (healthy)
curl http://localhost:3000/api/health     # {"ok":true,"version":"…","dbOk":true}
docker compose logs app --tail 100
```

Logs never contain keys, secrets or request bodies.

**Docker Desktop cannot mount the folder** (`mounts denied`, or an empty data folder): your clone is outside the
folders Docker Desktop shares. Either move the clone under your home folder, add its folder in Docker Desktop
→ Settings → Resources → File sharing, or set `DATA_HOST_DIR` to an absolute path inside a shared folder.

**The page asks for a password you never set:** `APP_PASSWORD` is set in `.env` or your shell. Remove it and run
`docker compose up -d`.

**Sync says the vault is locked:** open **Connections** and unlock it. The vault locks after 30 minutes idle and
on every restart unless `SECRETS_PASSPHRASE` is set.
