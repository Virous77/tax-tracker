"use client";

import type { LedgerTx, ScheduleVdaRow, Valuation, VdaReport } from "@tax/core";
import { Badge } from "@/components/ui/Badge";
import { Drawer } from "@/components/ui/Drawer";
import {
	formatInrNullable,
	formatInrRateSource,
	formatIstDate,
	formatIstDateTime,
	formatQty,
	formatTxType,
} from "@/lib/client/format";
import { useSourceLabel } from "@/lib/client/useSourceLabel";

export function TrailDrawer({
	row,
	report,
	onClose,
}: {
	row: ScheduleVdaRow | null;
	report: VdaReport | null;
	onClose: () => void;
}) {
	const sourceLabel = useSourceLabel();
	if (!row || !report) {
		return (
			<Drawer open={false} onClose={onClose} title="Audit Trail">
				{null}
			</Drawer>
		);
	}

	const ledgerIds = new Set([row.trail.disposalTxId, ...row.trail.lotTxIds]);
	const ledgerRows: LedgerTx[] = report.ledger.filter((tx) =>
		ledgerIds.has(tx.id),
	);
	const valuations: Valuation[] = report.valuations.filter((v) =>
		ledgerIds.has(v.txId),
	);

	return (
		<Drawer
			open={Boolean(row)}
			onClose={onClose}
			widthClass="max-w-2xl"
			title={`Audit Trail · ${row.asset}`}
			subtitle={`Transfer on ${formatIstDate(row.dateOfTransfer)} · ${formatQty(row.quantity)} ${row.asset}`}
		>
			<div className="space-y-6 text-sm">
				{/* 1. Schedule VDA Row */}
				<section className="space-y-2">
					<h3 className="text-xs font-semibold tracking-wide text-[var(--text-secondary)] uppercase">
						1. Schedule VDA Output Row
					</h3>
					<dl className="grid grid-cols-2 gap-3 rounded-md border border-[var(--border)] bg-[var(--bg-subtle)] p-3 text-xs sm:grid-cols-3">
						<div>
							<dt className="text-[var(--text-muted)]">Date of Acquisition</dt>
							<dd className="mt-0.5 font-medium">
								{row.dateOfAcquisition
									? formatIstDate(row.dateOfAcquisition)
									: "Unknown"}
							</dd>
						</div>
						<div>
							<dt className="text-[var(--text-muted)]">Date of Transfer</dt>
							<dd className="mt-0.5 font-medium">
								{formatIstDate(row.dateOfTransfer)}
							</dd>
						</div>
						<div>
							<dt className="text-[var(--text-muted)]">Head of Income</dt>
							<dd className="mt-0.5 font-medium">
								{row.headOfIncome === "capital_gains"
									? "Capital Gains"
									: "Business"}
							</dd>
						</div>
						<div>
							<dt className="text-[var(--text-muted)]">Cost of Acquisition</dt>
							<dd className="num mt-0.5 font-semibold">
								{formatInrNullable(row.costOfAcquisition)}
							</dd>
						</div>
						<div>
							<dt className="text-[var(--text-muted)]">
								Consideration Received
							</dt>
							<dd className="num mt-0.5 font-semibold">
								{formatInrNullable(row.considerationReceived)}
							</dd>
						</div>
						<div>
							<dt className="text-[var(--text-muted)]">Income / Loss</dt>
							<dd className="num mt-0.5 font-semibold">
								{row.loss && row.loss !== "0" && row.loss !== "0.00" ? (
									<span className="text-[var(--loss)]">
										Loss {formatInrNullable(row.loss)}
									</span>
								) : (
									<span className="text-[var(--positive)]">
										{formatInrNullable(row.income)}
									</span>
								)}
							</dd>
						</div>
					</dl>
				</section>

				{/* 2. Valuations */}
				{valuations.length > 0 ? (
					<section className="space-y-2">
						<h3 className="text-xs font-semibold tracking-wide text-[var(--text-secondary)] uppercase">
							2. Valuation &amp; FX Provenance
						</h3>
						<div className="space-y-2">
							{valuations.map((val) => (
								<div
									key={val.txId}
									className="rounded-md border border-[var(--border)] p-3 text-xs"
								>
									<div className="flex flex-wrap items-center justify-between gap-2">
										<span className="font-mono-code text-[11px] text-[var(--text-muted)]">
											Tx {val.txId.slice(0, 8)}…
											{val.txId === row.trail.disposalTxId
												? " (Disposal)"
												: " (Lot)"}
										</span>
										<span className="num font-semibold">
											{formatInrNullable(val.valueInr)}
										</span>
									</div>
									<div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[var(--text-secondary)]">
										{val.inrRateSource ? (
											<span>
												Source: {formatInrRateSource(val.inrRateSource)}
											</span>
										) : null}
										{val.fx ? (
											<span className="num">
												FX: 1 {val.fx.currency} = ₹{val.fx.rate} (
												{val.fx.source} on {val.fx.rateDate})
											</span>
										) : null}
										{val.fee ? (
											<span className="num">
												Fee INR: {formatInrNullable(val.fee.valueInr)}
											</span>
										) : null}
									</div>
									{val.marketPrice ? (
										<div className="mt-2 rounded border border-[var(--border)] bg-[var(--bg-subtle)] px-2.5 py-2 text-[11px] text-[var(--text-secondary)]">
											<span className="font-semibold text-[var(--text-primary)]">
												Market price:
											</span>{" "}
											<span className="num">
												{val.marketPrice.price} {val.marketPrice.quote}
											</span>{" "}
											· Source:{" "}
											<span className="font-medium text-[var(--text-primary)]">
												{val.marketPrice.source}
											</span>{" "}
											(
											<code className="font-mono-code">
												{val.marketPrice.sourceId}
											</code>
											) · Date: {formatIstDate(val.marketPrice.date)} · Basis:{" "}
											<span className="font-medium">
												{val.marketPrice.kind}
												{val.marketPrice.dayBasis
													? ` (${val.marketPrice.dayBasis})`
													: ""}
											</span>
										</div>
									) : null}
									{val.fee?.marketPrice ? (
										<div className="mt-1.5 rounded border border-[var(--border)] bg-[var(--bg-subtle)] px-2.5 py-2 text-[11px] text-[var(--text-secondary)]">
											<span className="font-semibold text-[var(--text-primary)]">
												Fee market price:
											</span>{" "}
											<span className="num">
												{val.fee.marketPrice.price} {val.fee.marketPrice.quote}
											</span>{" "}
											· Source:{" "}
											<span className="font-medium text-[var(--text-primary)]">
												{val.fee.marketPrice.source}
											</span>{" "}
											(
											<code className="font-mono-code">
												{val.fee.marketPrice.sourceId}
											</code>
											) · Date: {formatIstDate(val.fee.marketPrice.date)} ·
											Basis:{" "}
											<span className="font-medium">
												{val.fee.marketPrice.kind}
												{val.fee.marketPrice.dayBasis
													? ` (${val.fee.marketPrice.dayBasis})`
													: ""}
											</span>
										</div>
									) : null}
								</div>
							))}
						</div>
					</section>
				) : null}

				{/* 3. Ledger Transactions */}
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
									{tx.inrValue ? (
										<span>INR: {formatInrNullable(tx.inrValue)}</span>
									) : null}
									{tx.tdsInr ? (
										<span>TDS: {formatInrNullable(tx.tdsInr)}</span>
									) : null}
								</div>
							</div>
						))}
					</div>
				</section>

				{/* 4. Raw Source Rows */}
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
