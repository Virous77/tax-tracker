"use client";

import {
	type IncomeKind,
	IncomeKindSchema,
	type LedgerTx,
	type ReviewCode,
	type TxType,
	TxTypeSchema,
} from "@tax/core";
import { ExternalLink, Save, Trash2 } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Drawer } from "@/components/ui/Drawer";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { api, getErrorMessage, ValidationError } from "@/lib/client/api";
import { resolveTxExplorer } from "@/lib/client/chains";
import {
	formatIncomeKind,
	formatInrNullable,
	formatInrRateSource,
	formatIstDateTime,
	formatQty,
	formatSourceLabel,
	formatTxType,
} from "@/lib/client/format";

export function TransactionDrawer({
	tx,
	onClose,
	onUpdated,
	onDeleted,
}: {
	tx: LedgerTx | null;
	onClose: () => void;
	onUpdated: (updated: LedgerTx) => void;
	onDeleted: (id: string) => void;
}) {
	const [type, setType] = useState<TxType>("buy");
	const [incomeKind, setIncomeKind] = useState<IncomeKind | "">("");
	const [inrValue, setInrValue] = useState("");
	const [userNote, setUserNote] = useState("");
	const [resolveFlags, setResolveFlags] = useState<Set<ReviewCode>>(new Set());
	const [saving, setSaving] = useState(false);
	const [deleting, setDeleting] = useState(false);
	const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [inrError, setInrError] = useState<string | null>(null);

	const typeId = useId();
	const incomeKindId = useId();
	const inrId = useId();
	const noteId = useId();

	useEffect(() => {
		if (!tx) return;
		setType(tx.type);
		setIncomeKind(tx.incomeKind ?? "");
		setInrValue(tx.inrValue ?? "");
		setUserNote(tx.userNote ?? "");
		setResolveFlags(new Set());
		setError(null);
		setInrError(null);
	}, [tx]);

	async function handleSave(e: React.FormEvent) {
		if (!tx) return;
		e.preventDefault();
		setSaving(true);
		setError(null);
		setInrError(null);
		try {
			const patch: {
				type?: TxType;
				incomeKind?: IncomeKind;
				inrValue?: string;
				userNote?: string;
				resolveFlags?: ReviewCode[];
			} = {};
			if (type !== tx.type) patch.type = type;
			if (type === "income" && incomeKind && incomeKind !== tx.incomeKind) {
				patch.incomeKind = incomeKind;
			}
			const trimmedInr = inrValue.trim();
			if (trimmedInr !== "" && trimmedInr !== (tx.inrValue ?? "")) {
				patch.inrValue = trimmedInr;
			}
			if (userNote !== (tx.userNote ?? "")) {
				patch.userNote = userNote;
			}
			if (resolveFlags.size > 0) {
				patch.resolveFlags = Array.from(resolveFlags);
			}
			const updated = await api.patchTransaction(tx.id, patch);
			onUpdated(updated);
		} catch (err) {
			if (err instanceof ValidationError) {
				setInrError(err.fieldErrors.inrValue ?? null);
				setError(err.message);
			} else {
				setError(getErrorMessage(err));
			}
		} finally {
			setSaving(false);
		}
	}

	async function handleDelete() {
		if (!tx) return;
		setDeleting(true);
		setError(null);
		try {
			await api.deleteTransaction(tx.id);
			setConfirmDeleteOpen(false);
			onDeleted(tx.id);
		} catch (err) {
			setError(getErrorMessage(err));
		} finally {
			setDeleting(false);
		}
	}

	return (
		<>
			<Drawer
				open={Boolean(tx)}
				onClose={onClose}
				title={
					tx
						? `${formatTxType(tx.type)} · ${tx.assetIn ?? tx.assetOut ?? "Transaction"}`
						: "Transaction"
				}
				subtitle={
					tx
						? `${formatIstDateTime(tx.timestamp)} · ${formatSourceLabel(tx.source)} · Ref: ${tx.sourceRef}`
						: undefined
				}
			>
				{tx ? (
					<div className="space-y-5">
						{error ? <ErrorBanner message={error} /> : null}

						<dl className="grid grid-cols-2 gap-3 rounded-md border border-[var(--border)] bg-[var(--bg-subtle)] p-3 text-xs">
							{tx.assetIn ? (
								<div>
									<dt className="text-[var(--text-muted)]">Asset In</dt>
									<dd className="num mt-0.5 font-semibold">
										{formatQty(tx.amountIn)} {tx.assetIn}
									</dd>
								</div>
							) : null}
							{tx.assetOut ? (
								<div>
									<dt className="text-[var(--text-muted)]">Asset Out</dt>
									<dd className="num mt-0.5 font-semibold">
										{formatQty(tx.amountOut)} {tx.assetOut}
									</dd>
								</div>
							) : null}
							<div>
								<dt className="text-[var(--text-muted)]">Current INR Value</dt>
								<dd className="num mt-0.5 font-semibold">
									{formatInrNullable(tx.inrValue)}
								</dd>
							</div>
							<div>
								<dt className="text-[var(--text-muted)]">TDS Deducted</dt>
								<dd className="num mt-0.5 font-semibold">
									{formatInrNullable(tx.tdsInr)}
								</dd>
							</div>
							{tx.feeAsset ? (
								<div>
									<dt className="text-[var(--text-muted)]">Fee</dt>
									<dd className="num mt-0.5">
										{formatQty(tx.feeAmount)} {tx.feeAsset}
										{tx.gstInr ? ` (GST ${formatInrNullable(tx.gstInr)})` : ""}
									</dd>
								</div>
							) : null}
							{tx.priceQuote ? (
								<div>
									<dt className="text-[var(--text-muted)]">Price Quote</dt>
									<dd className="num mt-0.5">
										{formatQty(tx.priceQuote.price)} {tx.priceQuote.asset}
									</dd>
								</div>
							) : null}
							{tx.inrRateSource ? (
								<div>
									<dt className="text-[var(--text-muted)]">INR Rate Source</dt>
									<dd className="mt-0.5 font-medium">
										{formatInrRateSource(tx.inrRateSource)}
									</dd>
								</div>
							) : null}
							{tx.txHash ? (
								<div className="col-span-2">
									<dt className="text-[var(--text-muted)]">Transaction Hash</dt>
									<dd className="mt-0.5 flex flex-wrap items-center gap-2">
										<code className="font-mono-code break-all text-[11px] text-[var(--text-primary)]">
											{tx.txHash}
										</code>
										{(() => {
											const explorer = resolveTxExplorer(
												tx.txHash,
												tx.chain,
												tx.source,
											);
											return explorer ? (
												<a
													href={explorer.url}
													target="_blank"
													rel="noopener noreferrer"
													className="inline-flex items-center gap-1 font-medium text-[var(--accent-text)] hover:underline"
												>
													{explorer.label}
													<ExternalLink
														className="h-3 w-3"
														aria-hidden="true"
													/>
												</a>
											) : null;
										})()}
									</dd>
								</div>
							) : null}
						</dl>

						<form onSubmit={handleSave} className="space-y-4">
							<h3 className="text-xs font-semibold tracking-wide text-[var(--text-secondary)] uppercase">
								Edit Ledger Entry
							</h3>

							<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
								<div>
									<label
										htmlFor={typeId}
										className="block text-xs font-medium text-[var(--text-secondary)]"
									>
										Transaction type
									</label>
									<select
										id={typeId}
										value={type}
										onChange={(e) => setType(e.target.value as TxType)}
										className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--bg-canvas)] px-2.5 py-1.5 text-sm"
									>
										{TxTypeSchema.options.map((opt) => (
											<option key={opt} value={opt}>
												{formatTxType(opt)}
											</option>
										))}
									</select>
								</div>

								{type === "income" ? (
									<div>
										<label
											htmlFor={incomeKindId}
											className="block text-xs font-medium text-[var(--text-secondary)]"
										>
											Income kind
										</label>
										<select
											id={incomeKindId}
											value={incomeKind}
											onChange={(e) =>
												setIncomeKind(e.target.value as IncomeKind | "")
											}
											className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--bg-canvas)] px-2.5 py-1.5 text-sm"
										>
											<option value="">Select kind…</option>
											{IncomeKindSchema.options.map((k) => (
												<option key={k} value={k}>
													{formatIncomeKind(k)}
												</option>
											))}
										</select>
									</div>
								) : null}

								<div>
									<label
										htmlFor={inrId}
										className="block text-xs font-medium text-[var(--text-secondary)]"
									>
										INR value (₹)
									</label>
									<input
										id={inrId}
										type="text"
										inputMode="decimal"
										value={inrValue}
										aria-invalid={Boolean(inrError)}
										aria-describedby={inrError ? `${inrId}-error` : undefined}
										onChange={(e) => {
											setInrValue(e.target.value);
											setInrError(null);
										}}
										placeholder="e.g. 250000.00"
										className={`num mt-1 w-full rounded border ${inrError ? "border-[var(--loss)]" : "border-[var(--border)]"} bg-[var(--bg-canvas)] px-2.5 py-1.5 text-sm`}
									/>
									{inrError ? (
										<p
											id={`${inrId}-error`}
											className="mt-1 text-xs text-[var(--loss)]"
										>
											{inrError}
										</p>
									) : null}
								</div>
							</div>

							<div>
								<label
									htmlFor={noteId}
									className="block text-xs font-medium text-[var(--text-secondary)]"
								>
									Note (saved for CA / audit trail)
								</label>
								<textarea
									id={noteId}
									rows={2}
									value={userNote}
									onChange={(e) => setUserNote(e.target.value)}
									placeholder="Explain why this value or type was adjusted…"
									className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--bg-canvas)] px-2.5 py-1.5 text-sm"
								/>
							</div>

							{tx.reviewFlags.length > 0 ? (
								<div className="space-y-2 rounded-md border border-[var(--warning)]/40 bg-[var(--warning-soft)] p-3">
									<p className="text-xs font-semibold text-[var(--warning)]">
										Review Flags ({tx.reviewFlags.length}) — check to mark
										resolved
									</p>
									<div className="space-y-1.5">
										{tx.reviewFlags.map((flag) => (
											<label
												key={`${flag.code}:${flag.message}`}
												className="flex items-start gap-2 text-xs"
											>
												<input
													type="checkbox"
													checked={resolveFlags.has(flag.code)}
													onChange={(e) => {
														setResolveFlags((prev) => {
															const next = new Set(prev);
															if (e.target.checked) next.add(flag.code);
															else next.delete(flag.code);
															return next;
														});
													}}
													className="mt-0.5"
												/>
												<span>
													<Badge tone="warning" className="mr-1.5">
														{flag.code}
													</Badge>
													<span className="text-[var(--text-primary)]">
														{flag.message}
													</span>
												</span>
											</label>
										))}
									</div>
								</div>
							) : null}

							<div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] pt-3">
								{tx.source === "manual" ? (
									<button
										type="button"
										onClick={() => setConfirmDeleteOpen(true)}
										className="inline-flex items-center gap-1.5 rounded border border-[var(--loss)]/40 px-3 py-1.5 text-xs font-medium text-[var(--loss)] hover:bg-[var(--loss-soft)]"
									>
										<Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
										Delete manual entry
									</button>
								) : (
									<span className="text-[11px] text-[var(--text-muted)]">
										Imported rows keep their raw source and won&apos;t be
										overwritten on re-import.
									</span>
								)}

								<button
									type="submit"
									disabled={saving}
									className="inline-flex items-center gap-1.5 rounded-md bg-[var(--accent)] px-4 py-1.5 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
								>
									<Save className="h-3.5 w-3.5" aria-hidden="true" />
									{saving ? "Saving…" : "Save changes"}
								</button>
							</div>
						</form>

						<div className="space-y-2 border-t border-[var(--border)] pt-4">
							<h3 className="text-xs font-semibold tracking-wide text-[var(--text-secondary)] uppercase">
								Raw Original Row
							</h3>
							<pre className="font-mono-code max-h-64 overflow-auto rounded-md border border-[var(--border)] bg-[var(--bg-subtle)] p-3 text-[11px] leading-relaxed text-[var(--text-secondary)]">
								{JSON.stringify(tx.raw, null, 2)}
							</pre>
						</div>
					</div>
				) : null}
			</Drawer>

			<ConfirmDialog
				open={confirmDeleteOpen}
				title="Delete manual transaction?"
				description="This permanently removes this manual entry from your ledger."
				confirmLabel="Delete"
				destructive
				busy={deleting}
				onConfirm={handleDelete}
				onCancel={() => setConfirmDeleteOpen(false)}
			/>
		</>
	);
}
