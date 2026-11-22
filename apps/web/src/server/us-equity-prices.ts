import { setTimeout as delay } from "node:timers/promises";
import { D, type EquityCyPrice } from "@tax/core";
import type {
	EquityPriceFillSummarySchema,
	EquityPricesStatus,
	FillEquityPricesRequestSchema,
} from "@tax/core/api";
import type { TaxDatabase } from "@tax/db";
import {
	deriveScheduleFaPrices,
	finnhubDailyBars,
	planEquityPriceFill,
	polygonDailyBars,
} from "@tax/prices";
import { loadRules } from "@tax/rules";
import {
	HttpClient,
	UpstreamAuthError,
	UpstreamError,
	UpstreamRateLimitError,
} from "@tax/sync/http";
import type { z } from "zod";
import { startBackgroundJob } from "./background";
import { baseUrls } from "./connectors";
import { ApiError } from "./errors";
import { checkYear } from "./reports";
import { getSettings } from "./settings";
import { providers, vaultSession } from "./vault";

const barSources = { polygon: polygonDailyBars, finnhub: finnhubDailyBars };
type Provider = keyof typeof barSources;
type FillRequest = z.output<typeof FillEquityPricesRequestSchema>;
type FillSummary = z.output<typeof EquityPriceFillSummarySchema>;

function plan(db: TaxDatabase, taxYear: string) {
	const rules = loadRules("india-us-equity", taxYear);
	return planEquityPriceFill({
		transactions: db.transactions.active("us_equity"),
		rules,
		settings: getSettings(db),
		existingPrices: db.equityCyPrices.list(rules.scheduleFaCalendarYear),
	});
}

export async function equityPricesStatus(
	db: TaxDatabase,
	taxYear: string,
): Promise<EquityPricesStatus> {
	checkYear(taxYear);
	const vault = await vaultSession(db);
	const { calendarYear, holdings } = plan(db, taxYear);
	const { polygon, finnhub } = providers(db);
	const missing = holdings
		.filter(({ needsPeak, needsClosing }) => needsPeak || needsClosing)
		.map(({ symbol, needsPeak, needsClosing }) => ({
			symbol,
			needsPeak,
			needsClosing,
		}));
	return {
		enabled: getSettings(db).prices.enabled,
		calendarYear,
		vaultUnlocked: vault.status().unlocked,
		needed: holdings.length,
		filled: holdings.length - missing.length,
		missing,
		sources: { polygon, finnhub },
	};
}

function failureReason(error: unknown) {
	if (error instanceof UpstreamAuthError) return "Credentials or plan rejected";
	if (error instanceof UpstreamRateLimitError) return "Rate limit reached";
	if (error instanceof UpstreamError && error.status === 404)
		return "No data for this symbol";
	return "Historical price request failed";
}

function savePrices(db: TaxDatabase, price: EquityCyPrice, overwrite: boolean) {
	return db.atomic(() => {
		const {
			calendarYear,
			symbol,
			peakPriceUsd,
			peakDate,
			closingPriceUsd,
			source,
		} = price;
		const rows = db.equityCyPrices.list(calendarYear);
		const existing = rows.find((row) => row.symbol === symbol);
		const addPeak =
			peakPriceUsd && peakDate && (overwrite || !existing?.peakPriceUsd);
		const addClosing =
			closingPriceUsd && (overwrite || !existing?.closingPriceUsd);
		if (!addPeak && !addClosing) return false;
		const keepsPrice =
			(existing?.peakPriceUsd && !addPeak) ||
			(existing?.closingPriceUsd && !addClosing);
		const previousSource = existing?.source || "manual";
		const merged: EquityCyPrice = {
			...existing,
			calendarYear,
			symbol,
			...(addPeak ? { peakPriceUsd, peakDate } : {}),
			...(addClosing ? { closingPriceUsd } : {}),
			source:
				keepsPrice && source
					? [...new Set([...previousSource.split(" + "), source])].join(" + ")
					: source,
		};
		db.equityCyPrices.replace(calendarYear, [
			...rows.filter((row) => row.symbol !== symbol),
			merged,
		]);
		return true;
	}, "immediate");
}

export async function startEquityPriceFill(db: TaxDatabase, body: FillRequest) {
	const { taxYear, provider, overwrite } = body;
	checkYear(taxYear);
	const vault = await vaultSession(db);
	const checkReady = () => {
		if (!getSettings(db).prices.enabled)
			throw new ApiError(
				409,
				"prices_disabled",
				"Enable price lookups in Settings first.",
			);
		if (!vault.status().unlocked)
			throw new ApiError(
				423,
				"vault_locked",
				"Unlock the vault to use stock price providers.",
			);
	};
	checkReady();
	const needed: Provider[] =
		provider === "auto" ? ["polygon", "finnhub"] : [provider];
	const available = needed.filter((name) => vault.has(`provider:${name}`));
	if (!available.length)
		throw new ApiError(
			409,
			"provider_key_required",
			"Configure an API key for a stock price provider.",
			{ needs: needed },
		);

	return startBackgroundJob(
		db,
		"equity_price_fill",
		body,
		async (ctx): Promise<FillSummary> => {
			const { calendarYear, holdings } = plan(db, taxYear);
			const targets = holdings.filter(
				({ needsPeak, needsClosing }) => overwrite || needsPeak || needsClosing,
			);
			const urls = baseUrls();
			const polygonHost = URL.parse(urls.polygon ?? "")?.hostname;
			const localPolygon =
				polygonHost === "localhost" ||
				polygonHost === "127.0.0.1" ||
				polygonHost === "[::1]";
			const used = new Set<Provider>();
			const failed: FillSummary["failed"] = [];
			let stream = "equity-prices";
			let streamsDone = 0;
			let rowsFetched = 0;
			let filled = 0;
			let skipped = holdings.length - targets.length;
			const progress = (waitingUntil?: number) =>
				ctx.progress({
					stream,
					streamsDone,
					streamsTotal: targets.length,
					rowsFetched,
					waitingUntil,
				});
			const ensureReady = () => {
				ctx.signal.throwIfAborted();
				checkReady();
			};
			const sleep = async (ms: number, signal?: AbortSignal) => {
				progress(Date.now() + ms);
				try {
					await delay(ms, undefined, { signal });
					ensureReady();
				} finally {
					progress();
				}
			};
			const clients = {
				polygon: new HttpClient({
					minIntervalMs: localPolygon ? 0 : 12_500,
					sleep,
				}),
				finnhub: new HttpClient({ minIntervalMs: 1_100, sleep }),
			};
			progress();
			for (const holding of targets) {
				const { symbol, events, closingQty } = holding;
				const needsPeak = overwrite || holding.needsPeak;
				const needsClosing = overwrite
					? D(closingQty).gt("0")
					: holding.needsClosing;
				const reasons: string[] = [];
				stream = `equity-prices:${symbol}`;
				progress();
				for (const source of available) {
					ensureReady();
					const apiKey = vault.get(`provider:${source}`);
					if (!apiKey) {
						reasons.push(`${source}: API key was removed`);
						continue;
					}
					let bars: Awaited<ReturnType<typeof polygonDailyBars>>;
					try {
						bars = await barSources[source]({
							request: (url, init) =>
								clients[source].request(url, {
									...init,
									signal: ctx.signal,
									redirect: "error",
								}),
							baseUrl: urls[source],
							apiKey,
							symbol,
							from: `${calendarYear}-01-01`,
							to: `${calendarYear}-12-31`,
						});
					} catch (error) {
						ensureReady();
						reasons.push(`${source}: ${failureReason(error)}`);
						continue;
					}
					ensureReady();
					const price = deriveScheduleFaPrices({
						symbol,
						calendarYear,
						bars,
						events,
						closingQty,
						source,
					});
					const hasPeak = Boolean(price.peakPriceUsd && price.peakDate);
					const hasClosing = Boolean(price.closingPriceUsd);
					if (!(needsPeak && hasPeak) && !(needsClosing && hasClosing)) {
						reasons.push(
							`${source}: No market prices for the required holding dates`,
						);
						continue;
					}
					if (savePrices(db, price, overwrite)) {
						rowsFetched++;
						used.add(source);
						if (needsPeak && !hasPeak)
							failed.push({
								symbol,
								reason: `${source}: No market prices for the peak holding dates`,
							});
						else if (needsClosing && !hasClosing)
							failed.push({
								symbol,
								reason: `${source}: No year-end closing price`,
							});
						else filled++;
					} else skipped++;
					break;
				}
				if (reasons.length === available.length)
					failed.push({ symbol, reason: reasons.join(". ") });
				streamsDone++;
				progress();
			}
			return {
				calendarYear,
				requested: holdings.length,
				filled,
				skipped,
				providerUsed:
					used.size === 2 ? "mixed" : (used.values().next().value ?? null),
				failed,
			};
		},
	);
}
