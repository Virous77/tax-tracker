"use client";

import type { LedgerTx, UsEquityGainRow, UsEquityReport } from "@tax/core";
import { Badge } from "@/components/ui/Badge";
import { Drawer } from "@/components/ui/Drawer";
import {
	formatInrNullable,
	formatIstDate,
	formatIstDateTime,
	formatQty,
	formatTxType,
	formatUsdNullable,
	isNegativeDecimal,
} from "@/lib/client/format";
import { useSourceLabel } from "@/lib/client/useSourceLabel";

export function UsEquityTrailDrawer({
	row,
	report,
	onClose,
}: {
	row: UsEquityGainRow | null;
	report: UsEquityReport | null;
	onClose: () => void;
}) {
	const sourceLabel = useSourceLabel();
	if (!row || !report) {
		return (
			<Drawer open={false} onClose={onClose} title="US Equity Audit Trail">
				{null}
			</Drawer>
		);
	}

	const ledgerIds = new Set([row.trail.disposalTxId, ...row.trail.lotTxIds]);
	const ledgerRows: LedgerTx[] = report.ledger.filter((tx) =>
		ledgerIds.has(tx.id),
	);
	const isLoss = isNegativeDecimal(row.gainInr);

	return (
		<Drawer
			open={Boolean(row)}
			onClose={onClose}
			widthClass="max-w-2xl"
			title={`Audit Trail · ${row.asset}`}
			subtitle={`Sold ${formatIstDate(row.dateOfTransfer)} · ${formatQty(row.quantity)} ${row.asset}`}
		>
			<div className="space-y-6 text-sm">
				<section className="space-y-2">
					<h3 className="text-xs font-semibold tracking-wide text-[var(--text-secondary)] uppercase">
						1. Capital Gains Disposal Slice
					</h3>
					<dl className="grid grid-cols-2 gap-3 rounded-md border border-[var(--border)] bg-[var(--bg-subtle)] p-3 text-xs sm:grid-cols-3">
						<div>
							<dt className="text-[var(--text-muted)]">Date Acquired</dt>
							<dd className="mt-0.5 font-medium">
								{row.dateOfAcquisition
									? formatIstDate(row.dateOfAcquisition)
									: "Unknown"}
							</dd>
						</div>
						<div>
							<dt className="text-[var(--text-muted)]">Date Sold</dt>
							<dd className="mt-0.5 font-medium">
								{formatIstDate(row.dateOfTransfer)}
							</dd>
						</div>
						<div>
							<dt className="text-[var(--text-muted)]">Holding &amp; Term</dt>
							<dd className="mt-0.5 flex items-center gap-1.5 font-medium">
								<span className="num">
									{row.holdingDays !== null ? `${row.holdingDays}d` : "—"}
								</span>
								{row.term ? (
									<Badge tone={row.term === "long" ? "positive" : "neutral"}>
										{row.term === "long" ? "Long-Term" : "Short-Term"}
									</Badge>
								) : null}
							</dd>
						</div>
						<div>
							<dt className="text-[var(--text-muted)]">Cost of Acquisition</dt>
							<dd className="num mt-0.5 font-semibold">
								{formatInrNullable(row.costInr)}
							</dd>
							<dd className="num text-[11px] text-[var(--text-muted)]">
								{formatUsdNullable(row.costUsd)}
							</dd>
						</div>
						<div>
							<dt className="text-[var(--text-muted)]">Sale Consideration</dt>
							<dd className="num mt-0.5 font-semibold">
								{formatInrNullable(row.considerationInr)}
							</dd>
							<dd className="num text-[11px] text-[var(--text-muted)]">
								{formatUsdNullable(row.considerationUsd)}
							</dd>
						</div>
						<div>
							<dt className="text-[var(--text-muted)]">Gain / Loss (INR)</dt>
							<dd
								className={`num mt-0.5 font-semibold ${
									row.gainInr === null
										? ""
										: isLoss
											? "text-[var(--loss)]"
											: "text-[var(--positive)]"
								}`}
							>
								{formatInrNullable(row.gainInr)}
							</dd>
							{row.feeUsd && row.feeUsd !== "0" ? (
								<dd className="num text-[11px] text-[var(--text-muted)]">
									Fee: {formatUsdNullable(row.feeUsd)} (
									{formatInrNullable(row.feeInr)})
								</dd>
							) : null}
						</div>
					</dl>
				</section>

				<section className="space-y-2">
					<h3 className="text-xs font-semibold tracking-wide text-[var(--text-secondary)] uppercase">
						2. SBI TT Buying FX Provenance
					</h3>
					<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
						<div className="rounded-md border border-[var(--border)] p-3 text-xs">
							<p className="font-semibold text-[var(--text-primary)]">
								Acquisition Cost FX
							</p>
							{row.costFx ? (
								<p className="num mt-1 text-[var(--text-secondary)]">
									1 {row.costFx.currency} = ₹{row.costFx.rate} (
									{row.costFx.source} on {formatIstDate(row.costFx.rateDate)})
								</p>
							) : (
								<p className="mt-1 text-[var(--text-muted)]">
									Unavailable or overridden
								</p>
							)}
						</div>
						<div className="rounded-md border border-[var(--border)] p-3 text-xs">
							<p className="font-semibold text-[var(--text-primary)]">
								Disposal Proceeds FX
							</p>
							{row.considerationFx ? (
								<p className="num mt-1 text-[var(--text-secondary)]">
									1 {row.considerationFx.currency} = ₹{row.considerationFx.rate}{" "}
									({row.considerationFx.source} on{" "}
									{formatIstDate(row.considerationFx.rateDate)})
								</p>
							) : (
								<p className="mt-1 text-[var(--text-muted)]">
									Unavailable or overridden
								</p>
							)}
						</div>
					</div>
				</section>

				<section className="space-y-2">
					<h3 className="text-xs font-semibold tracking-wide text-[var(--text-secondary)] uppercase">
						3. Linked Ledger Rows ({ledgerRows.length})
					</h3>
					<div className="space-y-2">
						{ledgerRows.map((tx) => (
							<div
								key={tx.id}
								className="rounded-md border border-[var(--border)] bg-[var(--bg-canvas)] p-3 text-xs"
							>
								<div className="flex flex-wrap items-center justify-between gap-2">
									<div className="flex items-center gap-1.5">
										<Badge
											tone={
												tx.id === row.trail.disposalTxId ? "accent" : "neutral"
											}
										>
											{tx.id === row.trail.disposalTxId ? "Disposal" : "Lot"} ·{" "}
											{formatTxType(tx.type)}
										</Badge>
										<span className="font-medium">
											{sourceLabel(tx.source)}
										</span>
									</div>
									<span className="text-[var(--text-secondary)]">
										{formatIstDateTime(tx.timestamp)}
									</span>
								</div>
								<div className="num mt-2 flex flex-wrap gap-x-4 gap-y-1">
									{tx.assetIn ? (
										<span>
											In: {formatQty(tx.amountIn)} {tx.assetIn}
										</span>
									) : null}
									{tx.assetOut ? (
										<span>
											Out: {formatQty(tx.amountOut)} {tx.assetOut}
										</span>
									) : null}
									{tx.feeAmount ? (
										<span>
											Fee: {formatQty(tx.feeAmount)} {tx.feeAsset ?? "USD"}
										</span>
									) : null}
								</div>
							</div>
						))}
					</div>
				</section>

				<section className="space-y-2">
					<h3 className="text-xs font-semibold tracking-wide text-[var(--text-secondary)] uppercase">
						4. Untouched Raw Source Rows ({row.trail.rawRefs.length})
					</h3>
					<div className="space-y-2">
						{row.trail.rawRefs.map((ref) => (
							<div
								key={`${ref.txId}:${ref.source}:${ref.sourceRef}`}
								className="rounded-md border border-[var(--border)] bg-[var(--bg-subtle)] p-3 text-xs"
							>
								<p className="font-medium text-[var(--text-secondary)]">
									{sourceLabel(ref.source)} · Ref:{" "}
									<code className="font-mono-code">{ref.sourceRef}</code>
								</p>
								<pre className="font-mono-code mt-1.5 max-h-48 overflow-auto rounded border border-[var(--border)] bg-[var(--bg-surface)] p-2 text-[11px] text-[var(--text-secondary)]">
									{JSON.stringify(ref.raw, null, 2)}
								</pre>
							</div>
						))}
					</div>
				</section>
			</div>
		</Drawer>
	);
}
