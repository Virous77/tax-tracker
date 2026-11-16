"use client";

import {
	type ImportSheetSchema,
	isLocalAiEndpoint,
	type Recipe,
} from "@tax/core";
import {
	AlertTriangle,
	CheckCircle2,
	Eye,
	Play,
	Save,
	Sparkles,
	XCircle,
} from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import type { z } from "zod";
import { Badge } from "@/components/ui/Badge";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import {
	api,
	getErrorMessage,
	type ImportSummary,
	type PreviewPayloadData,
	type PreviewRecipeData,
} from "@/lib/client/api";
import {
	formatInrNullable,
	formatIstDateTime,
	formatQty,
	formatTxType,
} from "@/lib/client/format";

type ImportSheet = z.infer<typeof ImportSheetSchema>;
type SideTarget = "buy" | "sell" | "deposit" | "withdrawal" | "income";

const SIDE_TARGETS: SideTarget[] = [
	"buy",
	"sell",
	"deposit",
	"withdrawal",
	"income",
];

const DATE_FORMAT_PRESETS = [
	"yyyy-MM-dd HH:mm:ss",
	"yyyy-MM-dd'T'HH:mm:ss",
	"dd/MM/yyyy HH:mm:ss",
	"dd-MM-yyyy HH:mm",
	"MM/dd/yyyy HH:mm:ss",
	"yyyy-MM-dd",
];

function normaliseHeader(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.replace(/[\s*]+/g, "");
}

// Pure-JS SHA-256 so fingerprint matches @tax/importers even over plain HTTP LAN where crypto.subtle is unavailable.
function sha256Hex(message: string): string {
	const bytes = new TextEncoder().encode(message);
	const k = [
		0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
		0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
		0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
		0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
		0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
		0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
		0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
		0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
		0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
		0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
		0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
	];
	const h = [
		0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
		0x1f83d9ab, 0x5be0cd19,
	];
	const bitLen = bytes.length * 8;
	const paddedLen = Math.ceil((bytes.length + 9) / 64) * 64;
	const padded = new Uint8Array(paddedLen);
	padded.set(bytes);
	padded[bytes.length] = 0x80;
	const view = new DataView(padded.buffer);
	view.setUint32(paddedLen - 8, Math.floor(bitLen / 0x100000000), false);
	view.setUint32(paddedLen - 4, bitLen >>> 0, false);

	const w = new Uint32Array(64);
	const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
	for (let offset = 0; offset < paddedLen; offset += 64) {
		for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4, false);
		for (let i = 16; i < 64; i++) {
			const w15 = w[i - 15] ?? 0;
			const w2 = w[i - 2] ?? 0;
			const w16 = w[i - 16] ?? 0;
			const w7 = w[i - 7] ?? 0;
			const s0 = rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3);
			const s1 = rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10);
			w[i] = (w16 + s0 + w7 + s1) >>> 0;
		}
		let a = h[0] ?? 0;
		let b = h[1] ?? 0;
		let c = h[2] ?? 0;
		let d = h[3] ?? 0;
		let e = h[4] ?? 0;
		let f = h[5] ?? 0;
		let g = h[6] ?? 0;
		let hh = h[7] ?? 0;
		for (let i = 0; i < 64; i++) {
			const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
			const ch = (e & f) ^ (~e & g);
			const temp1 = (hh + S1 + ch + (k[i] ?? 0) + (w[i] ?? 0)) >>> 0;
			const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
			const maj = (a & b) ^ (a & c) ^ (b & c);
			const temp2 = (S0 + maj) >>> 0;
			hh = g;
			g = f;
			f = e;
			e = (d + temp1) >>> 0;
			d = c;
			c = b;
			b = a;
			a = (temp1 + temp2) >>> 0;
		}
		h[0] = ((h[0] ?? 0) + a) >>> 0;
		h[1] = ((h[1] ?? 0) + b) >>> 0;
		h[2] = ((h[2] ?? 0) + c) >>> 0;
		h[3] = ((h[3] ?? 0) + d) >>> 0;
		h[4] = ((h[4] ?? 0) + e) >>> 0;
		h[5] = ((h[5] ?? 0) + f) >>> 0;
		h[6] = ((h[6] ?? 0) + g) >>> 0;
		h[7] = ((h[7] ?? 0) + hh) >>> 0;
	}
	return h.map((v) => v.toString(16).padStart(8, "0")).join("");
}

function computeFingerprint(headers: string[], sheet = "CSV"): string {
	return sha256Hex(
		JSON.stringify({
			headers: headers.map(normaliseHeader),
			sheet: normaliseHeader(sheet || "CSV"),
		}),
	);
}

function tokenizeHeader(value: string): string[] {
	return value
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter(Boolean);
}

function hasTokenPhrase(tokens: string[], phrase: string[]): boolean {
	if (phrase.length === 0 || phrase.length > tokens.length) return false;
	for (let i = 0; i <= tokens.length - phrase.length; i++) {
		if (phrase.every((word, j) => tokens[i + j] === word)) return true;
	}
	return false;
}

function guessColumn(
	headers: string[],
	candidates: string[],
	excludeWords: string[] = [],
): string {
	const excludeSet = new Set(excludeWords.flatMap(tokenizeHeader));
	const tokenized = headers
		.map((raw) => ({ raw, tokens: tokenizeHeader(raw) }))
		.filter((h) => !h.tokens.some((t) => excludeSet.has(t)));
	const candidatePhrases = candidates
		.map(tokenizeHeader)
		.filter((p) => p.length > 0);

	for (const phrase of candidatePhrases) {
		const exact = tokenized.find(
			(h) =>
				h.tokens.length === phrase.length &&
				phrase.every((word, i) => h.tokens[i] === word),
		);
		if (exact) return exact.raw;
	}
	for (const phrase of candidatePhrases) {
		const match = tokenized.find((h) => hasTokenPhrase(h.tokens, phrase));
		if (match) return match.raw;
	}
	return "";
}

function buildInitialRecipe(
	sheet: ImportSheet,
	timezone: "IST" | "UTC",
): Recipe {
	const h = sheet.headers;
	const timestamp =
		guessColumn(h, [
			"timestamp",
			"date",
			"time",
			"created at",
			"utc time",
			"datetime",
			"txn date",
		]) ||
		h[0] ||
		"timestamp";
	const amount =
		guessColumn(
			h,
			["amount", "quantity", "qty", "volume", "size", "executed"],
			["fee", "charge", "charges", "commission", "tds", "inr", "price", "rate"],
		) ||
		h[1] ||
		h[0] ||
		"amount";
	const side = guessColumn(
		h,
		["side", "action", "direction"],
		["type", "price", "fee"],
	);
	const type = guessColumn(
		h,
		["type", "operation", "transaction type", "tx type"],
		["side", "fee", "price"],
	);
	const pair = guessColumn(
		h,
		["pair", "market", "symbol", "instrument"],
		["fee", "price"],
	);
	const baseAsset = pair
		? ""
		: guessColumn(
				h,
				["base", "base asset", "coin", "asset", "currency"],
				["fee", "charge", "charges", "commission", "quote"],
			);
	const quoteAsset = pair
		? ""
		: guessColumn(
				h,
				["quote", "quote asset"],
				["fee", "charge", "charges", "commission", "base"],
			);
	const price = guessColumn(
		h,
		["price", "rate", "unit price"],
		["fee", "tds", "total"],
	);
	const total = guessColumn(
		h,
		["total", "net amount", "value", "inr", "gross"],
		["fee", "tds", "id", "hash", "rate"],
	);
	const feeAmount = guessColumn(
		h,
		["fee", "fee amount", "commission", "charges"],
		["currency", "asset", "coin", "rate", "id"],
	);
	const feeAsset = guessColumn(h, [
		"fee asset",
		"fee coin",
		"fee currency",
		"charges coin",
		"charge coin",
	]);
	const tds = guessColumn(h, ["tds", "tds inr", "tds amount"]);
	const id = guessColumn(
		h,
		[
			"id",
			"order id",
			"trade id",
			"txid",
			"tx id",
			"transaction id",
			"reference",
			"ref",
			"order ref",
		],
		[
			"user",
			"account",
			"client",
			"customer",
			"member",
			"side",
			"type",
			"price",
			"rate",
			"fee",
			"asset",
			"coin",
			"amount",
			"qty",
			"quantity",
			"total",
			"value",
			"hash",
		],
	);
	const txHash = guessColumn(
		h,
		["txhash", "tx hash", "hash", "transaction hash"],
		["id"],
	);

	return {
		id: `custom-${Date.now().toString(36)}`,
		name: sheet.name ? `${sheet.name} CSV` : "Custom CSV",
		version: 1,
		fingerprint: computeFingerprint(h, sheet.name || "CSV"),
		...(sheet.name ? { sheet: sheet.name } : {}),
		columns: {
			timestamp,
			amount,
			...(type ? { type } : {}),
			...(side ? { side } : {}),
			...(pair ? { pair } : {}),
			...(baseAsset ? { baseAsset } : {}),
			...(quoteAsset ? { quoteAsset } : {}),
			...(price ? { price } : {}),
			...(total ? { total } : {}),
			...(feeAmount ? { feeAmount } : {}),
			...(feeAsset ? { feeAsset } : {}),
			...(tds ? { tds } : {}),
			...(id ? { id } : {}),
			...(txHash ? { txHash } : {}),
		},
		dateFormat: "yyyy-MM-dd HH:mm:ss",
		timezone,
		signStyle: side || type ? "side_column" : "negative_is_sell",
		pairSplit: { knownQuotes: ["INR", "USDT", "USDC", "BTC", "ETH"] },
	};
}

export function RecipeWizard({
	importItem,
	onConfirmed,
	onCancel,
}: {
	importItem: ImportSummary;
	onConfirmed: (summary: ImportSummary) => void;
	onCancel: () => void;
}) {
	const sheets = importItem.sheets ?? [];
	const [selectedSheetName, setSelectedSheetName] = useState<string>(
		sheets[0]?.name ?? "",
	);
	const currentSheet: ImportSheet = useMemo(() => {
		return (
			sheets.find((s) => s.name === selectedSheetName) ??
			sheets[0] ?? { name: "Sheet1", headers: [], sampleRows: [] }
		);
	}, [sheets, selectedSheetName]);

	const [recipe, setRecipe] = useState<Recipe>(() =>
		buildInitialRecipe(currentSheet, importItem.timezone),
	);
	const [knownQuotesText, setKnownQuotesText] = useState(
		"INR, USDT, USDC, BTC, ETH",
	);
	const [sideMapEntries, setSideMapEntries] = useState<
		Array<{ id: string; raw: string; target: SideTarget }>
	>([]);

	const [payloadPreview, setPayloadPreview] =
		useState<PreviewPayloadData | null>(null);
	const [loadingPayload, setLoadingPayload] = useState(false);
	const [suggesting, setSuggesting] = useState(false);
	const [previewing, setPreviewing] = useState(false);
	const [previewData, setPreviewData] = useState<PreviewRecipeData | null>(
		null,
	);
	const [confirming, setConfirming] = useState(false);
	const [saveRecipe, setSaveRecipe] = useState(true);
	const [recipeName, setRecipeName] = useState(recipe.name);
	const [error, setError] = useState<string | null>(null);

	const sheetSelectId = useId();
	const nameInputId = useId();
	const dateFormatId = useId();
	const signStyleId = useId();
	const quotesInputId = useId();
	const saveCheckId = useId();
	const saveNameId = useId();

	useEffect(() => {
		const next = buildInitialRecipe(currentSheet, importItem.timezone);
		setRecipe(next);
		setRecipeName(next.name);
		setPayloadPreview(null);
		setPreviewData(null);
		setSideMapEntries([]);
	}, [currentSheet, importItem.timezone]);

	function buildCurrentRecipe(): Recipe {
		const quotes = knownQuotesText
			.split(",")
			.map((s) => s.trim().toUpperCase())
			.filter(Boolean);
		const sideMapRecord: Record<string, SideTarget> = {};
		for (const entry of sideMapEntries) {
			const k = entry.raw.trim();
			if (k) sideMapRecord[k] = entry.target;
		}
		return {
			...recipe,
			name: recipeName.trim() || recipe.name || "Custom CSV",
			...(Object.keys(sideMapRecord).length > 0
				? { sideMap: sideMapRecord }
				: {}),
			...(quotes.length > 0 ? { pairSplit: { knownQuotes: quotes } } : {}),
		};
	}

	function applySuggestedRecipe(suggested: Recipe) {
		setRecipe(suggested);
		setRecipeName(suggested.name);
		if (suggested.pairSplit?.knownQuotes) {
			setKnownQuotesText(suggested.pairSplit.knownQuotes.join(", "));
		}
		if (suggested.sideMap) {
			setSideMapEntries(
				Object.entries(suggested.sideMap).map(([raw, target]) => ({
					id: `${raw}:${target}`,
					raw,
					target,
				})),
			);
		}
	}

	async function handlePreviewPayload() {
		setLoadingPayload(true);
		setError(null);
		try {
			const data = await api.previewPayload({
				importId: importItem.id,
				...(currentSheet.name ? { sheet: currentSheet.name } : {}),
			});
			setPayloadPreview(data);
		} catch (err) {
			setError(getErrorMessage(err));
		} finally {
			setLoadingPayload(false);
		}
	}

	async function handleSuggestRecipe() {
		setSuggesting(true);
		setError(null);
		try {
			const res = await api.suggestRecipe({
				importId: importItem.id,
				...(currentSheet.name ? { sheet: currentSheet.name } : {}),
			});
			applySuggestedRecipe(res.recipe);
			setPayloadPreview((prev) =>
				prev
					? { ...prev, sentPayload: res.sentPayload }
					: {
							sentPayload: res.sentPayload,
							endpoint: "Configured AI endpoint",
							model: res.sentPayload.model,
							isLocal: true,
						},
			);
		} catch (err) {
			setError(getErrorMessage(err));
		} finally {
			setSuggesting(false);
		}
	}

	async function handlePreviewRows() {
		setPreviewing(true);
		setError(null);
		try {
			const built = buildCurrentRecipe();
			const res = await api.previewRecipe({
				importId: importItem.id,
				...(currentSheet.name ? { sheet: currentSheet.name } : {}),
				recipe: built,
			});
			setPreviewData(res);
		} catch (err) {
			setError(getErrorMessage(err));
		} finally {
			setPreviewing(false);
		}
	}

	async function handleConfirm() {
		setConfirming(true);
		setError(null);
		try {
			const built = buildCurrentRecipe();
			const summary = await api.confirmImport(importItem.id, {
				recipe: built,
				saveRecipe,
				...(saveRecipe && recipeName.trim()
					? { recipeName: recipeName.trim() }
					: {}),
			});
			onConfirmed(summary);
		} catch (err) {
			setError(getErrorMessage(err));
		} finally {
			setConfirming(false);
		}
	}

	function detectSideValues() {
		const col = recipe.columns.side || recipe.columns.type;
		if (!col) return;
		const seen = new Set<string>();
		for (const row of currentSheet.sampleRows) {
			const val = row[col];
			if (val !== undefined && val !== null && String(val).trim() !== "") {
				seen.add(String(val).trim());
			}
		}
		const mapped: Array<{ id: string; raw: string; target: SideTarget }> = [];
		for (const raw of seen) {
			const low = raw.toLowerCase();
			let target: SideTarget = "buy";
			if (low.includes("sell") || low.includes("ask")) target = "sell";
			else if (low.includes("dep")) target = "deposit";
			else if (low.includes("with")) target = "withdrawal";
			else if (
				low.includes("stak") ||
				low.includes("airdrop") ||
				low.includes("reward") ||
				low.includes("interest") ||
				low.includes("income")
			)
				target = "income";
			mapped.push({ id: `det-${raw}`, raw, target });
		}
		setSideMapEntries(mapped);
		setRecipe((prev) => ({ ...prev, signStyle: "side_column" }));
	}

	function updateColumn(key: keyof Recipe["columns"], value: string) {
		setRecipe((prev) => {
			const cols = { ...prev.columns };
			if (key === "timestamp" || key === "amount") {
				cols[key] = value;
			} else if (value) {
				cols[key] = value;
			} else {
				delete cols[key];
			}
			const nextSignStyle =
				(key === "side" || key === "type") && value
					? "side_column"
					: prev.signStyle;
			return { ...prev, columns: cols, signStyle: nextSignStyle };
		});
	}

	const columnDefs: Array<{
		key: keyof Recipe["columns"];
		label: string;
		required?: boolean;
		hint?: string;
	}> = [
		{ key: "timestamp", label: "Timestamp", required: true },
		{ key: "amount", label: "Amount / Quantity", required: true },
		{ key: "side", label: "Side column", hint: "e.g. BUY / SELL" },
		{ key: "type", label: "Type column", hint: "e.g. Trade / Deposit" },
		{ key: "pair", label: "Trading Pair", hint: "e.g. BTCINR" },
		{ key: "baseAsset", label: "Base Asset", hint: "if no pair column" },
		{ key: "quoteAsset", label: "Quote Asset", hint: "if no pair column" },
		{ key: "price", label: "Unit Price" },
		{ key: "total", label: "Total / Consideration" },
		{ key: "feeAmount", label: "Fee Amount" },
		{ key: "feeAsset", label: "Fee Asset" },
		{ key: "tds", label: "TDS (INR)" },
		{ key: "id", label: "Trade / Order ID" },
		{ key: "txHash", label: "Tx Hash" },
	];

	return (
		<div className="space-y-6">
			<div className="flex flex-wrap items-start justify-between gap-4 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-4">
				<div>
					<div className="flex items-center gap-2">
						<h2 className="text-base font-semibold">
							Map Generic CSV / Sheet: {importItem.fileName}
						</h2>
						<Badge tone="accent">Step-by-step recipe wizard</Badge>
					</div>
					<p className="mt-1 text-sm text-[var(--text-secondary)]">
						No saved recipe matched these headers. Preview an optional AI
						suggestion or map the columns by hand below.
					</p>
				</div>
				<button
					type="button"
					onClick={onCancel}
					className="rounded border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
				>
					Start over
				</button>
			</div>

			{error ? <ErrorBanner message={error} /> : null}

			{sheets.length > 1 ? (
				<div className="flex items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-4">
					<label
						htmlFor={sheetSelectId}
						className="text-sm font-medium text-[var(--text-primary)]"
					>
						Select sheet
					</label>
					<select
						id={sheetSelectId}
						value={currentSheet.name}
						onChange={(e) => setSelectedSheetName(e.target.value)}
						className="rounded border border-[var(--border)] bg-[var(--bg-canvas)] px-3 py-1.5 text-sm"
					>
						{sheets.map((s) => (
							<option key={s.name} value={s.name}>
								{s.name} ({s.headers.length} columns)
							</option>
						))}
					</select>
				</div>
			) : null}

			{/* Step 1: Headers & Sample Rows */}
			<section className="space-y-3 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-4">
				<h3 className="text-sm font-semibold">
					1. Detected headers ({currentSheet.headers.length})
				</h3>
				<div className="flex flex-wrap gap-1.5">
					{currentSheet.headers.map((h) => (
						<span
							key={h}
							className="font-mono-code rounded border border-[var(--border)] bg-[var(--bg-subtle)] px-2 py-0.5 text-xs"
						>
							{h}
						</span>
					))}
				</div>

				{currentSheet.sampleRows.length > 0 ? (
					<div className="overflow-x-auto rounded border border-[var(--border)]">
						<table className="w-full border-collapse text-left text-xs">
							<thead className="bg-[var(--bg-subtle)] text-[var(--text-secondary)]">
								<tr>
									{currentSheet.headers.map((h) => (
										<th
											key={h}
											className="border-b border-[var(--border)] px-2.5 py-1.5 font-medium whitespace-nowrap"
										>
											{h}
										</th>
									))}
								</tr>
							</thead>
							<tbody>
								{currentSheet.sampleRows.slice(0, 5).map((row) => (
									<tr
										key={JSON.stringify(row)}
										className="border-b border-[var(--border)] last:border-b-0"
									>
										{currentSheet.headers.map((h) => (
											<td
												key={h}
												className="font-mono-code max-w-44 truncate px-2.5 py-1.5 whitespace-nowrap text-[var(--text-secondary)]"
												title={String(row[h] ?? "")}
											>
												{row[h] === undefined || row[h] === null
													? ""
													: String(row[h])}
											</td>
										))}
									</tr>
								))}
							</tbody>
						</table>
					</div>
				) : null}
			</section>

			{/* Step 2: Optional AI Payload Preview & Suggestion */}
			<section className="space-y-3 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-4">
				<div className="flex flex-wrap items-center justify-between gap-3">
					<div>
						<h3 className="text-sm font-semibold">
							2. Optional AI mapping suggestion (privacy-first)
						</h3>
						<p className="text-xs text-[var(--text-secondary)]">
							Inspect the exact payload before sending. Only headers and up to
							20 sample rows are ever sent. Works completely without AI if you
							prefer filling Step 3 manually.
						</p>
					</div>
					<div className="flex flex-wrap items-center gap-2">
						<button
							type="button"
							disabled={loadingPayload}
							onClick={handlePreviewPayload}
							className="inline-flex items-center gap-1.5 rounded border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs font-medium hover:bg-[var(--bg-hover)] disabled:opacity-50"
						>
							<Eye className="h-3.5 w-3.5" aria-hidden="true" />
							{loadingPayload ? "Preparing…" : "Preview AI payload"}
						</button>
						<button
							type="button"
							disabled={suggesting}
							onClick={handleSuggestRecipe}
							className="inline-flex items-center gap-1.5 rounded bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
						>
							<Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
							{suggesting ? "Suggesting…" : "Send & suggest recipe"}
						</button>
					</div>
				</div>

				{payloadPreview ? (
					<div className="space-y-2 rounded-md border border-[var(--border)] bg-[var(--bg-subtle)] p-3">
						<div className="flex flex-wrap items-center justify-between gap-2 text-xs">
							<p className="font-medium text-[var(--text-primary)]">
								This is exactly what will be sent to{" "}
								<code className="font-mono-code font-semibold">
									{payloadPreview.model || "(unconfigured model)"}
								</code>{" "}
								at{" "}
								<code className="font-mono-code font-semibold">
									{payloadPreview.endpoint}
								</code>
							</p>
							{(() => {
								const previewIsLocal =
									payloadPreview.endpoint &&
									URL.canParse(payloadPreview.endpoint)
										? isLocalAiEndpoint(payloadPreview.endpoint)
										: payloadPreview.isLocal;
								return (
									<Badge tone={previewIsLocal ? "positive" : "warning"}>
										{previewIsLocal
											? "Local endpoint"
											: "Cloud endpoint — leaves machine"}
									</Badge>
								);
							})()}
						</div>
						<pre className="font-mono-code max-h-60 overflow-auto rounded border border-[var(--border)] bg-[var(--bg-surface)] p-2.5 text-[11px] leading-relaxed text-[var(--text-secondary)]">
							{JSON.stringify(payloadPreview.sentPayload, null, 2)}
						</pre>
					</div>
				) : null}
			</section>

			{/* Step 3: Editable Recipe Form */}
			<section className="space-y-4 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-4">
				<h3 className="text-sm font-semibold">
					3. Recipe mapping (editable by hand or from AI)
				</h3>

				<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
					<div>
						<label
							htmlFor={nameInputId}
							className="block text-xs font-medium text-[var(--text-secondary)]"
						>
							Recipe name
						</label>
						<input
							id={nameInputId}
							type="text"
							value={recipeName}
							onChange={(e) => setRecipeName(e.target.value)}
							className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--bg-canvas)] px-2.5 py-1.5 text-sm"
						/>
					</div>

					<div>
						<label
							htmlFor={signStyleId}
							className="block text-xs font-medium text-[var(--text-secondary)]"
						>
							Buy / Sell sign style
						</label>
						<select
							id={signStyleId}
							value={recipe.signStyle}
							onChange={(e) =>
								setRecipe((prev) => ({
									...prev,
									signStyle: e.target.value as Recipe["signStyle"],
								}))
							}
							className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--bg-canvas)] px-2.5 py-1.5 text-sm"
						>
							<option value="side_column">Separate side / type column</option>
							<option value="negative_is_sell">Negative amount is sell</option>
						</select>
					</div>

					<div>
						<label
							htmlFor={dateFormatId}
							className="block text-xs font-medium text-[var(--text-secondary)]"
						>
							Date format
						</label>
						<input
							id={dateFormatId}
							type="text"
							value={recipe.dateFormat}
							onChange={(e) =>
								setRecipe((prev) => ({ ...prev, dateFormat: e.target.value }))
							}
							list="date-format-presets"
							className="font-mono-code mt-1 w-full rounded border border-[var(--border)] bg-[var(--bg-canvas)] px-2.5 py-1.5 text-sm"
						/>
						<datalist id="date-format-presets">
							{DATE_FORMAT_PRESETS.map((fmt) => (
								<option key={fmt} value={fmt} />
							))}
						</datalist>
					</div>

					<div>
						<label
							htmlFor={quotesInputId}
							className="block text-xs font-medium text-[var(--text-secondary)]"
						>
							Known quote assets (for pair split)
						</label>
						<input
							id={quotesInputId}
							type="text"
							value={knownQuotesText}
							onChange={(e) => setKnownQuotesText(e.target.value)}
							placeholder="INR, USDT, BTC"
							className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--bg-canvas)] px-2.5 py-1.5 text-sm"
						/>
					</div>
				</div>

				<div>
					<h4 className="mb-2 text-xs font-semibold tracking-wide text-[var(--text-secondary)] uppercase">
						Column Mappings
					</h4>
					<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
						{columnDefs.map((col) => {
							const selectId = `col-${col.key}`;
							const val = recipe.columns[col.key] ?? "";
							return (
								<div key={col.key}>
									<label
										htmlFor={selectId}
										className="flex items-center justify-between text-xs font-medium text-[var(--text-secondary)]"
									>
										<span>
											{col.label}
											{col.required ? (
												<span className="text-[var(--loss)]"> *</span>
											) : null}
										</span>
										{col.hint ? (
											<span className="text-[10px] text-[var(--text-muted)]">
												{col.hint}
											</span>
										) : null}
									</label>
									<select
										id={selectId}
										value={val}
										onChange={(e) => updateColumn(col.key, e.target.value)}
										className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--bg-canvas)] px-2 py-1.5 text-xs"
									>
										{!col.required ? <option value="">(None)</option> : null}
										{currentSheet.headers.map((h) => (
											<option key={h} value={h}>
												{h}
											</option>
										))}
									</select>
								</div>
							);
						})}
					</div>
				</div>

				{/* Side map */}
				<div className="space-y-2 border-t border-[var(--border)] pt-3">
					<div className="flex flex-wrap items-center justify-between gap-2">
						<div>
							<h4 className="text-xs font-semibold tracking-wide text-[var(--text-secondary)] uppercase">
								Side / Type Value Mapping
							</h4>
							<p className="text-xs text-[var(--text-muted)]">
								Map raw values from your Side or Type column (e.g.
								&ldquo;BUY&rdquo;, &ldquo;Staking Reward&rdquo;) to standard
								ledger actions.
							</p>
						</div>
						<div className="flex gap-2">
							<button
								type="button"
								onClick={detectSideValues}
								className="rounded border border-[var(--border)] px-2.5 py-1 text-xs font-medium hover:bg-[var(--bg-hover)]"
							>
								Auto-detect from sample
							</button>
							<button
								type="button"
								onClick={() =>
									setSideMapEntries((prev) => [
										...prev,
										{ id: crypto.randomUUID(), raw: "", target: "buy" },
									])
								}
								className="rounded border border-[var(--border)] px-2.5 py-1 text-xs font-medium hover:bg-[var(--bg-hover)]"
							>
								+ Add mapping
							</button>
						</div>
					</div>

					{sideMapEntries.length > 0 ? (
						<div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
							{sideMapEntries.map((entry) => (
								<div
									key={entry.id}
									className="flex items-center gap-1.5 rounded border border-[var(--border)] bg-[var(--bg-canvas)] p-1.5"
								>
									<input
										type="text"
										aria-label="Raw side value"
										placeholder="Raw value"
										value={entry.raw}
										onChange={(e) => {
											const val = e.target.value;
											setSideMapEntries((prev) =>
												prev.map((item) =>
													item.id === entry.id ? { ...item, raw: val } : item,
												),
											);
										}}
										className="min-w-0 flex-1 rounded border border-[var(--border)] bg-[var(--bg-surface)] px-2 py-1 text-xs"
									/>
									<span className="text-xs text-[var(--text-muted)]">→</span>
									<select
										aria-label="Mapped transaction type"
										value={entry.target}
										onChange={(e) => {
											const target = e.target.value as SideTarget;
											setSideMapEntries((prev) =>
												prev.map((item) =>
													item.id === entry.id ? { ...item, target } : item,
												),
											);
										}}
										className="rounded border border-[var(--border)] bg-[var(--bg-surface)] px-2 py-1 text-xs"
									>
										{SIDE_TARGETS.map((t) => (
											<option key={t} value={t}>
												{formatTxType(t)}
											</option>
										))}
									</select>
									<button
										type="button"
										aria-label="Remove mapping"
										onClick={() =>
											setSideMapEntries((prev) =>
												prev.filter((item) => item.id !== entry.id),
											)
										}
										className="px-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--loss)]"
									>
										×
									</button>
								</div>
							))}
						</div>
					) : null}
				</div>

				<div className="flex flex-wrap items-center justify-end gap-2 border-t border-[var(--border)] pt-3">
					<button
						type="button"
						disabled={previewing}
						onClick={handlePreviewRows}
						className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border-strong)] bg-[var(--bg-surface)] px-4 py-2 text-sm font-medium hover:bg-[var(--bg-hover)] disabled:opacity-50"
					>
						<Play className="h-4 w-4" aria-hidden="true" />
						{previewing ? "Testing recipe…" : "Preview 10 rows"}
					</button>
				</div>
			</section>

			{/* Step 4: 10-Row Preview & Checks */}
			{previewData ? (
				<section className="space-y-4 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-4">
					<div className="flex flex-wrap items-center justify-between gap-2">
						<h3 className="text-sm font-semibold">
							4. Preview: Original vs Converted (first {previewData.rows.length}{" "}
							rows)
						</h3>
						<div className="flex flex-wrap gap-2">
							<Badge tone={previewData.checks.datesOk ? "positive" : "loss"}>
								{previewData.checks.datesOk ? (
									<CheckCircle2 className="h-3 w-3" aria-hidden="true" />
								) : (
									<XCircle className="h-3 w-3" aria-hidden="true" />
								)}
								Dates {previewData.checks.datesOk ? "OK" : "failed"}
							</Badge>
							<Badge tone={previewData.checks.numbersOk ? "positive" : "loss"}>
								{previewData.checks.numbersOk ? (
									<CheckCircle2 className="h-3 w-3" aria-hidden="true" />
								) : (
									<XCircle className="h-3 w-3" aria-hidden="true" />
								)}
								Numbers {previewData.checks.numbersOk ? "OK" : "failed"}
							</Badge>
							<Badge
								tone={
									previewData.checks.rowCountIn ===
									previewData.checks.rowCountOut
										? "positive"
										: "warning"
								}
							>
								<span className="num">
									{previewData.checks.rowCountIn} in /{" "}
									{previewData.checks.rowCountOut} out
								</span>
							</Badge>
						</div>
					</div>

					{previewData.checks.negativeBalances.length > 0 ? (
						<div className="rounded border border-[var(--warning)]/40 bg-[var(--warning-soft)] px-3 py-2 text-xs">
							<p className="flex items-center gap-1.5 font-semibold text-[var(--warning)]">
								<AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
								Negative balance warning in preview (check sign style or missing
								prior deposits):
							</p>
							<ul className="mt-1 list-disc pl-5 text-[var(--text-primary)]">
								{previewData.checks.negativeBalances.map((nb) => (
									<li
										key={`${nb.asset}:${nb.source ?? ""}:${nb.amount}`}
										className="num"
									>
										{nb.asset}
										{nb.source ? ` (${nb.source})` : ""}: {nb.amount}
									</li>
								))}
							</ul>
						</div>
					) : null}

					<div className="overflow-x-auto rounded border border-[var(--border)]">
						<table className="w-full border-collapse text-left text-xs">
							<thead className="bg-[var(--bg-subtle)] text-[var(--text-secondary)]">
								<tr>
									<th className="border-b border-[var(--border)] px-3 py-2 font-medium">
										#
									</th>
									<th className="border-b border-[var(--border)] px-3 py-2 font-medium">
										Original Row
									</th>
									<th className="border-b border-[var(--border)] px-3 py-2 font-medium">
										Converted Ledger Row
									</th>
								</tr>
							</thead>
							<tbody>
								{previewData.rows.map((row, idx) => (
									<tr
										key={row.converted?.id ?? JSON.stringify(row.original)}
										className="border-b border-[var(--border)] align-top last:border-b-0"
									>
										<td className="num px-3 py-2 text-[var(--text-muted)]">
											{idx + 1}
										</td>
										<td className="max-w-xs px-3 py-2">
											<pre className="font-mono-code overflow-x-auto text-[11px] whitespace-pre-wrap text-[var(--text-secondary)]">
												{JSON.stringify(row.original, null, 2)}
											</pre>
										</td>
										<td className="px-3 py-2">
											{row.error || !row.converted ? (
												<p className="font-medium text-[var(--loss)]">
													{row.error ?? "Could not convert row"}
												</p>
											) : (
												<div className="space-y-1">
													<div className="flex flex-wrap items-center gap-1.5">
														<Badge tone="accent">
															{formatTxType(row.converted.type)}
														</Badge>
														<span className="text-[var(--text-secondary)]">
															{formatIstDateTime(row.converted.timestamp)}
														</span>
													</div>
													<div className="num flex flex-wrap gap-x-4 gap-y-1 text-[var(--text-primary)]">
														{row.converted.assetIn ? (
															<span>
																In:{" "}
																<strong>
																	{formatQty(row.converted.amountIn)}{" "}
																	{row.converted.assetIn}
																</strong>
															</span>
														) : null}
														{row.converted.assetOut ? (
															<span>
																Out:{" "}
																<strong>
																	{formatQty(row.converted.amountOut)}{" "}
																	{row.converted.assetOut}
																</strong>
															</span>
														) : null}
														{row.converted.inrValue ? (
															<span>
																INR:{" "}
																<strong>
																	{formatInrNullable(row.converted.inrValue)}
																</strong>
															</span>
														) : null}
														{row.converted.tdsInr ? (
															<span>
																TDS: {formatInrNullable(row.converted.tdsInr)}
															</span>
														) : null}
													</div>
													{row.converted.reviewFlags.length > 0 ? (
														<div className="flex flex-wrap gap-1 pt-0.5">
															{row.converted.reviewFlags.map((f) => (
																<Badge
																	key={`${f.code}:${f.message}`}
																	tone="warning"
																>
																	{f.code}
																</Badge>
															))}
														</div>
													) : null}
												</div>
											)}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</section>
			) : null}

			{/* Step 5: Confirm & Optional Save */}
			<section className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-4">
				<div className="flex flex-wrap items-center gap-4">
					<label
						htmlFor={saveCheckId}
						className="flex items-center gap-2 text-sm font-medium"
					>
						<input
							id={saveCheckId}
							type="checkbox"
							checked={saveRecipe}
							onChange={(e) => setSaveRecipe(e.target.checked)}
							className="h-4 w-4 rounded border-[var(--border-strong)]"
						/>
						<span>Save recipe for future imports</span>
					</label>
					{saveRecipe ? (
						<div className="flex items-center gap-2">
							<label
								htmlFor={saveNameId}
								className="text-xs text-[var(--text-secondary)]"
							>
								Save as
							</label>
							<input
								id={saveNameId}
								type="text"
								value={recipeName}
								onChange={(e) => setRecipeName(e.target.value)}
								className="rounded border border-[var(--border)] bg-[var(--bg-canvas)] px-2.5 py-1 text-sm"
							/>
						</div>
					) : null}
				</div>

				<button
					type="button"
					disabled={confirming}
					onClick={handleConfirm}
					className="inline-flex items-center gap-2 rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
				>
					<Save className="h-4 w-4" aria-hidden="true" />
					{confirming ? "Importing…" : "Confirm & import"}
				</button>
			</section>
		</div>
	);
}
