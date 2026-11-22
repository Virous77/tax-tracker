"use client";

import {
	type AssetClass,
	type IncomeKind,
	IncomeKindSchema,
	type LedgerTx,
	type TxType,
} from "@tax/core";
import { Plus } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { InrAmountField } from "@/components/transactions/InrAmountField";
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
	missingExportHints,
	saleSourceLabel,
	venueForSource,
} from "@/lib/client/disposals";
import {
	formatDisposalSummary,
	formatIncomeKind,
	formatIstDateTime,
	formatQty,
} from "@/lib/client/format";
import { type InrEntryMode, inrTotalFromEntry } from "@/lib/client/inr-cost";
import { usePriceReference } from "@/lib/client/usePriceReference";
import { useSourceLabel } from "@/lib/client/useSourceLabel";

const DEFAULT_DATE_TIME = "2026-04-01T12:00";

/** The stored INR value is always the row total; the labels say so. */
const INR_LABELS = {
	buy: {
		total: "Total cost in INR (₹)",
		perUnit: (asset: string) => `Cost per ${asset || "unit"} in INR (₹)`,
	},
	gift: {
		total: "Total cost / FMV in INR (₹)",
		perUnit: (asset: string) => `Cost / FMV per ${asset || "unit"} in INR (₹)`,
	},
	income: {
		total: "Total FMV at receipt in INR (₹)",
		perUnit: (asset: string) => `FMV per ${asset || "unit"} in INR (₹)`,
	},
	sell: {
		total: "Total consideration in INR (₹)",
		perUnit: (asset: string) => `Price per ${asset || "unit"} in INR (₹)`,
	},
} as const;

function decimalOrNull(text: string): boolean {
	return /^\d+(\.\d+)?$/.test(text);
}

export type ManualPreset =
	| "buy"
	| "gift"
	| "income"
	| "sell"
	| "dividend"
	| "foreign_tax";

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
				{formatDisposalSummary(sale.tx, sale.asset)} on{" "}
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
	initialAssetClass = "vda",
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
	initialAssetClass?: AssetClass;
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
	const searchParams = useSearchParams();
	const urlQty = searchParams.get("qty");
	const rawUrlVenue = searchParams.get("venue");
	const urlVenue: ManualVenue | null =
		rawUrlVenue === "binance" ||
		rawUrlVenue === "coindcx" ||
		rawUrlVenue === "us_broker" ||
		rawUrlVenue === "manual"
			? rawUrlVenue
			: null;

	const [assetClass, setAssetClass] = useState<AssetClass>(initialAssetClass);
	const [type, setType] = useState<TxType>(initialPreset);
	const [venue, setVenue] = useState<ManualVenue>(urlVenue ?? initialVenue);
	const [istDateTime, setIstDateTime] = useState(
		initialDateTime ?? DEFAULT_DATE_TIME,
	);
	const [assetIn, setAssetIn] = useState(initialAsset);
	const [amountIn, setAmountIn] = useState("");
	const [assetOut, setAssetOut] = useState("");
	const [amountOut, setAmountOut] = useState("");
	const [dividendAsset, setDividendAsset] = useState("");
	const [withholdingTaxAmount, setWithholdingTaxAmount] = useState("");
	const [feeAmountUsd, setFeeAmountUsd] = useState("");
	const [entityName, setEntityName] = useState("");
	const [inrValue, setInrValue] = useState("");
	const [inrMode, setInrMode] = useState<InrEntryMode>("total");
	const [incomeKind, setIncomeKind] = useState<IncomeKind>("staking");
	const [tdsInr, setTdsInr] = useState("");
	const [userNote, setUserNote] = useState("");
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

	const pricedAsset = (type === "sell" ? assetOut : assetIn)
		.trim()
		.toUpperCase();
	const pricedQuantity = type === "sell" ? amountOut : amountIn;
	const inrLabelKey: keyof typeof INR_LABELS =
		type === "buy" || type === "gift" || type === "income" ? type : "sell";
	const entryDate = new Date(`${istDateTime}:00+05:30`);
	const entryInstant = Number.isFinite(entryDate.getTime())
		? entryDate.toISOString()
		: undefined;
	const priceReference = usePriceReference(pricedAsset, {
		enabled: open && assetClass === "vda",
		...(saleContext && type === "buy" ? { sale: saleContext.tx } : {}),
		...(entryInstant ? { at: entryInstant } : {}),
	});

	const venueId = useId();
	const venueHintId = useId();
	const dtId = useId();
	const assetInId = useId();
	const amountInId = useId();
	const assetOutId = useId();
	const amountOutId = useId();
	const dividendTickerId = useId();
	const withholdingId = useId();
	const feeUsdId = useId();
	const entityNameId = useId();
	const inrId = useId();
	const kindId = useId();
	const tdsId = useId();
	const noteId = useId();
	const dtHintId = useId();
	const amountInHintId = useId();

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
		const derivedSaleVenue: ManualVenue | null = saleContext
			? saleContext.tx.assetClass === "us_equity" ||
				saleContext.tx.source === "vested"
				? "us_broker"
				: venueForSource(saleContext.tx)
			: null;
		const resolvedVenue: ManualVenue =
			urlVenue ??
			(initialVenue !== "manual" ? initialVenue : null) ??
			derivedSaleVenue ??
			(initialAssetClass === "us_equity" ? "us_broker" : "manual");
		const resolvedAmount =
			initialAmount || urlQty || saleContext?.quantity || "";
		setAssetClass(initialAssetClass);
		setType(initialPreset);
		setVenue(resolvedVenue);
		if (initialPreset === "sell") {
			setAssetOut(initialAsset.toUpperCase());
			setAssetIn(initialAssetClass === "us_equity" ? "USD" : "");
		} else if (initialPreset === "dividend") {
			setAssetIn("USD");
			setAssetOut("");
			setDividendAsset(initialAsset.toUpperCase());
		} else if (initialPreset === "foreign_tax") {
			setAssetIn("");
			setAssetOut("USD");
			setDividendAsset(initialAsset.toUpperCase());
		} else {
			setAssetIn(initialAsset.toUpperCase());
			setAssetOut(initialAssetClass === "us_equity" ? "USD" : "");
		}
		if (initialPreset !== "dividend" && initialPreset !== "foreign_tax") {
			setDividendAsset("");
		}
		setIstDateTime(initialDateTime ?? DEFAULT_DATE_TIME);
		setAmountIn(initialPreset === "sell" ? "" : resolvedAmount);
		setAmountOut("");
		setWithholdingTaxAmount("");
		setFeeAmountUsd("");
		setEntityName("");
		setInrValue("");
		setInrMode("total");
		setTdsInr("");
		setUserNote("");
		setError(null);
		setFieldErrors({});
	}, [
		open,
		initialPreset,
		initialAssetClass,
		initialAsset,
		initialVenue,
		initialDateTime,
		initialAmount,
		saleContext,
		urlQty,
		urlVenue,
	]);

	function handleAssetClassChange(next: AssetClass) {
		setAssetClass(next);
		setError(null);
		setFieldErrors({});
		if (next === "us_equity") {
			const nextType: TxType =
				type === "buy" ||
				type === "sell" ||
				type === "dividend" ||
				type === "foreign_tax"
					? type
					: "buy";
			setType(nextType);
			setVenue("us_broker");
			if (nextType === "buy") {
				setAssetOut((prev) => prev || "USD");
			} else if (nextType === "sell" || nextType === "dividend") {
				setAssetIn((prev) => prev || "USD");
			} else if (nextType === "foreign_tax") {
				setAssetOut((prev) => prev || "USD");
			}
		} else {
			const nextType: TxType =
				type === "buy" ||
				type === "sell" ||
				type === "gift" ||
				type === "income"
					? type
					: "buy";
			setType(nextType);
			if (venue === "us_broker") setVenue("manual");
			if (nextType === "buy" && assetOut === "USD") setAssetOut("");
			if (nextType === "sell" && assetIn === "USD") setAssetIn("");
		}
	}

	function handleTypeChange(nextType: TxType) {
		setType(nextType);
		setError(null);
		setFieldErrors({});
		if (assetClass === "us_equity") {
			if (nextType === "buy") {
				setAssetOut("USD");
				if (assetIn === "USD") setAssetIn("");
			} else if (nextType === "sell") {
				setAssetIn("USD");
				if (assetOut === "USD") setAssetOut("");
			} else if (nextType === "dividend") {
				setAssetIn("USD");
				setAssetOut("");
				setAmountOut("");
			} else if (nextType === "foreign_tax") {
				setAssetIn("");
				setAmountIn("");
				setAssetOut("USD");
			}
		}
	}

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
			const normDividendAsset = dividendAsset.trim().toUpperCase();
			const trimmedWithholdingTax = withholdingTaxAmount.trim();
			const trimmedFeeUsd = feeAmountUsd.trim();
			const trimmedEntityName = entityName.trim();
			const typedInr = inrValue.trim();
			const trimmedInr =
				inrMode === "perUnit" && typedInr !== ""
					? inrTotalFromEntry(inrMode, typedInr, pricedQuantity)
					: typedInr;
			if (trimmedInr === null) {
				const msg = decimalOrNull(typedInr)
					? `Enter the quantity first: the total is the price per ${pricedAsset || "unit"} times the quantity.`
					: "Enter the price as a number, e.g. 95.";
				setFieldErrors({ inrValue: msg });
				setError(msg);
				return;
			}

			const isUsEquity = assetClass === "us_equity";
			const payload = {
				sourceRef: `manual-${crypto.randomUUID()}`,
				importId: null,
				timestamp: iso,
				type,
				assetClass,
				venue,
				...(type === "income" ? { incomeKind } : {}),
				...(normAssetIn ? { assetIn: normAssetIn } : {}),
				...(trimmedAmountIn ? { amountIn: trimmedAmountIn } : {}),
				...(normAssetOut ? { assetOut: normAssetOut } : {}),
				...(trimmedAmountOut ? { amountOut: trimmedAmountOut } : {}),
				...(isUsEquity &&
				(type === "dividend" || type === "foreign_tax") &&
				normDividendAsset
					? { dividendAsset: normDividendAsset }
					: {}),
				...(isUsEquity && type === "dividend" && trimmedWithholdingTax !== ""
					? {
							withholdingTaxAmount: trimmedWithholdingTax,
							withholdingTaxAsset: "USD",
						}
					: {}),
				...(isUsEquity && type === "foreign_tax" && trimmedAmountOut !== ""
					? {
							withholdingTaxAmount: trimmedAmountOut,
							withholdingTaxAsset: normAssetOut || "USD",
						}
					: {}),
				...(isUsEquity &&
				(type === "buy" || type === "sell") &&
				trimmedFeeUsd !== ""
					? {
							feeAmount: trimmedFeeUsd,
							feeAsset: "USD",
						}
					: {}),
				...(isUsEquity && trimmedEntityName
					? { entityName: trimmedEntityName }
					: {}),
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
					assetClass,
					istDateTime,
					type,
					venue,
					assetIn: normAssetIn || undefined,
					amountIn: trimmedAmountIn || undefined,
					assetOut: normAssetOut || undefined,
					amountOut: trimmedAmountOut || undefined,
					dividendAsset: normDividendAsset || undefined,
					withholdingTaxAmount: trimmedWithholdingTax || undefined,
					feeAmount: trimmedFeeUsd || undefined,
					entityName: trimmedEntityName || undefined,
					inrValue: trimmedInr || undefined,
					inrPerUnitEntered:
						inrMode === "perUnit" && typedInr ? typedInr : undefined,
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

	const isUsEquity = assetClass === "us_equity";
	const needsIn =
		!isUsEquity && ["buy", "income", "gift", "deposit", "swap"].includes(type);
	const needsOut =
		!isUsEquity &&
		(["sell", "withdrawal", "swap"].includes(type) || type === "buy");

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
			subtitle={
				isUsEquity
					? "Record a US stock buy, sell, dividend (with US tax withheld), or foreign tax entry."
					: "Record a missing buy, gift (with optional cost/FMV), or staking/airdrop income."
			}
		>
			<form onSubmit={handleSubmit} className="space-y-4">
				{saleContext && type === "buy" && !isUsEquity ? (
					<SaleContextBox sale={saleContext} />
				) : null}

				{error ? <ErrorBanner message={error} /> : null}

				<div className="space-y-1.5">
					<span className="block text-xs font-medium text-[var(--text-secondary)]">
						Asset class
					</span>
					<div className="grid grid-cols-2 gap-2">
						{(
							[
								{ id: "vda", label: "Crypto (VDA)" },
								{ id: "us_equity", label: "US Stocks" },
							] as const
						).map((tab) => (
							<button
								key={tab.id}
								type="button"
								onClick={() => handleAssetClassChange(tab.id)}
								className={`rounded border px-3 py-1.5 text-xs font-medium ${
									assetClass === tab.id
										? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-text)]"
										: "border-[var(--border)] bg-[var(--bg-canvas)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
								}`}
							>
								{tab.label}
							</button>
						))}
					</div>
				</div>

				<div className="space-y-1.5">
					<span className="block text-xs font-medium text-[var(--text-secondary)]">
						Entry type
					</span>
					<div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
						{(isUsEquity
							? ([
									{ id: "buy", label: "Buy" },
									{ id: "sell", label: "Sell" },
									{ id: "dividend", label: "Dividend" },
									{ id: "foreign_tax", label: "Foreign Tax" },
								] as const)
							: ([
									{ id: "buy", label: "Missing Buy" },
									{ id: "gift", label: "Gift" },
									{ id: "income", label: "Income" },
									{ id: "sell", label: "Sell" },
								] as const)
						).map((tab) => (
							<button
								key={tab.id}
								type="button"
								onClick={() => handleTypeChange(tab.id)}
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
						options={
							isUsEquity
								? [
										{ value: "us_broker", label: "US Broker" },
										{ value: "manual", label: "Manual (no broker)" },
									]
								: [
										{ value: "manual", label: "Manual (no exchange)" },
										{ value: "binance", label: "Binance" },
										{ value: "coindcx", label: "CoinDCX" },
									]
						}
						className="mt-1 w-full"
					/>
					<p
						id={venueHintId}
						className="mt-1 text-[11px] text-[var(--text-muted)]"
					>
						{isUsEquity
							? "Group manual US stock rows under your US broker or standalone manual entries."
							: "Assigning an exchange lets a missing event (e.g. an old P2P buy) close that exchange's balance gap."}
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

				{isUsEquity ? (
					<div className="space-y-4">
						{(type === "buy" || type === "sell") && (
							<>
								<div className="grid grid-cols-2 gap-3">
									<div>
										<label
											htmlFor={type === "buy" ? assetInId : assetOutId}
											className="block text-xs font-medium text-[var(--text-secondary)]"
										>
											Stock ticker *
										</label>
										<input
											id={type === "buy" ? assetInId : assetOutId}
											type="text"
											required
											placeholder="e.g. AAPL"
											value={type === "buy" ? assetIn : assetOut}
											onChange={(e) => {
												if (type === "buy") {
													setAssetIn(e.target.value);
													clearFieldError("assetIn");
												} else {
													setAssetOut(e.target.value);
													clearFieldError("assetOut");
												}
											}}
											className={`mt-1 w-full rounded border ${inputBorderClass(type === "buy" ? "assetIn" : "assetOut")} bg-[var(--bg-canvas)] px-2.5 py-1.5 text-sm uppercase placeholder:normal-case`}
										/>
									</div>
									<div>
										<label
											htmlFor={type === "buy" ? amountInId : amountOutId}
											className="block text-xs font-medium text-[var(--text-secondary)]"
										>
											Shares *
										</label>
										<input
											id={type === "buy" ? amountInId : amountOutId}
											type="text"
											required
											inputMode="decimal"
											placeholder="e.g. 10"
											value={type === "buy" ? amountIn : amountOut}
											onChange={(e) => {
												if (type === "buy") {
													setAmountIn(e.target.value);
													clearFieldError("amountIn");
												} else {
													setAmountOut(e.target.value);
													clearFieldError("amountOut");
												}
											}}
											className={`num mt-1 w-full rounded border ${inputBorderClass(type === "buy" ? "amountIn" : "amountOut")} bg-[var(--bg-canvas)] px-2.5 py-1.5 text-sm`}
										/>
									</div>
								</div>

								<div className="grid grid-cols-2 gap-3">
									<div>
										<label
											htmlFor={type === "buy" ? amountOutId : amountInId}
											className="block text-xs font-medium text-[var(--text-secondary)]"
										>
											{type === "buy"
												? "Total cost (USD) *"
												: "Gross proceeds (USD) *"}
										</label>
										<input
											id={type === "buy" ? amountOutId : amountInId}
											type="text"
											required
											inputMode="decimal"
											placeholder="e.g. 1500.00"
											value={type === "buy" ? amountOut : amountIn}
											onChange={(e) => {
												if (type === "buy") {
													setAmountOut(e.target.value);
													clearFieldError("amountOut");
												} else {
													setAmountIn(e.target.value);
													clearFieldError("amountIn");
												}
											}}
											className={`num mt-1 w-full rounded border ${inputBorderClass(type === "buy" ? "amountOut" : "amountIn")} bg-[var(--bg-canvas)] px-2.5 py-1.5 text-sm`}
										/>
									</div>
									<div>
										<label
											htmlFor={feeUsdId}
											className="block text-xs font-medium text-[var(--text-secondary)]"
										>
											Brokerage fee (USD, optional)
										</label>
										<input
											id={feeUsdId}
											type="text"
											inputMode="decimal"
											placeholder="e.g. 0.03"
											value={feeAmountUsd}
											onChange={(e) => {
												setFeeAmountUsd(e.target.value);
												clearFieldError("feeAmount");
											}}
											className={`num mt-1 w-full rounded border ${inputBorderClass("feeAmount")} bg-[var(--bg-canvas)] px-2.5 py-1.5 text-sm`}
										/>
									</div>
								</div>
							</>
						)}

						{type === "dividend" && (
							<div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
								<div>
									<label
										htmlFor={dividendTickerId}
										className="block text-xs font-medium text-[var(--text-secondary)]"
									>
										Stock ticker *
									</label>
									<input
										id={dividendTickerId}
										type="text"
										required
										placeholder="e.g. AAPL"
										value={dividendAsset}
										onChange={(e) => {
											setDividendAsset(e.target.value);
											clearFieldError("dividendAsset");
										}}
										className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--bg-canvas)] px-2.5 py-1.5 text-sm uppercase placeholder:normal-case"
									/>
								</div>
								<div>
									<label
										htmlFor={amountInId}
										className="block text-xs font-medium text-[var(--text-secondary)]"
									>
										Gross dividend (USD) *
									</label>
									<input
										id={amountInId}
										type="text"
										required
										inputMode="decimal"
										placeholder="e.g. 9.24"
										value={amountIn}
										onChange={(e) => {
											setAmountIn(e.target.value);
											clearFieldError("amountIn");
										}}
										className={`num mt-1 w-full rounded border ${inputBorderClass("amountIn")} bg-[var(--bg-canvas)] px-2.5 py-1.5 text-sm`}
									/>
								</div>
								<div>
									<label
										htmlFor={withholdingId}
										className="block text-xs font-medium text-[var(--text-secondary)]"
									>
										US tax withheld (USD)
									</label>
									<input
										id={withholdingId}
										type="text"
										inputMode="decimal"
										placeholder="e.g. 2.31"
										value={withholdingTaxAmount}
										onChange={(e) => {
											setWithholdingTaxAmount(e.target.value);
											clearFieldError("withholdingTaxAmount");
										}}
										className={`num mt-1 w-full rounded border ${inputBorderClass("withholdingTaxAmount")} bg-[var(--bg-canvas)] px-2.5 py-1.5 text-sm`}
									/>
								</div>
							</div>
						)}

						{type === "foreign_tax" && (
							<div className="grid grid-cols-2 gap-3">
								<div>
									<label
										htmlFor={dividendTickerId}
										className="block text-xs font-medium text-[var(--text-secondary)]"
									>
										Stock ticker (optional)
									</label>
									<input
										id={dividendTickerId}
										type="text"
										placeholder="e.g. AAPL"
										value={dividendAsset}
										onChange={(e) => setDividendAsset(e.target.value)}
										className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--bg-canvas)] px-2.5 py-1.5 text-sm uppercase placeholder:normal-case"
									/>
								</div>
								<div>
									<label
										htmlFor={amountOutId}
										className="block text-xs font-medium text-[var(--text-secondary)]"
									>
										Foreign tax paid (USD) *
									</label>
									<input
										id={amountOutId}
										type="text"
										required
										inputMode="decimal"
										placeholder="e.g. 2.31"
										value={amountOut}
										onChange={(e) => {
											setAmountOut(e.target.value);
											clearFieldError("amountOut");
										}}
										className={`num mt-1 w-full rounded border ${inputBorderClass("amountOut")} bg-[var(--bg-canvas)] px-2.5 py-1.5 text-sm`}
									/>
								</div>
							</div>
						)}

						<div>
							<label
								htmlFor={entityNameId}
								className="block text-xs font-medium text-[var(--text-secondary)]"
							>
								Company / entity name (optional, for Schedule FA)
							</label>
							<input
								id={entityNameId}
								type="text"
								placeholder="e.g. APPLE INC"
								value={entityName}
								onChange={(e) => setEntityName(e.target.value)}
								className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--bg-canvas)] px-2.5 py-1.5 text-sm"
							/>
						</div>

						<p className="text-[11px] text-[var(--text-muted)]">
							INR values for US stocks are converted automatically from USD
							using the SBI TT buying rate configured in Settings.
						</p>
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

				{!isUsEquity ? (
					<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
						<div className="sm:col-span-2">
							<InrAmountField
								id={inrId}
								totalLabel={INR_LABELS[inrLabelKey].total}
								perUnitLabel={INR_LABELS[inrLabelKey].perUnit(pricedAsset)}
								mode={inrMode}
								onModeChange={(next) => {
									setInrMode(next);
									clearFieldError("inrValue");
								}}
								text={inrValue}
								onTextChange={(next) => {
									setInrValue(next);
									clearFieldError("inrValue");
								}}
								quantity={pricedQuantity}
								asset={pricedAsset}
								reference={priceReference}
								required={type === "buy" && !assetOut.trim()}
								placeholder={inrMode === "total" ? "e.g. 200000" : "e.g. 95"}
								error={fieldErrors.inrValue}
								hint={
									type === "buy"
										? "Required unless you fill in the quote asset and quantity paid: the app then values it from those and flags the row if it can't. It never guesses a cost."
										: type === "gift"
											? "Enter donor cost or receipt FMV in INR for gift threshold tracking."
											: undefined
								}
							/>
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
				) : null}

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
