"use client";

import {
	type IncomeKind,
	IncomeKindSchema,
	type LedgerTx,
	type TxType,
} from "@tax/core";
import { Plus } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { Drawer } from "@/components/ui/Drawer";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { Select, SelectItem } from "@/components/ui/Select";
import {
	api,
	getErrorMessage,
	type ManualVenue,
	ValidationError,
} from "@/lib/client/api";
import {
	describeDisposal,
	missingExportHints,
	saleSourceLabel,
} from "@/lib/client/disposals";
import {
	formatIncomeKind,
	formatIstDateTime,
	formatQty,
} from "@/lib/client/format";
import { useSourceLabel } from "@/lib/client/useSourceLabel";

const DEFAULT_DATE_TIME = "2026-04-01T12:00";

export type ManualPreset = "buy" | "gift" | "income" | "sell";

/** The sale a missing purchase is being added for. */
export interface SaleContext {
	tx: LedgerTx;
	asset: string;
	/** Quantity of `asset` the sale has no purchase record for. */
	quantity: string;
	taxYear: string;
}

function SaleContextBox({ sale }: { sale: SaleContext }) {
	const sourceLabel = useSourceLabel();
	const hints = missingExportHints([sale.tx.source]);
	return (
		<div className="space-y-1.5 rounded-md border border-[var(--accent)]/40 bg-[var(--accent-soft)] px-3 py-2.5 text-xs">
			<p>
				<span className="font-semibold">For:</span>{" "}
				{describeDisposal(sale.tx, sale.asset)} on{" "}
				{formatIstDateTime(sale.tx.timestamp)} (
				{saleSourceLabel(sale.tx, sourceLabel)}).
			</p>
			<p>
				No record shows how you got this{" "}
				<span className="num font-medium">
					{formatQty(sale.quantity)} {sale.asset}
				</span>
				. Enter when and how you acquired it.
			</p>
			<p className="text-[var(--text-secondary)]">
				Prefer importing the export that contains it
				{hints.length > 0
					? ` (${hints
							.map(
								(hint) =>
									`${hint.venue}: ${hint.exports.map((e) => e.name).join(", ")}`,
							)
							.join("; ")})`
					: ""}
				: it fills in this and similar sales on its own.{" "}
				<Link
					href={`/report?taxYear=${encodeURIComponent(sale.taxYear)}#unresolved`}
					className="font-medium text-[var(--accent-text)] hover:underline"
				>
					Where to download each export
				</Link>
			</p>
		</div>
	);
}

export function AddManualTxDrawer({
	open,
	initialPreset = "buy",
	initialAsset = "",
	initialVenue = "manual",
	initialDateTime,
	initialAmount = "",
	saleContext,
	notAfter,
	onClose,
	onCreated,
}: {
	open: boolean;
	initialPreset?: ManualPreset;
	initialAsset?: string;
	initialVenue?: ManualVenue;
	/** IST `YYYY-MM-DDTHH:mm`; defaults to the start of 2026-27. */
	initialDateTime?: string;
	initialAmount?: string;
	saleContext?: SaleContext;
	/** ISO instant of the sale this entry precedes; the date must be before it. */
	notAfter?: string;
	onClose: () => void;
	onCreated: (tx: LedgerTx) => void;
}) {
	const [type, setType] = useState<TxType>(initialPreset);
	const [venue, setVenue] = useState<ManualVenue>(initialVenue);
	const [istDateTime, setIstDateTime] = useState(
		initialDateTime ?? DEFAULT_DATE_TIME,
	);
	const [assetIn, setAssetIn] = useState(initialAsset);
	const [amountIn, setAmountIn] = useState("");
	const [assetOut, setAssetOut] = useState("");
	const [amountOut, setAmountOut] = useState("");
	const [inrValue, setInrValue] = useState("");
	const [incomeKind, setIncomeKind] = useState<IncomeKind>("staking");
	const [tdsInr, setTdsInr] = useState("");
	const [userNote, setUserNote] = useState("");
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

	const venueId = useId();
	const venueHintId = useId();
	const dtId = useId();
	const assetInId = useId();
	const amountInId = useId();
	const assetOutId = useId();
	const amountOutId = useId();
	const inrId = useId();
	const kindId = useId();
	const tdsId = useId();
	const noteId = useId();
	const dtHintId = useId();
	const amountInHintId = useId();
	const inrHintId = useId();

	function clearFieldError(field: string) {
		setFieldErrors((prev) => {
			if (!prev[field]) return prev;
			const next = { ...prev };
			delete next[field];
			return next;
		});
	}

	useEffect(() => {
		if (!open) return;
		setType(initialPreset);
		setVenue(initialVenue);
		if (initialPreset === "sell") {
			setAssetOut(initialAsset.toUpperCase());
			setAssetIn("");
		} else {
			setAssetIn(initialAsset.toUpperCase());
			setAssetOut("");
		}
		setIstDateTime(initialDateTime ?? DEFAULT_DATE_TIME);
		setAmountIn(initialPreset === "sell" ? "" : initialAmount);
		setAmountOut("");
		setInrValue("");
		setTdsInr("");
		setUserNote("");
		setError(null);
		setFieldErrors({});
	}, [
		open,
		initialPreset,
		initialAsset,
		initialVenue,
		initialDateTime,
		initialAmount,
	]);

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		setSaving(true);
		setError(null);
		setFieldErrors({});
		try {
			const parsedInstant = new Date(`${istDateTime}:00+05:30`);
			if (!Number.isFinite(parsedInstant.getTime())) {
				const msg = "Please enter a valid date and time in IST.";
				setFieldErrors({ timestamp: msg });
				setError(msg);
				return;
			}
			if (
				notAfter &&
				type !== "sell" &&
				parsedInstant.getTime() >= Date.parse(notAfter)
			) {
				const msg = `Must be before the sale on ${formatIstDateTime(notAfter)}.`;
				setFieldErrors({ timestamp: msg });
				setError(msg);
				return;
			}
			const iso = parsedInstant.toISOString();
			const normAssetIn = assetIn.trim().toUpperCase();
			const trimmedAmountIn = amountIn.trim();
			const normAssetOut = assetOut.trim().toUpperCase();
			const trimmedAmountOut = amountOut.trim();
			const trimmedInr = inrValue.trim();

			const payload = {
				sourceRef: `manual-${crypto.randomUUID()}`,
				importId: null,
				timestamp: iso,
				type,
				venue,
				...(type === "income" ? { incomeKind } : {}),
				...(normAssetIn ? { assetIn: normAssetIn } : {}),
				...(trimmedAmountIn ? { amountIn: trimmedAmountIn } : {}),
				...(normAssetOut ? { assetOut: normAssetOut } : {}),
				...(trimmedAmountOut ? { amountOut: trimmedAmountOut } : {}),
				...(trimmedInr !== ""
					? {
							inrValue: trimmedInr,
							inrRateSource:
								type === "gift" || type === "income"
									? ("fmv_receipt" as const)
									: ("manual" as const),
						}
					: {}),
				...(tdsInr.trim() !== "" ? { tdsInr: tdsInr.trim() } : {}),
				raw: {
					manualEntry: true,
					istDateTime,
					type,
					venue,
					assetIn: normAssetIn || undefined,
					amountIn: trimmedAmountIn || undefined,
					assetOut: normAssetOut || undefined,
					amountOut: trimmedAmountOut || undefined,
					inrValue: trimmedInr || undefined,
					note: userNote.trim() || undefined,
				},
				reviewFlags: [],
				...(userNote.trim() ? { userNote: userNote.trim() } : {}),
			};

			const created = await api.createTransaction(payload);
			onCreated(created);
		} catch (err) {
			if (err instanceof ValidationError) {
				setFieldErrors(err.fieldErrors);
				setError(err.message);
			} else {
				setError(getErrorMessage(err));
			}
		} finally {
			setSaving(false);
		}
	}

	const needsIn = ["buy", "income", "gift", "deposit", "swap"].includes(type);
	const needsOut =
		["sell", "withdrawal", "swap"].includes(type) || type === "buy";

	function inputBorderClass(field: string): string {
		return fieldErrors[field]
			? "border-[var(--loss)]"
			: "border-[var(--border)]";
	}

	return (
		<Drawer
			open={open}
			onClose={onClose}
			title="Add manual transaction"
			subtitle="Record a missing buy, gift (with optional cost/FMV), or staking/airdrop income."
		>
			<form onSubmit={handleSubmit} className="space-y-4">
				{saleContext && type === "buy" ? (
					<SaleContextBox sale={saleContext} />
				) : null}

				{error ? <ErrorBanner message={error} /> : null}

				<div className="space-y-1.5">
					<span className="block text-xs font-medium text-[var(--text-secondary)]">
						Entry type
					</span>
					<div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
						{(
							[
								{ id: "buy", label: "Missing Buy" },
								{ id: "gift", label: "Gift" },
								{ id: "income", label: "Income" },
								{ id: "sell", label: "Sell" },
							] as const
						).map((tab) => (
							<button
								key={tab.id}
								type="button"
								onClick={() => {
									setType(tab.id);
									setError(null);
									setFieldErrors({});
								}}
								className={`rounded border px-3 py-1.5 text-xs font-medium ${
									type === tab.id
										? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-text)]"
										: "border-[var(--border)] bg-[var(--bg-canvas)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
								}`}
							>
								{tab.label}
							</button>
						))}
					</div>
				</div>

				<div>
					<label
						htmlFor={venueId}
						className="block text-xs font-medium text-[var(--text-secondary)]"
					>
						Counts toward
					</label>
					<Select
						id={venueId}
						value={venue}
						aria-describedby={venueHintId}
						onValueChange={(value) => {
							setVenue(value as ManualVenue);
							clearFieldError("venue");
						}}
						className="mt-1 w-full"
					>
						<SelectItem value="manual">Manual (no exchange)</SelectItem>
						<SelectItem value="binance">Binance</SelectItem>
						<SelectItem value="coindcx">CoinDCX</SelectItem>
					</Select>
					<p
						id={venueHintId}
						className="mt-1 text-[11px] text-[var(--text-muted)]"
					>
						Assigning an exchange lets a missing event (e.g. an old P2P buy)
						close that exchange&apos;s balance gap.
					</p>
				</div>

				<div>
					<label
						htmlFor={dtId}
						className="block text-xs font-medium text-[var(--text-secondary)]"
					>
						Date &amp; time (IST)
					</label>
					<input
						id={dtId}
						type="datetime-local"
						required
						value={istDateTime}
						aria-invalid={Boolean(fieldErrors.timestamp)}
						aria-describedby={
							[
								notAfter && type !== "sell" ? dtHintId : null,
								fieldErrors.timestamp ? `${dtId}-error` : null,
							]
								.filter(Boolean)
								.join(" ") || undefined
						}
						onChange={(e) => {
							setIstDateTime(e.target.value);
							clearFieldError("timestamp");
						}}
						className={`mt-1 w-full rounded border ${inputBorderClass("timestamp")} bg-[var(--bg-canvas)] px-2.5 py-1.5 text-sm`}
					/>
					{notAfter && type !== "sell" ? (
						<p
							id={dtHintId}
							className="mt-1 text-[11px] text-[var(--text-muted)]"
						>
							Set this to when you actually got the coins (must be before the
							sale on {formatIstDateTime(notAfter)}). Prefilled one day earlier.
						</p>
					) : null}
					{fieldErrors.timestamp ? (
						<p id={`${dtId}-error`} className="mt-1 text-xs text-[var(--loss)]">
							{fieldErrors.timestamp}
						</p>
					) : null}
				</div>

				{type === "income" ? (
					<div>
						<label
							htmlFor={kindId}
							className="block text-xs font-medium text-[var(--text-secondary)]"
						>
							Income kind
						</label>
						<Select
							id={kindId}
							value={incomeKind}
							onValueChange={(value) => {
								setIncomeKind(value as IncomeKind);
								clearFieldError("incomeKind");
							}}
							className="mt-1 w-full"
						>
							{IncomeKindSchema.options.map((k) => (
								<SelectItem key={k} value={k}>
									{formatIncomeKind(k)}
								</SelectItem>
							))}
						</Select>
					</div>
				) : null}

				{needsIn ? (
					<div className="grid grid-cols-2 gap-3">
						<div>
							<label
								htmlFor={assetInId}
								className="block text-xs font-medium text-[var(--text-secondary)]"
							>
								Asset received *
							</label>
							<input
								id={assetInId}
								type="text"
								required
								placeholder="e.g. BTC"
								value={assetIn}
								aria-invalid={Boolean(fieldErrors.assetIn)}
								aria-describedby={
									fieldErrors.assetIn ? `${assetInId}-error` : undefined
								}
								onChange={(e) => {
									setAssetIn(e.target.value);
									clearFieldError("assetIn");
								}}
								className={`mt-1 w-full rounded border ${inputBorderClass("assetIn")} bg-[var(--bg-canvas)] px-2.5 py-1.5 text-sm uppercase placeholder:normal-case`}
							/>
							{fieldErrors.assetIn ? (
								<p
									id={`${assetInId}-error`}
									className="mt-1 text-xs text-[var(--loss)]"
								>
									{fieldErrors.assetIn}
								</p>
							) : null}
						</div>
						<div>
							<label
								htmlFor={amountInId}
								className="block text-xs font-medium text-[var(--text-secondary)]"
							>
								Quantity received *
							</label>
							<input
								id={amountInId}
								type="text"
								required
								inputMode="decimal"
								placeholder="e.g. 0.5"
								value={amountIn}
								aria-invalid={Boolean(fieldErrors.amountIn)}
								aria-describedby={
									[
										saleContext && type === "buy" ? amountInHintId : null,
										fieldErrors.amountIn ? `${amountInId}-error` : null,
									]
										.filter(Boolean)
										.join(" ") || undefined
								}
								onChange={(e) => {
									setAmountIn(e.target.value);
									clearFieldError("amountIn");
								}}
								className={`num mt-1 w-full rounded border ${inputBorderClass("amountIn")} bg-[var(--bg-canvas)] px-2.5 py-1.5 text-sm`}
							/>
							{fieldErrors.amountIn ? (
								<p
									id={`${amountInId}-error`}
									className="mt-1 text-xs text-[var(--loss)]"
								>
									{fieldErrors.amountIn}
								</p>
							) : null}
							{saleContext && type === "buy" ? (
								<p
									id={amountInHintId}
									className="mt-1 text-[11px] text-[var(--text-muted)]"
								>
									Prefilled with what the sale is missing. Change it if you got
									a different amount at that time.
								</p>
							) : null}
						</div>
					</div>
				) : null}

				{needsOut ? (
					<div className="grid grid-cols-2 gap-3">
						<div>
							<label
								htmlFor={assetOutId}
								className="block text-xs font-medium text-[var(--text-secondary)]"
							>
								{type === "buy"
									? "Quote asset paid (optional)"
									: "Asset sold *"}
							</label>
							<input
								id={assetOutId}
								type="text"
								required={type !== "buy"}
								placeholder={type === "buy" ? "e.g. INR or USDT" : "e.g. ETH"}
								value={assetOut}
								aria-invalid={Boolean(fieldErrors.assetOut)}
								aria-describedby={
									fieldErrors.assetOut ? `${assetOutId}-error` : undefined
								}
								onChange={(e) => {
									setAssetOut(e.target.value);
									clearFieldError("assetOut");
								}}
								className={`mt-1 w-full rounded border ${inputBorderClass("assetOut")} bg-[var(--bg-canvas)] px-2.5 py-1.5 text-sm uppercase placeholder:normal-case`}
							/>
							{fieldErrors.assetOut ? (
								<p
									id={`${assetOutId}-error`}
									className="mt-1 text-xs text-[var(--loss)]"
								>
									{fieldErrors.assetOut}
								</p>
							) : null}
						</div>
						<div>
							<label
								htmlFor={amountOutId}
								className="block text-xs font-medium text-[var(--text-secondary)]"
							>
								{type === "buy" ? "Quote quantity paid" : "Quantity sold *"}
							</label>
							<input
								id={amountOutId}
								type="text"
								required={type !== "buy"}
								inputMode="decimal"
								placeholder="e.g. 1.0"
								value={amountOut}
								aria-invalid={Boolean(fieldErrors.amountOut)}
								aria-describedby={
									fieldErrors.amountOut ? `${amountOutId}-error` : undefined
								}
								onChange={(e) => {
									setAmountOut(e.target.value);
									clearFieldError("amountOut");
								}}
								className={`num mt-1 w-full rounded border ${inputBorderClass("amountOut")} bg-[var(--bg-canvas)] px-2.5 py-1.5 text-sm`}
							/>
							{fieldErrors.amountOut ? (
								<p
									id={`${amountOutId}-error`}
									className="mt-1 text-xs text-[var(--loss)]"
								>
									{fieldErrors.amountOut}
								</p>
							) : null}
						</div>
					</div>
				) : null}

				<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
					<div>
						<label
							htmlFor={inrId}
							className="block text-xs font-medium text-[var(--text-secondary)]"
						>
							{type === "gift"
								? "Cost / FMV in INR (₹)"
								: type === "buy"
									? "Cost in INR (₹)"
									: type === "income"
										? "FMV at receipt in INR (₹)"
										: "Consideration in INR (₹)"}
						</label>
						<input
							id={inrId}
							type="text"
							inputMode="decimal"
							required={type === "buy" && !assetOut.trim()}
							placeholder="e.g. 200000"
							value={inrValue}
							aria-invalid={Boolean(fieldErrors.inrValue)}
							aria-describedby={
								[
									type === "buy" ? inrHintId : null,
									fieldErrors.inrValue ? `${inrId}-error` : null,
								]
									.filter(Boolean)
									.join(" ") || undefined
							}
							onChange={(e) => {
								setInrValue(e.target.value);
								clearFieldError("inrValue");
							}}
							className={`num mt-1 w-full rounded border ${inputBorderClass("inrValue")} bg-[var(--bg-canvas)] px-2.5 py-1.5 text-sm`}
						/>
						{fieldErrors.inrValue ? (
							<p
								id={`${inrId}-error`}
								className="mt-1 text-xs text-[var(--loss)]"
							>
								{fieldErrors.inrValue}
							</p>
						) : null}
						{type === "buy" ? (
							<p
								id={inrHintId}
								className="mt-1 text-[11px] text-[var(--text-muted)]"
							>
								What you paid in rupees, fees included. Required unless you fill
								in the quote asset and quantity paid: the app then values it
								from those and flags the row if it can't. It never guesses a
								cost.
							</p>
						) : null}
						{type === "gift" ? (
							<p className="mt-1 text-[11px] text-[var(--text-muted)]">
								Enter donor cost or receipt FMV in INR for gift threshold
								tracking.
							</p>
						) : null}
					</div>

					<div>
						<label
							htmlFor={tdsId}
							className="block text-xs font-medium text-[var(--text-secondary)]"
						>
							TDS deducted (₹, optional)
						</label>
						<input
							id={tdsId}
							type="text"
							inputMode="decimal"
							placeholder="e.g. 0"
							value={tdsInr}
							aria-invalid={Boolean(fieldErrors.tdsInr)}
							aria-describedby={
								fieldErrors.tdsInr ? `${tdsId}-error` : undefined
							}
							onChange={(e) => {
								setTdsInr(e.target.value);
								clearFieldError("tdsInr");
							}}
							className={`num mt-1 w-full rounded border ${inputBorderClass("tdsInr")} bg-[var(--bg-canvas)] px-2.5 py-1.5 text-sm`}
						/>
						{fieldErrors.tdsInr ? (
							<p
								id={`${tdsId}-error`}
								className="mt-1 text-xs text-[var(--loss)]"
							>
								{fieldErrors.tdsInr}
							</p>
						) : null}
					</div>
				</div>

				<div>
					<label
						htmlFor={noteId}
						className="block text-xs font-medium text-[var(--text-secondary)]"
					>
						Note
					</label>
					<textarea
						id={noteId}
						rows={2}
						value={userNote}
						onChange={(e) => setUserNote(e.target.value)}
						placeholder="Optional explanation or reference…"
						className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--bg-canvas)] px-2.5 py-1.5 text-sm"
					/>
				</div>

				<div className="flex justify-end gap-2 border-t border-[var(--border)] pt-3">
					<button
						type="button"
						onClick={onClose}
						className="rounded border border-[var(--border)] px-3.5 py-1.5 text-sm font-medium hover:bg-[var(--bg-hover)]"
					>
						Cancel
					</button>
					<button
						type="submit"
						disabled={saving}
						className="inline-flex items-center gap-1.5 rounded-md bg-[var(--accent)] px-4 py-1.5 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
					>
						<Plus className="h-4 w-4" aria-hidden="true" />
						{saving ? "Adding…" : "Add transaction"}
					</button>
				</div>
			</form>
		</Drawer>
	);
}
