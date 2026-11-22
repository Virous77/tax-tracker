import type { VdaRules } from "@tax/rules";
import { DocLink, DocSection, ReferenceTable, Topic } from "./DocUi";
import { settingsReference } from "./docs-data";
import { PROVIDER_REFERENCE, REVIEW_FIXES } from "./reference-data";

export function ReferenceSection({ rules }: { rules: VdaRules }) {
	return (
		<DocSection
			id="reference"
			title="Settings, review flags & privacy"
			intro="Keep assumptions visible, investigate uncertainty and enable only the integrations you need."
		>
			<Topic title="Settings and defaults">
				<p>
					These are application defaults, not your saved workspace settings.
					Open <DocLink href="/settings">Settings</DocLink> to review the values
					used in your reports. Settings and section labels accompany exports;
					recompute after changes.
				</p>
				<ReferenceTable
					caption="Engine settings · defaults from the shared schema"
					headers={["Setting", "Default and meaning"]}
					rows={settingsReference(rules)}
				/>
				<p>
					Historical market price lookups are off by default. The “Use CoinGecko
					fallback” preference alone does not enable network fetching:
					historical lookups must be enabled and a key configured. Cloud AI
					recipe requests require your chosen endpoint/key and acknowledgement.
				</p>
			</Topic>
			<Topic title="Review Queue reference">
				<p>
					Flags describe uncertainty, not an instruction to clear a warning.
					Review actions can include correcting a transaction, importing
					evidence or acknowledging a checked informational item. Some warnings
					belong to a report or asset; fixing source data and recomputing is
					necessary.
				</p>
				<ReferenceTable
					caption="Review codes and recommended fixes"
					headers={["Flag code", "Recommended action"]}
					rows={Object.entries(REVIEW_FIXES)}
				/>
			</Topic>
			<Topic title="Optional providers and local request pacing">
				<p>
					Configure read-only connections and provider keys in{" "}
					<DocLink href="/connections">Connections</DocLink>. These are Tax
					Tracker’s configured request budgets and pacing, not a guarantee of
					upstream free access. The shared client queues requests by host within
					the running process, retries eligible transient failures with backoff
					and respects Retry-After. Multiple installations and other apps using
					the same key still share upstream quotas.
				</p>
				<ReferenceTable
					caption="Provider reference"
					headers={["Provider", "Purpose and local limits"]}
					rows={PROVIDER_REFERENCE}
				/>
				<p>
					EVM networks include Ethereum, Base, Arbitrum, Polygon and BNB Chain
					(BSC). Etherscan free coverage differs by chain; Blockscout, Alchemy
					and NodeReal provide configured alternatives. “Polygon.io” stock
					prices (unadjusted daily bars) and the “Polygon” blockchain are
					different services.
				</p>
			</Topic>
			<Topic title="Local storage, encrypted Vault and backups">
				<p>
					Your self-hosted server stores imports, untouched raw source rows,
					ledger edits, recipes and reports in SQLite at data/tax-tracker.db by
					default (inside Docker: /data/tax-tracker.db). Re-importing a file
					deduplicates on source + sourceRef; user-edited rows are not silently
					overwritten. Overlapping formats still need duplicate review.
				</p>
				<p>
					For Railway self-hosting, connect the repository, mount a persistent
					volume at /data, keep 1 replica for SQLite, and paste the variables
					from .env.railway.example with a strong APP_PASSWORD (see
					docs/deploy-railway.md for healthcheck and HTTPS setup).
				</p>
				<p>
					Tax Tracker can also be installed as a PWA. The Service Worker caches
					only static shell assets and the /offline fallback — /api/* responses
					are never cached in the Service Worker. Smooth tab switching uses an
					in-memory stale-while-revalidate cache that clears automatically on
					edits and logout.
				</p>
				<p>
					When usdtInrRate is set to ledger_usdt_inr, preceding ledger USDT/INR
					trades are capped at a 14-day staleness window and fall back to
					bundled SBI USD TT rates (with a 22-day freshness guard) rather than
					applying stale FX quotes.
				</p>
				<p>
					Exchange and provider secrets are encrypted in the Vault using
					AES-256-GCM with a passphrase-derived scrypt key. This encrypts
					secrets, not the entire ledger database. Unlock the Vault for
					authenticated sync or provider lookups; protect your host and backup
					files as financial records.
				</p>
				<p>
					Use{" "}
					<DocLink href="/settings">
						Settings → Local Data & Backups → Download backup
					</DocLink>{" "}
					for a consistent database snapshot. Keep it on encrypted storage.
					Follow the restore steps on that screen with the app stopped, and
					retain the Vault passphrase in use when the backup was taken.
					Database-changing upgrades also create a local backup.
				</p>
				<p>
					Recipe suggestions can be written manually. If you choose AI, the
					wizard previews the exact header and sample-row payload before sending
					it to your configured endpoint. A remote endpoint receives that
					sample; choose a local endpoint when you want it to remain on your
					machine. No analytics or telemetry is sent.
				</p>
			</Topic>
			<Topic title="CLI quick reference">
				<p>
					The CLI in apps/cli uses the same importers, live rule files and pure
					engines. Build it with{" "}
					<code className="font-mono-code">pnpm --filter @tax/cli build</code>,
					then run:
				</p>
				<pre className="font-mono-code overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-4 text-xs leading-6">
					<code>{`node apps/cli/dist/index.js import export.csv --source binance --tz IST --out ledger.json\nnode apps/cli/dist/index.js compute --ledger ledger.json --year ${rules.taxYear} --regime vda --out report.json --csv vda.csv\nnode apps/cli/dist/index.js compute --ledger stocks.json --year ${rules.taxYear} --regime us-equity --metadata metadata.json --prices prices.json --out stocks-report.json --csv stocks.csv --csv-kind full`}</code>
				</pre>
				<p>
					Generic imports accept --recipe; compute accepts --settings. US equity
					metadata and prices are JSON arrays, with prices keyed by calendarYear
					and symbol. Run the CLI with --help for supported flags. Inspect any
					import errors file and unresolved report rows before relying on
					exported figures.
				</p>
			</Topic>
		</DocSection>
	);
}
