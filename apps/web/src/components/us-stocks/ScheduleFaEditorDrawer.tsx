"use client";

import {
	type EquityCyPrice,
	EquityCyPriceSchema,
	type EquityMetadata,
	EquityMetadataSchema,
	type ScheduleFaRow,
	type UsEquityReport,
} from "@tax/core";
import { Save } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { Drawer } from "@/components/ui/Drawer";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { api, formatZodError, getErrorMessage } from "@/lib/client/api";
import { formatQty, isZeroDecimal } from "@/lib/client/format";

export function ScheduleFaEditorDrawer({
	row,
	calendarYear,
	taxYear,
	allMetadata,
	allPrices,
	onClose,
	onSaved,
}: {
	row: ScheduleFaRow | null;
	calendarYear: number;
	taxYear: string;
	allMetadata: EquityMetadata[];
	allPrices: EquityCyPrice[];
	onClose: () => void;
	onSaved: (result: {
		metadata: EquityMetadata[];
		prices: EquityCyPrice[];
		report: UsEquityReport;
	}) => void;
}) {
	const [entityName, setEntityName] = useState("");
	const [entityAddress, setEntityAddress] = useState("");
	const [zipCode, setZipCode] = useState("");
	const [natureOfEntity, setNatureOfEntity] = useState("");
	const [peakPriceUsd, setPeakPriceUsd] = useState("");
	const [peakDate, setPeakDate] = useState("");
	const [closingPriceUsd, setClosingPriceUsd] = useState("");
	const [source, setSource] = useState("");
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const entityNameId = useId();
	const entityAddressId = useId();
	const zipCodeId = useId();
	const natureId = useId();
	const peakPriceId = useId();
	const peakDateId = useId();
	const closingPriceId = useId();
	const sourceId = useId();

	useEffect(() => {
		if (!row) return;
		const existingMeta = allMetadata.find((m) => m.symbol === row.asset);
		const existingPrice = allPrices.find(
			(p) => p.symbol === row.asset && p.calendarYear === calendarYear,
		);
		setEntityName(existingMeta?.entityName ?? row.entityName ?? row.asset);
		setEntityAddress(existingMeta?.entityAddress ?? row.entityAddress ?? "");
		setZipCode(existingMeta?.zipCode ?? row.zipCode ?? "");
		setNatureOfEntity(
			existingMeta?.natureOfEntity ?? row.natureOfEntity ?? "Listed Company",
		);
		setPeakPriceUsd(existingPrice?.peakPriceUsd ?? row.peakPriceUsd ?? "");
		setPeakDate(existingPrice?.peakDate ?? row.peakDate ?? "");
		setClosingPriceUsd(
			existingPrice?.closingPriceUsd ?? row.closingPriceUsd ?? "",
		);
		setSource(existingPrice?.source ?? "");
		setError(null);
	}, [row, calendarYear, allMetadata, allPrices]);

	async function handleSubmit(e: React.FormEvent) {
		if (!row) return;
		e.preventDefault();
		setSaving(true);
		setError(null);
		try {
			const trimmedName = entityName.trim();
			const nextMetaInput: EquityMetadata = {
				symbol: row.asset,
				entityName: trimmedName,
				...(entityAddress.trim()
					? { entityAddress: entityAddress.trim() }
					: {}),
				...(zipCode.trim() ? { zipCode: zipCode.trim() } : {}),
				...(natureOfEntity.trim()
					? { natureOfEntity: natureOfEntity.trim() }
					: {}),
				countryName: row.countryName,
				countryCode: row.countryCode,
			};
			const metaParsed = EquityMetadataSchema.safeParse(nextMetaInput);
			if (!metaParsed.success) {
				throw formatZodError(metaParsed.error);
			}

			const trimmedPeak = peakPriceUsd.trim();
			const trimmedPeakDate = peakDate.trim();
			const trimmedClose = closingPriceUsd.trim();
			const trimmedSource = source.trim();

			if (trimmedPeakDate && !trimmedPeak) {
				setError("Enter a Peak Price (USD) to go with the peak date.");
				return;
			}

			const nextPriceInput: EquityCyPrice = {
				calendarYear,
				symbol: row.asset,
				...(trimmedPeak ? { peakPriceUsd: trimmedPeak } : {}),
				...(trimmedPeakDate ? { peakDate: trimmedPeakDate } : {}),
				...(trimmedClose ? { closingPriceUsd: trimmedClose } : {}),
				...(trimmedSource ? { source: trimmedSource } : {}),
			};
			const priceParsed = EquityCyPriceSchema.safeParse(nextPriceInput);
			if (!priceParsed.success) {
				throw formatZodError(priceParsed.error);
			}

			const mergedMetadata = [
				...allMetadata.filter((m) => m.symbol !== row.asset),
				metaParsed.data,
			];

			const hasAnyPriceField = Boolean(
				trimmedPeak || trimmedPeakDate || trimmedClose || trimmedSource,
			);
			const mergedPrices = hasAnyPriceField
				? [
						...allPrices.filter(
							(p) =>
								!(p.symbol === row.asset && p.calendarYear === calendarYear),
						),
						priceParsed.data,
					]
				: allPrices.filter(
						(p) => !(p.symbol === row.asset && p.calendarYear === calendarYear),
					);

			const [savedMeta, savedPrices] = await Promise.all([
				api.putEquityMetadata(mergedMetadata),
				api.putEquityPrices(calendarYear, mergedPrices),
			]);
			const updatedReport = await api.computeUsEquityReport(taxYear);
			onSaved({
				metadata: savedMeta,
				prices: savedPrices,
				report: updatedReport,
			});
		} catch (err) {
			setError(getErrorMessage(err));
		} finally {
			setSaving(false);
		}
	}

	const exitedByYearEnd = row ? isZeroDecimal(row.closingQty) : false;

	return (
		<Drawer
			open={Boolean(row)}
			onClose={onClose}
			title={row ? `Schedule FA · ${row.asset} (CY ${calendarYear})` : "Edit"}
			subtitle={
				row
					? `Max held: ${formatQty(row.maxQtyHeld)} · Dec 31 closing qty: ${formatQty(row.closingQty)}`
					: undefined
			}
		>
			{row ? (
				<form onSubmit={handleSubmit} className="space-y-5">
					{error ? <ErrorBanner message={error} /> : null}

					<section className="space-y-3">
						<h3 className="text-xs font-semibold tracking-wide text-[var(--text-secondary)] uppercase">
							Entity Details (Table A3)
						</h3>
						<div>
							<label
								htmlFor={entityNameId}
								className="block text-xs font-medium text-[var(--text-secondary)]"
							>
								Entity Name *
							</label>
							<input
								id={entityNameId}
								type="text"
								required
								value={entityName}
								onChange={(e) => setEntityName(e.target.value)}
								placeholder="e.g. APPLE INC"
								className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--bg-canvas)] px-2.5 py-1.5 text-sm"
							/>
						</div>

						<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
							<div>
								<label
									htmlFor={natureId}
									className="block text-xs font-medium text-[var(--text-secondary)]"
								>
									Nature of Entity
								</label>
								<input
									id={natureId}
									type="text"
									value={natureOfEntity}
									onChange={(e) => setNatureOfEntity(e.target.value)}
									placeholder="Listed Company"
									className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--bg-canvas)] px-2.5 py-1.5 text-sm"
								/>
							</div>
							<div>
								<label
									htmlFor={zipCodeId}
									className="block text-xs font-medium text-[var(--text-secondary)]"
								>
									ZIP / Postal Code
								</label>
								<input
									id={zipCodeId}
									type="text"
									value={zipCode}
									onChange={(e) => setZipCode(e.target.value)}
									placeholder="e.g. 95014"
									className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--bg-canvas)] px-2.5 py-1.5 text-sm"
								/>
							</div>
						</div>

						<div>
							<label
								htmlFor={entityAddressId}
								className="block text-xs font-medium text-[var(--text-secondary)]"
							>
								Entity Address
							</label>
							<input
								id={entityAddressId}
								type="text"
								value={entityAddress}
								onChange={(e) => setEntityAddress(e.target.value)}
								placeholder="e.g. One Apple Park Way, Cupertino, CA"
								className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--bg-canvas)] px-2.5 py-1.5 text-sm"
							/>
						</div>
					</section>

					<section className="space-y-3 border-t border-[var(--border)] pt-4">
						<div>
							<h3 className="text-xs font-semibold tracking-wide text-[var(--text-secondary)] uppercase">
								CY {calendarYear} Market Prices (USD)
							</h3>
							<p className="mt-0.5 text-[11px] text-[var(--text-muted)]">
								Required by ITR Schedule FA Table A3. Leave blank if you do not
								have the price yet — values are never guessed.
							</p>
						</div>

						<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
							<div>
								<label
									htmlFor={peakPriceId}
									className="block text-xs font-medium text-[var(--text-secondary)]"
								>
									Peak Price (USD)
								</label>
								<input
									id={peakPriceId}
									type="text"
									inputMode="decimal"
									value={peakPriceUsd}
									onChange={(e) => setPeakPriceUsd(e.target.value)}
									placeholder="e.g. 259.02"
									className="num mt-1 w-full rounded border border-[var(--border)] bg-[var(--bg-canvas)] px-2.5 py-1.5 text-sm"
								/>
							</div>
							<div>
								<label
									htmlFor={peakDateId}
									className="block text-xs font-medium text-[var(--text-secondary)]"
								>
									Peak Date (in {calendarYear})
								</label>
								<input
									id={peakDateId}
									type="date"
									min={`${calendarYear}-01-01`}
									max={`${calendarYear}-12-31`}
									value={peakDate}
									onChange={(e) => setPeakDate(e.target.value)}
									className="num mt-1 w-full rounded border border-[var(--border)] bg-[var(--bg-canvas)] px-2.5 py-1.5 text-sm"
								/>
							</div>
						</div>

						<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
							<div>
								<label
									htmlFor={closingPriceId}
									className="block text-xs font-medium text-[var(--text-secondary)]"
								>
									Dec 31 Closing Price (USD)
								</label>
								<input
									id={closingPriceId}
									type="text"
									inputMode="decimal"
									value={closingPriceUsd}
									onChange={(e) => setClosingPriceUsd(e.target.value)}
									placeholder={
										exitedByYearEnd ? "Not needed (0 shares)" : "e.g. 250.42"
									}
									className="num mt-1 w-full rounded border border-[var(--border)] bg-[var(--bg-canvas)] px-2.5 py-1.5 text-sm"
								/>
								{exitedByYearEnd ? (
									<p className="mt-1 text-[11px] text-[var(--text-muted)]">
										Closing quantity is 0 on Dec 31 — closing price is not
										needed.
									</p>
								) : null}
							</div>
							<div>
								<label
									htmlFor={sourceId}
									className="block text-xs font-medium text-[var(--text-secondary)]"
								>
									Price Source (optional)
								</label>
								<input
									id={sourceId}
									type="text"
									value={source}
									onChange={(e) => setSource(e.target.value)}
									placeholder="e.g. Broker statement / Yahoo"
									className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--bg-canvas)] px-2.5 py-1.5 text-sm"
								/>
							</div>
						</div>
					</section>

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
							className="shrink-0 whitespace-nowrap inline-flex items-center gap-1.5 rounded-md bg-[var(--accent)] px-4 py-1.5 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
						>
							<Save className="h-4 w-4" aria-hidden="true" />
							{saving ? "Saving & recomputing…" : "Save & Recompute"}
						</button>
					</div>
				</form>
			) : null}
		</Drawer>
	);
}
