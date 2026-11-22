"use client";

import { isLocalAiEndpoint } from "@tax/core";
import {
	AlertTriangle,
	CheckCircle2,
	Database,
	Download,
	LogOut,
	Save,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { Select, SelectItem } from "@/components/ui/Select";
import { FALLBACK_TAX_YEARS } from "@/components/ui/TaxYearSelect";
import {
	type AppSettings,
	api,
	getErrorMessage,
	type TaxYearInfo,
} from "@/lib/client/api";

const RESTORE_STEPS = [
	{
		text: "Stop the app, so nothing writes to the database:",
		command: "docker compose stop",
	},
	{
		text: "Delete the write-ahead log files. A leftover -wal file belongs to the old database and can roll back or corrupt the restored one:",
		command: "rm -f data/tax-tracker.db-wal data/tax-tracker.db-shm",
	},
	{
		text: "Replace the database with your backup:",
		command: "cp /path/to/backup.db data/tax-tracker.db",
	},
	{
		text: "Linux only: give the file to uid 1000, the user the app runs as:",
		command: "sudo chown 1000:1000 data/tax-tracker.db",
	},
	{ text: "Start the app again:", command: "docker compose start" },
];

export function SettingsClient({
	passwordEnabled,
}: {
	passwordEnabled: boolean;
}) {
	const router = useRouter();
	const [taxYears, setTaxYears] = useState<TaxYearInfo[]>(FALLBACK_TAX_YEARS);
	const [settings, setSettings] = useState<AppSettings | null>(null);
	const [apiKeyDraft, setApiKeyDraft] = useState("");
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [savedMsg, setSavedMsg] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [backingUp, setBackingUp] = useState(false);
	const [backupError, setBackupError] = useState<string | null>(null);

	const defaultYearId = useId();
	const feeId = useId();
	const usEquityFeeId = useId();
	const usEquityFxId = useId();
	const lotMethodId = useId();
	const lotPoolId = useId();
	const usdtRateId = useId();
	const incomeBasisId = useId();
	const headId = useId();
	const surchargeId = useId();
	const specifiedId = useId();
	const windowId = useId();
	const toleranceId = useId();
	const aiUrlId = useId();
	const aiModelId = useId();
	const aiKeyId = useId();
	const cloudAckId = useId();
	const pricesEnabledId = useId();
	const coingeckoFallbackId = useId();
	const marketBasisId = useId();

	async function handleDownloadBackup() {
		setBackingUp(true);
		setBackupError(null);
		try {
			const { blob, fileName } = await api.downloadBackup();
			const url = URL.createObjectURL(blob);
			const link = document.createElement("a");
			link.href = url;
			link.download = fileName;
			link.click();
			URL.revokeObjectURL(url);
		} catch (err) {
			setBackupError(getErrorMessage(err));
		} finally {
			setBackingUp(false);
		}
	}

	const load = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const [s, years] = await Promise.all([
				api.getSettings(),
				api.getTaxYears().catch(() => FALLBACK_TAX_YEARS),
			]);
			setSettings(s);
			if (years.length > 0) setTaxYears(years);
		} catch (err) {
			setError(getErrorMessage(err));
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		load();
	}, [load]);

	async function handleSave(e: React.FormEvent) {
		e.preventDefault();
		if (!settings) return;
		const trimmedBaseUrl = settings.ai.baseUrl.trim();
		const local = isLocalAiEndpoint(trimmedBaseUrl);
		if (!local && !settings.ai.cloudAcknowledged) {
			setSavedMsg(null);
			setError(
				"Please acknowledge the cloud privacy warning before saving a non-local AI endpoint.",
			);
			return;
		}
		setSaving(true);
		setError(null);
		setSavedMsg(null);
		try {
			const updated = await api.putSettings({
				defaultTaxYear: settings.defaultTaxYear,
				marketPriceBasis: settings.marketPriceBasis,
				feeTreatment: settings.feeTreatment,
				usEquityFeeTreatment: settings.usEquityFeeTreatment,
				usEquityFxBasis: settings.usEquityFxBasis,
				lotMethod: settings.lotMethod,
				lotPool: settings.lotPool,
				usdtInrRate: settings.usdtInrRate,
				incomeCostBasis: settings.incomeCostBasis,
				headOfIncome: settings.headOfIncome,
				surchargeRate: settings.surchargeRate,
				specifiedPerson: settings.specifiedPerson,
				transferMatchWindowHours: Number(settings.transferMatchWindowHours),
				transferAmountTolerance: settings.transferAmountTolerance,
				prices: {
					enabled: settings.prices.enabled,
					coingeckoFallback: settings.prices.coingeckoFallback,
				},
				ai: {
					baseUrl: trimmedBaseUrl,
					model: settings.ai.model.trim(),
					cloudAcknowledged: settings.ai.cloudAcknowledged,
					...(apiKeyDraft.trim() !== "" ? { apiKey: apiKeyDraft.trim() } : {}),
				},
			});
			setSettings(updated);
			setApiKeyDraft("");
			setSavedMsg(
				"Settings saved. Recompute any open tax report to apply changes.",
			);
		} catch (err) {
			setError(getErrorMessage(err));
		} finally {
			setSaving(false);
		}
	}

	async function handleLogout() {
		try {
			await api.logout();
			router.push("/login");
		} catch (err) {
			setError(getErrorMessage(err));
		}
	}

	if (loading) {
		return (
			<div className="h-64 animate-pulse rounded-lg border border-[var(--border)] bg-[var(--bg-surface)]" />
		);
	}

	if (!settings) {
		return (
			<div className="space-y-4">
				<h1 className="text-xl font-semibold tracking-tight">Settings</h1>
				{error ? <ErrorBanner message={error} onRetry={load} /> : null}
			</div>
		);
	}

	const isLocal = isLocalAiEndpoint(settings.ai.baseUrl.trim());

	return (
		<div className="space-y-6">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div>
					<h1 className="text-xl font-semibold tracking-tight">Settings</h1>
					<p className="mt-0.5 text-sm text-[var(--text-secondary)]">
						CA-configurable tax assumptions, AI recipe assistant endpoint, and
						backup location.
					</p>
				</div>
				{passwordEnabled ? (
					<button
						type="button"
						onClick={handleLogout}
						className="inline-flex items-center gap-1.5 rounded border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
					>
						<LogOut className="h-3.5 w-3.5" aria-hidden="true" />
						Log out
					</button>
				) : null}
			</div>

			{error ? <ErrorBanner message={error} /> : null}
			{savedMsg ? (
				<div
					aria-live="polite"
					className="flex items-center gap-2 rounded-lg border border-[var(--positive)]/40 bg-[var(--positive-soft)] px-4 py-2.5 text-sm text-[var(--positive)]"
				>
					<CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
					<span>{savedMsg}</span>
				</div>
			) : null}

			<form onSubmit={handleSave} className="space-y-6">
				{/* General / Engine Settings */}
				<section className="space-y-4 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-5">
					<h2 className="text-base font-semibold tracking-tight">
						Tax Engine Assumptions
					</h2>

					<div className="grid grid-cols-1 gap-5 md:grid-cols-2">
						<div>
							<label
								htmlFor={defaultYearId}
								className="block text-sm font-medium"
							>
								Default tax year
							</label>
							<Select
								id={defaultYearId}
								value={settings.defaultTaxYear}
								onValueChange={(value) =>
									setSettings({ ...settings, defaultTaxYear: value })
								}
								className="mt-1 w-full"
							>
								{taxYears.map((ty) => (
									<SelectItem key={ty.id} value={ty.id}>
										{ty.id} ({ty.act})
									</SelectItem>
								))}
							</Select>
							<p className="mt-1 text-xs text-[var(--text-muted)]">
								Which financial year (1 April – 31 March IST) opens by default.
							</p>
						</div>

						<div>
							<label htmlFor={headId} className="block text-sm font-medium">
								Head of income
							</label>
							<Select
								id={headId}
								value={settings.headOfIncome}
								onValueChange={(value) =>
									setSettings({
										...settings,
										headOfIncome: value as AppSettings["headOfIncome"],
									})
								}
								className="mt-1 w-full"
							>
								<SelectItem value="capital_gains">Capital Gains</SelectItem>
								<SelectItem value="business">Business Income</SelectItem>
							</Select>
							<p className="mt-1 text-xs text-[var(--text-muted)]">
								Schedule VDA classification printed on every disposal row (ask
								your CA which applies to your trading frequency).
							</p>
						</div>

						<div>
							<label htmlFor={feeId} className="block text-sm font-medium">
								Fee &amp; GST treatment
							</label>
							<Select
								id={feeId}
								value={settings.feeTreatment}
								onValueChange={(value) =>
									setSettings({
										...settings,
										feeTreatment: value as AppSettings["feeTreatment"],
									})
								}
								className="mt-1 w-full"
							>
								<SelectItem value="exclude">
									Exclude fees (strict statutory default)
								</SelectItem>
								<SelectItem value="include">
									Include fees (add to buy cost / reduce sell consideration)
								</SelectItem>
							</Select>
							<p className="mt-1 text-xs text-[var(--text-muted)]">
								Statutory VDA rules allow only cost of acquisition; some CAs
								treat brokerage as part of cost or reduction of full value.
							</p>
						</div>

						<div>
							<label htmlFor={lotPoolId} className="block text-sm font-medium">
								Lot pool scope
							</label>
							<Select
								id={lotPoolId}
								value={settings.lotPool}
								onValueChange={(value) =>
									setSettings({
										...settings,
										lotPool: value as AppSettings["lotPool"],
									})
								}
								className="mt-1 w-full"
							>
								<SelectItem value="global">
									Global FIFO across all wallets
								</SelectItem>
								<SelectItem value="per_source">
									Per-source FIFO (separate per exchange)
								</SelectItem>
							</Select>
							<p className="mt-1 text-xs text-[var(--text-muted)]">
								Determines whether FIFO lot queues are matched per exchange or
								pooled across your entire portfolio.
							</p>
						</div>

						<div>
							<label
								htmlFor={lotMethodId}
								className="block text-sm font-medium"
							>
								Lot matching method
							</label>
							<Select
								id={lotMethodId}
								value={settings.lotMethod}
								disabled
								className="mt-1 w-full"
							>
								<SelectItem value="FIFO">FIFO (First-In, First-Out)</SelectItem>
							</Select>
							<p className="mt-1 text-xs text-[var(--text-muted)]">
								Standard Indian accounting method for fungible digital assets.
							</p>
						</div>

						<div>
							<label htmlFor={usdtRateId} className="block text-sm font-medium">
								USDT / USD-stablecoin INR rate
							</label>
							<Select
								id={usdtRateId}
								value={settings.usdtInrRate}
								onValueChange={(value) =>
									setSettings({
										...settings,
										usdtInrRate: value as AppSettings["usdtInrRate"],
									})
								}
								className="mt-1 w-full"
							>
								<SelectItem value="ledger_usdt_inr">
									Latest ledger USDT/INR trade (fallback to SBI TT)
								</SelectItem>
								<SelectItem value="sbi_usd_tt">
									Always SBI TT buying USD/INR rate
								</SelectItem>
							</Select>
							<p className="mt-1 text-xs text-[var(--text-muted)]">
								How crypto trades quoted in USDT are converted to INR when no
								direct INR price is recorded.
							</p>
						</div>

						<div>
							<label
								htmlFor={incomeBasisId}
								className="block text-sm font-medium"
							>
								Income receipt cost basis
							</label>
							<Select
								id={incomeBasisId}
								value={settings.incomeCostBasis}
								onValueChange={(value) =>
									setSettings({
										...settings,
										incomeCostBasis: value as AppSettings["incomeCostBasis"],
									})
								}
								className="mt-1 w-full"
							>
								<SelectItem value="zero">₹0 (conservative default)</SelectItem>
								<SelectItem value="fmv_at_receipt">
									Fair market value (FMV) at receipt
								</SelectItem>
							</Select>
							<p className="mt-1 text-xs text-[var(--text-muted)]">
								Cost assigned to staking, mining, or airdrop coins when they are
								later sold (if already taxed as income at receipt).
							</p>
						</div>

						<div>
							<label
								htmlFor={surchargeId}
								className="block text-sm font-medium"
							>
								Surcharge rate
							</label>
							<Select
								id={surchargeId}
								value={settings.surchargeRate}
								onValueChange={(value) =>
									setSettings({
										...settings,
										surchargeRate: value as AppSettings["surchargeRate"],
									})
								}
								className="mt-1 w-full"
							>
								<SelectItem value="0">0% (income up to ₹50 lakh)</SelectItem>
								<SelectItem value="0.10">
									10% (above ₹50 lakh – ₹1 crore)
								</SelectItem>
								<SelectItem value="0.15">
									15% (above ₹1 crore – ₹2 crore)
								</SelectItem>
								<SelectItem value="0.25">
									25% (above ₹2 crore – ₹5 crore)
								</SelectItem>
								<SelectItem value="0.37">37% (above ₹5 crore)</SelectItem>
							</Select>
							<p className="mt-1 text-xs text-[var(--text-muted)]">
								Applied on top of the 30% base VDA tax before calculating 4%
								Health &amp; Education Cess.
							</p>
						</div>

						<div>
							<label htmlFor={windowId} className="block text-sm font-medium">
								Transfer match window (hours)
							</label>
							<input
								id={windowId}
								type="number"
								min={0}
								step={1}
								value={settings.transferMatchWindowHours}
								onChange={(e) =>
									setSettings({
										...settings,
										transferMatchWindowHours: Number(e.target.value) || 0,
									})
								}
								className="num mt-1 w-full rounded border border-[var(--border)] bg-[var(--bg-canvas)] px-3 py-1.5 text-sm"
							/>
							<p className="mt-1 text-xs text-[var(--text-muted)]">
								Maximum time between a withdrawal on one exchange and deposit on
								another to pair them as a self-transfer.
							</p>
						</div>

						<div>
							<label
								htmlFor={toleranceId}
								className="block text-sm font-medium"
							>
								Transfer amount tolerance (fraction)
							</label>
							<input
								id={toleranceId}
								type="text"
								inputMode="decimal"
								value={settings.transferAmountTolerance}
								onChange={(e) =>
									setSettings({
										...settings,
										transferAmountTolerance: e.target.value,
									})
								}
								className="num mt-1 w-full rounded border border-[var(--border)] bg-[var(--bg-canvas)] px-3 py-1.5 text-sm"
							/>
							<p className="mt-1 text-xs text-[var(--text-muted)]">
								Allowed withdrawal-to-deposit quantity shrinkage (e.g. 0.01 =
								1%) to absorb network gas fees during self-transfers.
							</p>
						</div>

						<div className="md:col-span-2">
							<label
								htmlFor={specifiedId}
								className="flex items-start gap-2.5 text-sm font-medium"
							>
								<input
									id={specifiedId}
									type="checkbox"
									checked={settings.specifiedPerson}
									onChange={(e) =>
										setSettings({
											...settings,
											specifiedPerson: e.target.checked,
										})
									}
									className="mt-1"
								/>
								<span>
									Specified person for VDA TDS threshold
									<span className="mt-0.5 block text-xs font-normal text-[var(--text-muted)]">
										Raises the yearly aggregate VDA TDS exemption threshold from
										₹10,000 to ₹50,000 (applicable to individuals/HUFs meeting
										statutory criteria).
									</span>
								</span>
							</label>
						</div>
					</div>
				</section>

				{/* US Stocks */}
				<section className="space-y-4 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-5">
					<div>
						<h2 className="text-base font-semibold tracking-tight">
							US Stocks
						</h2>
						<p className="text-xs text-[var(--text-secondary)]">
							Assumptions for US equity capital gains, dividends, Form 67, and
							Schedule FA (isolated from VDA crypto calculations).
						</p>
					</div>

					<div className="grid grid-cols-1 gap-5 md:grid-cols-2">
						<div>
							<label
								htmlFor={usEquityFeeId}
								className="block text-sm font-medium"
							>
								Brokerage &amp; commission treatment
							</label>
							<Select
								id={usEquityFeeId}
								value={settings.usEquityFeeTreatment}
								onValueChange={(value) =>
									setSettings({
										...settings,
										usEquityFeeTreatment:
											value as AppSettings["usEquityFeeTreatment"],
									})
								}
								className="mt-1 w-full"
							>
								<SelectItem value="include">
									Include fees (add to buy cost / deduct from sell proceeds)
								</SelectItem>
								<SelectItem value="exclude">
									Exclude fees (ignore brokerage &amp; commission)
								</SelectItem>
							</Select>
							<p className="mt-1 text-xs text-[var(--text-muted)]">
								Unlike VDA crypto, Indian capital gains rules generally allow
								deducting transfer expenses and brokerage.
							</p>
						</div>

						<div>
							<label
								htmlFor={usEquityFxId}
								className="block text-sm font-medium"
							>
								USD to INR exchange rate basis
							</label>
							<Select
								id={usEquityFxId}
								value={settings.usEquityFxBasis}
								onValueChange={(value) =>
									setSettings({
										...settings,
										usEquityFxBasis: value as AppSettings["usEquityFxBasis"],
									})
								}
								className="mt-1 w-full"
							>
								<SelectItem value="prev_month_end">
									Previous month-end SBI TT buying rate (Rule 115 / Rule 206)
								</SelectItem>
								<SelectItem value="trade_date">
									Trade-date SBI TT buying rate
								</SelectItem>
							</Select>
							<p className="mt-1 text-xs text-[var(--text-muted)]">
								Rule 115 (1961 Act) / Rule 206 (2025 Act) converts foreign
								capital gains and dividends at the last day of the preceding
								month.
							</p>
						</div>
					</div>
				</section>

				{/* Price Lookups */}
				<section className="space-y-4 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-5">
					<div className="flex flex-wrap items-center justify-between gap-2">
						<div>
							<h2 className="text-base font-semibold tracking-tight">
								Price lookups
							</h2>
							<p className="text-xs text-[var(--text-secondary)]">
								Optional historical daily prices for crypto (Binance/CoinGecko)
								when valuing swaps, gas fees, or on-chain transfers, and for US
								stock Schedule FA peak and Dec 31 closing prices
								(Polygon.io/Finnhub).
							</p>
						</div>
						<Badge tone={settings.prices.enabled ? "accent" : "neutral"}>
							{settings.prices.enabled ? "Enabled" : "Off by default"}
						</Badge>
					</div>

					<div className="grid grid-cols-1 gap-5 md:grid-cols-2">
						<div className="md:col-span-2">
							<label
								htmlFor={pricesEnabledId}
								className="flex items-start gap-2.5 text-sm font-medium"
							>
								<input
									id={pricesEnabledId}
									type="checkbox"
									checked={settings.prices.enabled}
									onChange={(e) =>
										setSettings({
											...settings,
											prices: {
												...settings.prices,
												enabled: e.target.checked,
											},
										})
									}
									className="mt-1"
								/>
								<span>
									Enable historical market price lookups
									<span className="mt-0.5 block text-xs font-normal text-[var(--text-muted)]">
										Used only when you click &ldquo;Fetch missing prices&rdquo;
										on a crypto report, &ldquo;Auto-fill&rdquo; on US Stocks
										Schedule FA, or after an API sync finishes, so historical
										valuations can be cached locally.
									</span>
								</span>
							</label>
						</div>

						<div>
							<label
								htmlFor={coingeckoFallbackId}
								className="flex items-start gap-2.5 text-sm font-medium"
							>
								<input
									id={coingeckoFallbackId}
									type="checkbox"
									checked={settings.prices.coingeckoFallback}
									onChange={(e) =>
										setSettings({
											...settings,
											prices: {
												...settings.prices,
												coingeckoFallback: e.target.checked,
											},
										})
									}
									className="mt-1"
								/>
								<span>
									Use CoinGecko fallback
									<span className="mt-0.5 block text-xs font-normal text-[var(--text-muted)]">
										Looks up assets or dates not found in Binance daily klines
										(requires a free CoinGecko API key in Connections).
									</span>
								</span>
							</label>
						</div>

						<div>
							<label
								htmlFor={marketBasisId}
								className="block text-sm font-medium"
							>
								Market price basis
							</label>
							<Select
								id={marketBasisId}
								value={settings.marketPriceBasis}
								onValueChange={(value) =>
									setSettings({
										...settings,
										marketPriceBasis: value as AppSettings["marketPriceBasis"],
									})
								}
								className="mt-1 w-full"
							>
								<SelectItem value="close">IST-day close</SelectItem>
								<SelectItem value="vwap">IST-day VWAP</SelectItem>
							</Select>
							<p className="mt-1 text-xs text-[var(--text-muted)]">
								Which daily rate from the local price cache is used when valuing
								unpriced swaps, fees, or receipts.
							</p>
						</div>
					</div>

					<div className="space-y-1 rounded-md border border-[var(--border)] bg-[var(--bg-subtle)] p-3 text-xs text-[var(--text-secondary)]">
						<p>
							<strong className="text-[var(--text-primary)]">
								Hosts contacted when enabled:
							</strong>{" "}
							Crypto:{" "}
							<code className="font-mono-code">data-api.binance.vision</code>{" "}
							(daily prices, no key) and{" "}
							<code className="font-mono-code">api.coingecko.com</code> (only if
							the fallback is on and a key is set). US Stocks Schedule FA:{" "}
							<code className="font-mono-code">api.polygon.io</code> and{" "}
							<code className="font-mono-code">finnhub.io</code> (only when you
							click Auto-fill on Schedule FA and a key is set).
						</p>
						<p>
							Computing a report never goes online — it reads only from your
							local transaction ledger and locally cached prices.
						</p>
					</div>
				</section>

				{/* AI Recipe Assistant Settings */}
				<section className="space-y-4 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-5">
					<div className="flex flex-wrap items-center justify-between gap-2">
						<div>
							<h2 className="text-base font-semibold tracking-tight">
								AI Recipe Assistant (Optional)
							</h2>
							<p className="text-xs text-[var(--text-secondary)]">
								Used only when you click &ldquo;Send &amp; suggest recipe&rdquo;
								for unknown CSV formats. Never called automatically.
							</p>
						</div>
						<Badge tone={isLocal ? "positive" : "warning"}>
							{isLocal ? "Local endpoint" : "Cloud endpoint"}
						</Badge>
					</div>

					<div className="grid grid-cols-1 gap-4 md:grid-cols-3">
						<div>
							<label htmlFor={aiUrlId} className="block text-sm font-medium">
								OpenAI-compatible base URL
							</label>
							<input
								id={aiUrlId}
								type="url"
								value={settings.ai.baseUrl}
								onChange={(e) =>
									setSettings({
										...settings,
										ai: { ...settings.ai, baseUrl: e.target.value },
									})
								}
								placeholder="http://ollama:11434/v1"
								className="font-mono-code mt-1 w-full rounded border border-[var(--border)] bg-[var(--bg-canvas)] px-3 py-1.5 text-sm"
							/>
						</div>

						<div>
							<label htmlFor={aiModelId} className="block text-sm font-medium">
								Model name
							</label>
							<input
								id={aiModelId}
								type="text"
								value={settings.ai.model}
								onChange={(e) =>
									setSettings({
										...settings,
										ai: { ...settings.ai, model: e.target.value },
									})
								}
								placeholder="qwen2.5:7b"
								className="font-mono-code mt-1 w-full rounded border border-[var(--border)] bg-[var(--bg-canvas)] px-3 py-1.5 text-sm"
							/>
						</div>

						<div>
							<div className="flex items-center justify-between">
								<label htmlFor={aiKeyId} className="block text-sm font-medium">
									API key (optional)
								</label>
								{settings.ai.apiKeySet ? (
									<Badge tone="positive">Key saved</Badge>
								) : null}
							</div>
							<input
								id={aiKeyId}
								type="password"
								autoComplete="new-password"
								value={apiKeyDraft}
								onChange={(e) => setApiKeyDraft(e.target.value)}
								placeholder={
									settings.ai.apiKeySet
										? "Leave blank to keep existing key"
										: "Not required for local Ollama"
								}
								className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--bg-canvas)] px-3 py-1.5 text-sm"
							/>
						</div>
					</div>

					{!isLocal ? (
						<div className="space-y-2 rounded-md border border-[var(--warning)]/40 bg-[var(--warning-soft)] p-3 text-xs">
							<p className="flex items-center gap-1.5 font-semibold text-[var(--warning)]">
								<AlertTriangle
									className="h-4 w-4 shrink-0"
									aria-hidden="true"
								/>
								Cloud endpoint warning
							</p>
							<p className="text-[var(--text-primary)]">
								This URL is outside your local machine/network. When you request
								an AI recipe suggestion, the CSV headers and first 20 sample
								rows will be sent to{" "}
								<code className="font-mono-code">{settings.ai.baseUrl}</code>.
							</p>
							<label
								htmlFor={cloudAckId}
								className="flex items-center gap-2 pt-1 font-medium text-[var(--text-primary)]"
							>
								<input
									id={cloudAckId}
									type="checkbox"
									checked={settings.ai.cloudAcknowledged}
									onChange={(e) =>
										setSettings({
											...settings,
											ai: {
												...settings.ai,
												cloudAcknowledged: e.target.checked,
											},
										})
									}
								/>
								<span>
									I understand that 20 sample CSV rows will be sent to this
									external AI provider when I click Suggest Recipe.
								</span>
							</label>
						</div>
					) : null}
				</section>

				<div className="flex justify-end">
					<button
						type="submit"
						disabled={saving}
						className="inline-flex items-center gap-2 rounded-md bg-[var(--accent)] px-5 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
					>
						<Save className="h-4 w-4" aria-hidden="true" />
						{saving ? "Saving…" : "Save settings"}
					</button>
				</div>
			</form>

			{/* Data Folder & Backup Note */}
			<section className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-5">
				<div className="flex items-start gap-3">
					<Database
						className="mt-0.5 h-5 w-5 shrink-0 text-[var(--accent)]"
						aria-hidden="true"
					/>
					<div className="space-y-1 text-sm">
						<h2 className="font-semibold">Local Data &amp; Backups</h2>
						<p className="text-xs leading-relaxed text-[var(--text-secondary)]">
							All imports, raw source rows, edited transactions, saved recipes,
							and computed reports are stored locally in a single SQLite file,{" "}
							<code className="font-mono-code rounded bg-[var(--bg-subtle)] px-1.5 py-0.5">
								tax-tracker.db
							</code>
							, in the data folder you mounted (
							<code className="font-mono-code">./data</code> by default). Inside
							Docker that is{" "}
							<code className="font-mono-code">/data/tax-tracker.db</code>.
						</p>
					</div>
				</div>

				<div className="mt-4 space-y-3 border-t border-[var(--border)] pt-4 text-xs text-[var(--text-secondary)]">
					<h3 className="text-sm font-semibold text-[var(--text-primary)]">
						Backup
					</h3>
					<p>
						<strong>How to back up:</strong> download a consistent snapshot of
						the whole database and keep it on an encrypted drive. It contains
						your transactions.
					</p>
					<button
						type="button"
						disabled={backingUp}
						onClick={handleDownloadBackup}
						className="inline-flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--bg-surface)] px-4 py-2 text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-50"
					>
						<Download className="h-4 w-4" aria-hidden="true" />
						{backingUp ? "Preparing backup…" : "Download backup"}
					</button>
					{backupError ? (
						<p role="alert" className="text-[var(--loss)]">
							{backupError}
						</p>
					) : null}
					<div>
						<p className="font-medium text-[var(--text-primary)]">
							To restore a backup
						</p>
						<p className="mt-1">
							There is no restore button, on purpose. Run these from the
							repository folder, in this order:
						</p>
						<ol className="mt-1.5 list-decimal space-y-2 pl-5">
							{RESTORE_STEPS.map((step) => (
								<li key={step.command}>
									{step.text}
									<pre className="font-mono-code mt-1 overflow-x-auto rounded border border-[var(--border)] bg-[var(--bg-subtle)] p-2 text-[11px] text-[var(--text-primary)]">
										{step.command}
									</pre>
								</li>
							))}
						</ol>
						<p className="mt-1.5">
							If you set <code className="font-mono-code">DATA_HOST_DIR</code>,
							use that folder instead of{" "}
							<code className="font-mono-code">data/</code>. Your vault
							passphrase is the one that was in use when the backup was taken.
							Stored reports come back with the backup; recompute them if you
							changed settings since.
						</p>
					</div>
					<p>
						A backup is also made automatically before upgrades that change the
						database, in <code className="font-mono-code">data/backups/</code>.
					</p>
				</div>
			</section>
		</div>
	);
}
