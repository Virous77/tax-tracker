"use client";

import {
	type IncomeKind,
	IncomeKindSchema,
	type LedgerTx,
	ManualVenueSchema,
	type ReviewCode,
	type TxType,
	TxTypeSchema,
} from "@tax/core";
import { ExternalLink, Info, Save, Trash2 } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { InrAmountField } from "@/components/transactions/InrAmountField";
import { Badge } from "@/components/ui/Badge";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Drawer } from "@/components/ui/Drawer";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { Select, SelectItem } from "@/components/ui/Select";
import {
	api,
	getErrorMessage,
	type ManualVenue,
	ValidationError,
} from "@/lib/client/api";
import { resolveTxExplorer } from "@/lib/client/chains";
import {
	formatAssetClass,
	formatIncomeKind,
	formatInrNullable,
	formatInrRateSource,
	formatIstDateTime,
	formatManualVenueLabel,
	formatQty,
	formatTxTitle,
	formatTxType,
} from "@/lib/client/format";
import {
	type InrEntryMode,
	inrTotalFromEntry,
	pricedLeg,
} from "@/lib/client/inr-cost";
import { groupReviewFlags } from "@/lib/client/review-codes";
import { usePriceReference } from "@/lib/client/usePriceReference";
import { useSourceLabel } from "@/lib/client/useSourceLabel";

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
	const sourceLabel = useSourceLabel();
	const [type, setType] = useState<TxType>("buy");
	const [incomeKind, setIncomeKind] = useState<IncomeKind | "">("");
	const [venue, setVenue] = useState<ManualVenue>("manual");
	const [inrValue, setInrValue] = useState("");
	const [inrMode, setInrMode] = useState<InrEntryMode>("total");
	const [userNote, setUserNote] = useState("");
	const [resolveFlags, setResolveFlags] = useState<Set<ReviewCode>>(new Set());
	const [saving, setSaving] = useState(false);
	const [deleting, setDeleting] = useState(false);
	const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [inrError, setInrError] = useState<string | null>(null);

	const priced = tx ? pricedLeg(tx, type) : null;
	const priceReference = usePriceReference(priced?.asset ?? "", {
		enabled: tx !== null && priced !== null,
		...(tx ? { excludeTxId: tx.id, at: tx.timestamp } : {}),
	});

	const typeId = useId();
	const incomeKindId = useId();
	const venueId = useId();
	const inrId = useId();
	const noteId = useId();
	const flagsId = useId();

	useEffect(() => {
		if (!tx) return;
		setType(tx.type);
		setIncomeKind(tx.incomeKind ?? "");
		setVenue(tx.venue ?? "manual");
		setInrValue(tx.inrValue ?? "");
		setInrMode("total");
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
				venue?: ManualVenue;
			} = {};
			if (type !== tx.type) patch.type = type;
			if (type === "income" && incomeKind && incomeKind !== tx.incomeKind) {
				patch.incomeKind = incomeKind;
			}
			if (tx.source === "manual" && venue !== (tx.venue ?? "manual")) {
				patch.venue = venue;
			}
			const typedInr = inrValue.trim();
			const trimmedInr =
				inrMode === "perUnit" && typedInr !== ""
					? inrTotalFromEntry(inrMode, typedInr, priced?.quantity)
					: typedInr;
			if (trimmedInr === null) {
				const msg = "Enter the price per unit as a number, e.g. 95.";
				setInrError(msg);
				setError(msg);
				return;
			}
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
				title={tx ? formatTxTitle(tx) : "Transaction"}
				subtitle={
					tx
						? `${formatIstDateTime(tx.timestamp)} · ${sourceLabel(tx.source)} · Ref: ${tx.sourceRef}`
						: undefined
				}
			>
				{tx ? (
					<div className="space-y-5">
						{error ? <ErrorBanner message={error} /> : null}

						{(tx as LedgerTx & { supersededBy?: string | null })
							.supersededBy ? (
							<div className="flex items-start gap-2.5 rounded-md border border-[var(--border-strong)] bg-[var(--bg-subtle)] p-3 text-xs text-[var(--text-primary)]">
								<Info
									className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent-text)]"
									aria-hidden="true"
								/>
								<div className="space-y-1">
									<div className="flex items-center gap-2">
										<Badge tone="neutral">Replaced</Badge>
									</div>
									<p className="text-[var(--text-secondary)]">
										A more detailed export (e.g. Trade History) replaced this
										row. It is kept for the record but not used in the tax
										calculation. Deleting that import restores it.
									</p>
								</div>
							</div>
						) : null}

						<dl className="grid grid-cols-2 gap-3 rounded-md border border-[var(--border)] bg-[var(--bg-subtle)] p-3 text-xs">
							<div>
								<dt className="text-[var(--text-muted)]">Asset Class</dt>
								<dd className="mt-0.5 font-medium">
									{formatAssetClass(tx.assetClass)}
								</dd>
							</div>
							{tx.entityName ? (
								<div>
									<dt className="text-[var(--text-muted)]">Entity Name</dt>
									<dd className="mt-0.5 font-medium">{tx.entityName}</dd>
								</div>
							) : null}
							{tx.dividendAsset ? (
								<div>
									<dt className="text-[var(--text-muted)]">Stock Ticker</dt>
									<dd className="mt-0.5 font-semibold">{tx.dividendAsset}</dd>
								</div>
							) : null}
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
							{tx.withholdingTaxAmount ? (
								<div>
									<dt className="text-[var(--text-muted)]">Withholding Tax</dt>
									<dd className="num mt-0.5 font-semibold">
										{formatQty(tx.withholdingTaxAmount)}{" "}
										{tx.withholdingTaxAsset ?? "USD"}
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
							{(() => {
								const venue = (tx as LedgerTx & { venue?: string }).venue;
								return tx.source === "manual" && venue ? (
									<div>
										<dt className="text-[var(--text-muted)]">Counts toward</dt>
										<dd className="mt-0.5 font-medium">
											{formatManualVenueLabel(venue)}
										</dd>
									</div>
								) : null;
							})()}
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
									<Select
										id={typeId}
										value={type}
										onValueChange={(value) => setType(value as TxType)}
										className="mt-1 w-full"
									>
										{TxTypeSchema.options.map((opt) => (
											<SelectItem key={opt} value={opt}>
												{formatTxType(opt)}
											</SelectItem>
										))}
									</Select>
								</div>

								{type === "income" ? (
									<div>
										<label
											htmlFor={incomeKindId}
											className="block text-xs font-medium text-[var(--text-secondary)]"
										>
											Income kind
										</label>
										<Select
											id={incomeKindId}
											value={incomeKind}
											onValueChange={(value) =>
												setIncomeKind(value as IncomeKind | "")
											}
											className="mt-1 w-full"
										>
											<SelectItem value="">Select kind…</SelectItem>
											{IncomeKindSchema.options.map((k) => (
												<SelectItem key={k} value={k}>
													{formatIncomeKind(k)}
												</SelectItem>
											))}
										</Select>
									</div>
								) : null}

								{tx.source === "manual" ? (
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
											onValueChange={(value) => setVenue(value as ManualVenue)}
											className="mt-1 w-full"
										>
											{ManualVenueSchema.options.map((opt) => (
												<SelectItem key={opt} value={opt}>
													{formatManualVenueLabel(opt)}
												</SelectItem>
											))}
										</Select>
									</div>
								) : null}

								{tx.assetClass === "us_equity" ? (
									<div className="sm:col-span-2">
										<p className="rounded border border-[var(--border)] bg-[var(--bg-subtle)] px-2.5 py-2 text-[11px] text-[var(--text-secondary)]">
											INR values for US stock entries are calculated
											automatically from USD using the SBI TT buying rate per
											Settings.
										</p>
									</div>
								) : (
									<InrAmountField
										id={inrId}
										totalLabel="Total INR value (₹)"
										perUnitLabel={`INR value per ${priced?.asset ?? "unit"} (₹)`}
										perUnitAvailable={priced !== null}
										mode={inrMode}
										onModeChange={(next) => {
											setInrMode(next);
											setInrError(null);
										}}
										text={inrValue}
										onTextChange={(next) => {
											setInrValue(next);
											setInrError(null);
										}}
										quantity={priced?.quantity}
										asset={priced?.asset ?? ""}
										reference={priceReference}
										error={inrError}
										placeholder={
											inrMode === "total" ? "e.g. 250000.00" : "e.g. 95"
										}
									/>
								)}
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

							{tx.reviewFlags.length > 0
								? (() => {
										const groupedFlags = groupReviewFlags(tx.reviewFlags);
										return (
											<div className="space-y-2 rounded-md border border-[var(--warning)]/40 bg-[var(--warning-soft)] p-3">
												<p className="text-xs font-semibold text-[var(--warning)]">
													Review Flags ({groupedFlags.length}) — check to mark
													resolved
												</p>
												<div className="space-y-2">
													{groupedFlags.map((group) => {
														const inputId = `${flagsId}-${group.code}`;
														return (
															<div
																key={group.code}
																className="flex items-start gap-2 text-xs"
															>
																<input
																	id={inputId}
																	type="checkbox"
																	checked={resolveFlags.has(group.code)}
																	onChange={(e) => {
																		setResolveFlags((prev) => {
																			const next = new Set(prev);
																			if (e.target.checked)
																				next.add(group.code);
																			else next.delete(group.code);
																			return next;
																		});
																	}}
																	className="mt-0.5"
																/>
																<div className="min-w-0 flex-1">
																	<label
																		htmlFor={inputId}
																		className="cursor-pointer"
																	>
																		<Badge tone="warning" className="mr-1.5">
																			{group.code}
																		</Badge>
																		{group.messages.length === 1 ? (
																			<span className="text-[var(--text-primary)]">
																				{group.messages[0]}
																			</span>
																		) : group.messages.length > 1 ? (
																			<span className="text-[var(--text-secondary)]">
																				{group.messages.length} reasons
																			</span>
																		) : null}
																	</label>
																	{group.messages.length > 1 ? (
																		<ul className="mt-1 list-disc space-y-0.5 pl-4 text-[var(--text-primary)]">
																			{group.messages.map((msg) => (
																				<li key={msg}>{msg}</li>
																			))}
																		</ul>
																	) : null}
																</div>
															</div>
														);
													})}
												</div>
											</div>
										);
									})()
								: null}

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
