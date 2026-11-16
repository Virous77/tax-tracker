"use client";

import {
	type IncomeKind,
	IncomeKindSchema,
	type LedgerTx,
	type TxType,
} from "@tax/core";
import { Plus } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { Drawer } from "@/components/ui/Drawer";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { api, getErrorMessage } from "@/lib/client/api";

export type ManualPreset = "buy" | "gift" | "income" | "sell";

export function AddManualTxDrawer({
	open,
	initialPreset = "buy",
	initialAsset = "",
	onClose,
	onCreated,
}: {
	open: boolean;
	initialPreset?: ManualPreset;
	initialAsset?: string;
	onClose: () => void;
	onCreated: (tx: LedgerTx) => void;
}) {
	const [type, setType] = useState<TxType>(initialPreset);
	const [istDateTime, setIstDateTime] = useState("2026-04-01T12:00");
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

	const dtId = useId();
	const assetInId = useId();
	const amountInId = useId();
	const assetOutId = useId();
	const amountOutId = useId();
	const inrId = useId();
	const kindId = useId();
	const tdsId = useId();
	const noteId = useId();

	useEffect(() => {
		if (!open) return;
		setType(initialPreset);
		if (initialPreset === "sell") {
			setAssetOut(initialAsset.toUpperCase());
			setAssetIn("");
		} else {
			setAssetIn(initialAsset.toUpperCase());
			setAssetOut("");
		}
		setAmountIn("");
		setAmountOut("");
		setInrValue("");
		setTdsInr("");
		setUserNote("");
		setError(null);
	}, [open, initialPreset, initialAsset]);

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		setSaving(true);
		setError(null);
		try {
			const parsedInstant = new Date(`${istDateTime}:00+05:30`);
			if (!Number.isFinite(parsedInstant.getTime())) {
				throw new Error("Please enter a valid date and time in IST.");
			}
			const iso = parsedInstant.toISOString();
			const normAssetIn = assetIn.trim().toUpperCase();
			const normAssetOut = assetOut.trim().toUpperCase();
			const trimmedInr = inrValue.trim();

			const payload = {
				sourceRef: `manual-${crypto.randomUUID()}`,
				importId: null,
				timestamp: iso,
				type,
				...(type === "income" ? { incomeKind } : {}),
				...(normAssetIn && amountIn.trim()
					? { assetIn: normAssetIn, amountIn: amountIn.trim() }
					: {}),
				...(normAssetOut && amountOut.trim()
					? { assetOut: normAssetOut, amountOut: amountOut.trim() }
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
					istDateTime,
					type,
					assetIn: normAssetIn || undefined,
					amountIn: amountIn.trim() || undefined,
					assetOut: normAssetOut || undefined,
					amountOut: amountOut.trim() || undefined,
					inrValue: trimmedInr || undefined,
					note: userNote.trim() || undefined,
				},
				reviewFlags: [],
				...(userNote.trim() ? { userNote: userNote.trim() } : {}),
			};

			const created = await api.createTransaction(payload);
			onCreated(created);
		} catch (err) {
			setError(getErrorMessage(err));
		} finally {
			setSaving(false);
		}
	}

	const needsIn = ["buy", "income", "gift", "deposit", "swap"].includes(type);
	const needsOut =
		["sell", "withdrawal", "swap"].includes(type) || type === "buy";

	return (
		<Drawer
			open={open}
			onClose={onClose}
			title="Add manual transaction"
			subtitle="Record a missing buy, gift (with optional cost/FMV), or staking/airdrop income."
		>
			<form onSubmit={handleSubmit} className="space-y-4">
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
								onClick={() => setType(tab.id)}
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
						onChange={(e) => setIstDateTime(e.target.value)}
						className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--bg-canvas)] px-2.5 py-1.5 text-sm"
					/>
				</div>

				{type === "income" ? (
					<div>
						<label
							htmlFor={kindId}
							className="block text-xs font-medium text-[var(--text-secondary)]"
						>
							Income kind
						</label>
						<select
							id={kindId}
							value={incomeKind}
							onChange={(e) => setIncomeKind(e.target.value as IncomeKind)}
							className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--bg-canvas)] px-2.5 py-1.5 text-sm"
						>
							{IncomeKindSchema.options.map((k) => (
								<option key={k} value={k}>
									{k}
								</option>
							))}
						</select>
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
								placeholder="BTC"
								value={assetIn}
								onChange={(e) => setAssetIn(e.target.value)}
								className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--bg-canvas)] px-2.5 py-1.5 text-sm uppercase"
							/>
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
								placeholder="0.5"
								value={amountIn}
								onChange={(e) => setAmountIn(e.target.value)}
								className="num mt-1 w-full rounded border border-[var(--border)] bg-[var(--bg-canvas)] px-2.5 py-1.5 text-sm"
							/>
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
								placeholder={type === "buy" ? "INR or USDT" : "ETH"}
								value={assetOut}
								onChange={(e) => setAssetOut(e.target.value)}
								className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--bg-canvas)] px-2.5 py-1.5 text-sm uppercase"
							/>
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
								placeholder="1.0"
								value={amountOut}
								onChange={(e) => setAmountOut(e.target.value)}
								className="num mt-1 w-full rounded border border-[var(--border)] bg-[var(--bg-canvas)] px-2.5 py-1.5 text-sm"
							/>
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
							placeholder="200000.00"
							value={inrValue}
							onChange={(e) => setInrValue(e.target.value)}
							className="num mt-1 w-full rounded border border-[var(--border)] bg-[var(--bg-canvas)] px-2.5 py-1.5 text-sm"
						/>
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
							placeholder="0"
							value={tdsInr}
							onChange={(e) => setTdsInr(e.target.value)}
							className="num mt-1 w-full rounded border border-[var(--border)] bg-[var(--bg-canvas)] px-2.5 py-1.5 text-sm"
						/>
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
