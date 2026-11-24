"use client";

import { TimezoneSchema } from "@tax/core/api";
import {
	AlertTriangle,
	ArrowRight,
	CheckCircle2,
	ChevronDown,
	ChevronUp,
	FileSpreadsheet,
	Info,
	Lock,
	Upload,
	XCircle,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { type DragEvent, useEffect, useId, useRef, useState } from "react";
import { SampleDataPrompt } from "@/components/demo/SampleDataPrompt";
import { RecipeWizard } from "@/components/import/RecipeWizard";
import { SourceName } from "@/components/import/SourceName";
import { Badge } from "@/components/ui/Badge";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { PageHeader } from "@/components/ui/PageHeader";
import {
	ApiError,
	api,
	getErrorMessage,
	type ImportDetail,
	type ImportSummary,
} from "@/lib/client/api";
import {
	formatIstDate,
	formatIstDateTime,
	formatQty,
	formatReportKindLabel,
	formatSourceLabel,
	formatTimezoneSourceLabel,
	pluralise,
} from "@/lib/client/format";
import { REVIEW_CODE_INFO } from "@/lib/client/review-codes";

type SourceChoice = "auto" | "binance" | "coindcx" | "vested" | "generic";
type TzMode = "IST" | "UTC" | "custom";

const MAX_BYTES = 25 * 1024 * 1024;

function isKnownUsEquityImport(result: ImportSummary | ImportDetail): boolean {
	const assetClass = (result as { assetClass?: string }).assetClass;
	return (
		result.source === "vested" ||
		assetClass === "us_equity" ||
		Boolean(result.recipeId?.startsWith("us-stocks-"))
	);
}

function friendlyImportError(err: unknown): {
	message: string;
	askPassword: boolean;
} {
	if (err instanceof ApiError) {
		switch (err.code) {
			case "pdf_password_required":
				return {
					message:
						"This PDF is password-protected. Enter the PDF password below and upload again.",
					askPassword: true,
				};
			case "pdf_wrong_password":
				return {
					message:
						"That PDF password didn't open the file. Check the 8-digit password and try again.",
					askPassword: true,
				};
			case "pdf_no_text":
				return {
					message:
						"This PDF has no selectable text layer (it may be a scanned image). Download and upload the exchange's CSV or XLSX export instead.",
					askPassword: false,
				};
			case "pdf_unknown_layout":
				return {
					message:
						"This PDF statement layout isn't recognized yet. Use the venue's CSV or XLSX export instead.",
					askPassword: false,
				};
			case "pdf_unsupported":
				if (err.message.toLowerCase().includes("form 16a")) {
					return {
						message:
							"TDS certificates can't be imported yet. Keep this CoinDCX Form 16A for your tax records.",
						askPassword: false,
					};
				}
				return {
					message:
						"This PDF couldn't be imported. Download a fresh statement or use the CSV or XLSX export.",
					askPassword: false,
				};
			case "pdf_too_large":
				return {
					message:
						"This PDF exceeds the size or extraction limit (maximum 25 MB). Upload a smaller statement or use CSV or XLSX.",
					askPassword: false,
				};
		}
	}
	return { message: getErrorMessage(err), askPassword: false };
}

function getOptionalCount(
	result: ImportSummary | ImportDetail,
	key: "rowsSuperseded" | "rowsAmbiguous",
): number | null {
	const rec = result as Record<string, unknown>;
	return typeof rec[key] === "number" ? (rec[key] as number) : null;
}

export function ImportClient() {
	const searchParams = useSearchParams();
	const resumeImportId = searchParams.get("importId");

	const [file, setFile] = useState<File | null>(null);
	const [dragging, setDragging] = useState(false);
	const [source, setSource] = useState<SourceChoice>("auto");
	const [tzMode, setTzMode] = useState<TzMode>("IST");
	const [customOffset, setCustomOffset] = useState("+05:30");
	const [tzError, setTzError] = useState<string | null>(null);

	const [pdfNeedsPassword, setPdfNeedsPassword] = useState(false);
	const [pdfPassword, setPdfPassword] = useState("");
	const pdfPasswordInputRef = useRef<HTMLInputElement>(null);

	const [uploading, setUploading] = useState(false);
	const [loadingResume, setLoadingResume] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [result, setResult] = useState<ImportSummary | ImportDetail | null>(
		null,
	);
	const [detectedUsEquityRecipe, setDetectedUsEquityRecipe] = useState(false);
	const [skippedExpanded, setSkippedExpanded] = useState(false);

	const fileInputId = useId();
	const customOffsetId = useId();
	const pdfPasswordId = useId();

	useEffect(() => {
		if (pdfNeedsPassword) {
			pdfPasswordInputRef.current?.focus();
		}
	}, [pdfNeedsPassword]);

	useEffect(() => {
		if (!resumeImportId) return;
		let cancelled = false;
		setLoadingResume(true);
		setError(null);
		api
			.getImport(resumeImportId)
			.then((detail) => {
				if (!cancelled) setResult(detail);
			})
			.catch((err) => {
				if (!cancelled) setError(getErrorMessage(err));
			})
			.finally(() => {
				if (!cancelled) setLoadingResume(false);
			});
		return () => {
			cancelled = true;
		};
	}, [resumeImportId]);

	useEffect(() => {
		setDetectedUsEquityRecipe(false);
		if (result?.status !== "imported") {
			return;
		}
		if (isKnownUsEquityImport(result)) {
			return;
		}
		if (
			!result.recipeId &&
			!result.source.startsWith("csv:") &&
			result.source !== "generic"
		) {
			return;
		}
		let cancelled = false;
		Promise.all([
			result.recipeId
				? api
						.listRecipes()
						.then((recipes) =>
							recipes.some(
								(r) => r.id === result.recipeId && r.assetClass === "us_equity",
							),
						)
						.catch(() => false)
				: Promise.resolve(false),
			result.rowsInserted > 0 || result.rowsDuplicate > 0
				? api
						.listTransactions({
							source: result.source,
							assetClass: "us_equity",
							page: 1,
							pageSize: 1,
						})
						.then((page) => page.total > 0)
						.catch(() => false)
				: Promise.resolve(false),
		]).then(([fromRecipe, fromTx]) => {
			if (!cancelled && (fromRecipe || fromTx)) {
				setDetectedUsEquityRecipe(true);
			}
		});
		return () => {
			cancelled = true;
		};
	}, [result]);

	function resolveTimezone(): ImportSummary["timezone"] | null {
		if (tzMode === "IST" || tzMode === "UTC") return tzMode;
		const trimmed = customOffset.trim();
		const parsed = TimezoneSchema.safeParse(trimmed);
		if (!parsed.success || parsed.data === "IST" || parsed.data === "UTC") {
			setTzError(
				"Enter a fixed offset as ±HH:MM within ±14:00 (for example +05:30 or -04:00).",
			);
			return null;
		}
		setTzError(null);
		return parsed.data;
	}

	function handleFilePick(picked: File | null) {
		setError(null);
		setPdfNeedsPassword(false);
		setPdfPassword("");
		if (!picked) {
			setFile(null);
			return;
		}
		if (picked.size > MAX_BYTES) {
			setError("File exceeds the 25 MB limit.");
			setFile(null);
			return;
		}
		setFile(picked);
		const name = picked.name.toLowerCase();
		if (source === "auto" && tzMode !== "custom") {
			if (name.includes("binance") || name.includes("vested")) setTzMode("UTC");
			else if (name.includes("coindcx")) setTzMode("IST");
		}
	}

	function onDrop(e: DragEvent<HTMLLabelElement>) {
		e.preventDefault();
		setDragging(false);
		const dropped = e.dataTransfer.files[0] ?? null;
		handleFilePick(dropped);
	}

	async function handleUpload(e: React.FormEvent) {
		e.preventDefault();
		if (!file) {
			setError("Choose a CSV, XLSX, or PDF export file first.");
			return;
		}
		const timezone = resolveTimezone();
		if (!timezone) return;

		if (pdfNeedsPassword && !pdfPassword.trim()) {
			setError("Enter the PDF password to continue.");
			pdfPasswordInputRef.current?.focus();
			return;
		}

		const passwordToSend = pdfPassword || undefined;
		// Clear password from state immediately when submitting
		setPdfPassword("");
		setUploading(true);
		setError(null);
		try {
			const summary = await api.createImport({
				file,
				source,
				timezone,
				...(passwordToSend ? { pdfPassword: passwordToSend } : {}),
			});
			setPdfNeedsPassword(false);
			setSkippedExpanded(false);
			if (summary.status !== "pending_recipe") {
				const detail = await api.getImport(summary.id).catch(() => summary);
				setResult(detail);
			} else {
				setResult(summary);
			}
		} catch (err) {
			const friendly = friendlyImportError(err);
			setError(friendly.message);
			if (friendly.askPassword) {
				setPdfNeedsPassword(true);
				setTimeout(() => pdfPasswordInputRef.current?.focus(), 0);
			}
		} finally {
			setPdfPassword("");
			setUploading(false);
		}
	}

	async function handleWizardConfirmed(summary: ImportSummary) {
		const detail = await api.getImport(summary.id).catch(() => summary);
		setResult(detail);
	}

	function resetAll() {
		setFile(null);
		setResult(null);
		setError(null);
		setTzError(null);
		setPdfNeedsPassword(false);
		setPdfPassword("");
		setSkippedExpanded(false);
	}

	if (loadingResume) {
		return (
			<div className="h-48 animate-pulse rounded-lg border border-[var(--border)] bg-[var(--bg-surface)]" />
		);
	}

	if (result?.status === "pending_recipe") {
		return (
			<div className="space-y-4">
				<PageHeader
					title="Import File"
					description="Configure column mapping for your generic CSV / XLSX export."
				/>
				<RecipeWizard
					importItem={result}
					onConfirmed={handleWizardConfirmed}
					onCancel={resetAll}
				/>
			</div>
		);
	}

	const rowErrors = result && "rowErrors" in result ? result.rowErrors : [];
	const balanceSnapshot =
		result && "balanceSnapshot" in result ? result.balanceSnapshot : undefined;
	const detectedLabel = result
		? formatReportKindLabel(result.reportKind, result.reportKindLabel)
		: null;
	const rowsSuperseded = result
		? getOptionalCount(result, "rowsSuperseded")
		: null;
	const rowsAmbiguous = result
		? getOptionalCount(result, "rowsAmbiguous")
		: null;
	const noRowsImported =
		result !== null &&
		result.status === "imported" &&
		!balanceSnapshot &&
		result.rowsInserted === 0 &&
		result.rowsDuplicate === 0;
	const hasSnapshotWallet = Boolean(
		balanceSnapshot?.rows.some((r) => Boolean(r.wallet)),
	);
	const isUsEquityImport =
		result !== null &&
		result.status === "imported" &&
		(isKnownUsEquityImport(result) || detectedUsEquityRecipe);

	return (
		<div className="space-y-6">
			<PageHeader
				title="Import"
				description="Upload CSV or XLSX exports (Binance, CoinDCX, Vested, and other exchanges or US stock brokers like Schwab and IBKR via recipes) or Binance and Vested PDF account statements. Duplicate rows are safely skipped."
				actions={
					<Link
						href="/imports"
						className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded border border-[var(--border)] bg-[var(--bg-surface)] px-3 text-xs font-medium whitespace-nowrap hover:bg-[var(--bg-hover)]"
					>
						Import history
						<ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
					</Link>
				}
			/>

			{error ? <ErrorBanner message={error} /> : null}

			{result ? null : <SampleDataPrompt />}

			{result ? (
				<section
					aria-live="polite"
					className="space-y-4 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-5"
				>
					<div className="flex flex-wrap items-start justify-between gap-3">
						<div className="flex items-start gap-2.5">
							{noRowsImported ? (
								<AlertTriangle
									className="mt-0.5 h-5 w-5 shrink-0 text-[var(--warning)]"
									aria-hidden="true"
								/>
							) : result.status === "imported" ? (
								<CheckCircle2
									className="mt-0.5 h-5 w-5 shrink-0 text-[var(--positive)]"
									aria-hidden="true"
								/>
							) : (
								<XCircle
									className="mt-0.5 h-5 w-5 shrink-0 text-[var(--loss)]"
									aria-hidden="true"
								/>
							)}
							<div className="space-y-0.5">
								<h2 className="text-base font-semibold">
									{result.fileName} —{" "}
									{noRowsImported
										? "No rows imported"
										: result.status === "imported"
											? "Import complete"
											: "Import failed"}
								</h2>
								{detectedLabel ? (
									<p className="text-xs font-medium text-[var(--text-primary)]">
										Detected: {detectedLabel}
									</p>
								) : null}
								<p className="text-xs text-[var(--text-secondary)]">
									Source: <SourceName imp={result} /> · Time zone:{" "}
									<span className="font-medium text-[var(--text-primary)]">
										{result.detectedTimezone ?? result.timezone}
									</span>{" "}
									(
									{formatTimezoneSourceLabel(
										result.timezoneSource,
										result.timezoneOrigin,
									)}
									)
								</p>
							</div>
						</div>
						<Badge
							tone={
								noRowsImported
									? "warning"
									: result.status === "imported"
										? "positive"
										: "loss"
							}
						>
							{result.status}
						</Badge>
					</div>

					{noRowsImported ? (
						<p className="rounded border border-[var(--warning)]/40 bg-[var(--warning-soft)] px-3 py-2 text-sm text-[var(--text-primary)]">
							Nothing was added to your ledger.{" "}
							{result.rowsError > 0 ? (
								<>
									All {result.rowsError} {pluralise(result.rowsError, "row")}{" "}
									had errors — see the{" "}
									<a href="#row-errors" className="font-medium underline">
										row errors
									</a>{" "}
									below, fix the file or the column mapping, and import again.
								</>
							) : (
								"The file had no rows this importer could use."
							)}
						</p>
					) : null}

					{result.error ? (
						<p className="rounded border border-[var(--loss)]/40 bg-[var(--loss-soft)] px-3 py-2 text-sm text-[var(--loss)]">
							{result.error}
						</p>
					) : null}

					{/* Calm notice banners for import-level warnings */}
					{result.warnings.length > 0 ? (
						<div className="space-y-2">
							{result.warnings.map((w) => (
								<div
									key={`${w.code}:${w.txId ?? ""}:${w.message}`}
									className="flex items-start gap-2.5 rounded-md border border-[var(--border-strong)] bg-[var(--bg-subtle)] px-3.5 py-2.5 text-xs text-[var(--text-primary)]"
								>
									<Info
										className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent-text)]"
										aria-hidden="true"
									/>
									<div className="space-y-0.5">
										<p className="font-medium">{w.message}</p>
										<p className="text-[11px] text-[var(--text-muted)]">
											{w.code === "parse_warning"
												? "Import note"
												: (REVIEW_CODE_INFO[w.code]?.title ?? "Import note")}
										</p>
									</div>
								</div>
							))}
						</div>
					) : null}

					{/* PDF Statement Balance Snapshot vs Transaction Summary */}
					{balanceSnapshot ? (
						<div className="space-y-3 rounded-md border border-[var(--border)] bg-[var(--bg-subtle)] p-4">
							<div className="flex flex-wrap items-center justify-between gap-2">
								<div>
									<h3 className="text-sm font-semibold">
										Balance Snapshot — {formatIstDate(balanceSnapshot.asOf)}
									</h3>
									<p className="text-xs text-[var(--text-secondary)]">
										{formatSourceLabel(balanceSnapshot.venue)} · As of{" "}
										{balanceSnapshot.asOf} ({balanceSnapshot.timezone}) ·{" "}
										{balanceSnapshot.rows.length} asset{" "}
										{balanceSnapshot.rows.length === 1 ? "row" : "rows"} (stored
										as a balance statement, not ledger transactions)
									</p>
								</div>
								<Link
									href="/report#statements"
									className="inline-flex items-center gap-1 rounded border border-[var(--accent)]/40 bg-[var(--bg-surface)] px-3 py-1.5 text-xs font-medium text-[var(--accent-text)] hover:bg-[var(--accent-soft)]"
								>
									Compare with computed balances
									<ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
								</Link>
							</div>

							{balanceSnapshot.rows.length > 0 ? (
								<div className="min-w-0 overflow-x-auto rounded border border-[var(--border)] bg-[var(--bg-surface)]">
									<table className="w-full border-collapse text-left text-xs">
										<thead className="border-b border-[var(--border)] bg-[var(--bg-subtle)] text-[var(--text-secondary)]">
											<tr>
												<th className="px-3 py-2 font-medium whitespace-nowrap">
													Asset
												</th>
												{hasSnapshotWallet ? (
													<th className="px-3 py-2 font-medium whitespace-nowrap">
														Wallet
													</th>
												) : null}
												<th className="num-right px-3 py-2 font-medium whitespace-nowrap">
													Statement balance
												</th>
											</tr>
										</thead>
										<tbody>
											{balanceSnapshot.rows.map((row) => (
												<tr
													key={`${row.asset}:${row.wallet ?? ""}:${row.amount}`}
													className="border-b border-[var(--border)] last:border-b-0"
												>
													<td className="px-3 py-2 font-semibold whitespace-nowrap">
														{row.asset}
													</td>
													{hasSnapshotWallet ? (
														<td className="px-3 py-2 text-[var(--text-secondary)] whitespace-nowrap">
															{row.wallet ?? "—"}
														</td>
													) : null}
													<td className="num-right px-3 py-2 font-medium whitespace-nowrap">
														{formatQty(row.amount)}
													</td>
												</tr>
											))}
										</tbody>
									</table>
								</div>
							) : (
								<p className="text-xs text-[var(--text-secondary)]">
									No non-zero asset rows found in this statement.
								</p>
							)}
						</div>
					) : (
						<div className="space-y-1.5">
							<div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
								<div className="rounded border border-[var(--border)] bg-[var(--bg-subtle)] p-3">
									<p className="text-xs text-[var(--text-secondary)]">
										Rows read
									</p>
									<p className="num mt-1 text-lg font-semibold">
										{result.rowsRead}
									</p>
								</div>
								<div className="rounded border border-[var(--border)] bg-[var(--bg-subtle)] p-3">
									<p className="text-xs text-[var(--text-secondary)]">
										Inserted
									</p>
									<p className="num mt-1 text-lg font-semibold text-[var(--positive)]">
										{result.rowsInserted}
									</p>
								</div>
								<div className="rounded border border-[var(--border)] bg-[var(--bg-subtle)] p-3">
									<p className="text-xs text-[var(--text-secondary)]">
										Duplicates skipped
									</p>
									<p className="num mt-1 text-lg font-semibold">
										{result.rowsDuplicate}
									</p>
								</div>
								<div className="rounded border border-[var(--border)] bg-[var(--bg-subtle)] p-3">
									<p className="text-xs text-[var(--text-secondary)]">
										Skipped
									</p>
									<p className="num mt-1 text-lg font-semibold text-[var(--text-secondary)]">
										{result.rowsSkipped}
									</p>
								</div>
								<div className="rounded border border-[var(--border)] bg-[var(--bg-subtle)] p-3">
									<p className="text-xs text-[var(--text-secondary)]">
										Row errors
									</p>
									<p
										className={`num mt-1 text-lg font-semibold ${
											result.rowsError > 0 ? "text-[var(--loss)]" : ""
										}`}
									>
										{result.rowsError}
									</p>
								</div>
							</div>
							{rowsSuperseded !== null || rowsAmbiguous !== null ? (
								<div className="flex flex-wrap gap-3 text-xs text-[var(--text-secondary)]">
									{rowsSuperseded !== null ? (
										<span className="num">
											Superseded: <strong>{rowsSuperseded}</strong>
										</span>
									) : null}
									{rowsAmbiguous !== null ? (
										<span className="num">
											Ambiguous: <strong>{rowsAmbiguous}</strong>
										</span>
									) : null}
								</div>
							) : null}
							<p className="num text-[11px] text-[var(--text-muted)]">
								{`${result.rowsRead} read = ${result.rowsInserted} inserted + ${result.rowsDuplicate} duplicates + ${result.rowsSkipped} skipped + ${result.rowsError} errors`}
							</p>
						</div>
					)}

					{result.coverage && result.coverage.length > 0 ? (
						<div className="space-y-2">
							<h3 className="text-xs font-semibold tracking-wide text-[var(--text-secondary)] uppercase">
								Date coverage
							</h3>
							<div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
								{result.coverage.map((cov) => (
									<div
										key={`${cov.reportKind}:${cov.firstTimestamp}:${cov.lastTimestamp}`}
										className="flex flex-wrap items-center justify-between gap-2 rounded border border-[var(--border)] bg-[var(--bg-subtle)] px-3 py-2 text-xs"
									>
										<span className="font-medium">
											{formatReportKindLabel(cov.reportKind) ?? cov.reportKind}
										</span>
										<span className="num text-[var(--text-secondary)]">
											{formatIstDateTime(cov.firstTimestamp)} →{" "}
											{formatIstDateTime(cov.lastTimestamp)}
										</span>
									</div>
								))}
							</div>
						</div>
					) : null}

					{result.sheets && result.sheets.length > 0 ? (
						<div className="space-y-2">
							<h3 className="text-xs font-semibold tracking-wide text-[var(--text-secondary)] uppercase">
								Per-sheet summary
							</h3>
							<div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
								{result.sheets.map((s) => (
									<div
										key={s.name}
										className="flex items-center justify-between rounded border border-[var(--border)] px-3 py-2 text-xs"
									>
										<span className="font-medium">{s.name}</span>
										<span className="num text-[var(--text-secondary)]">
											{s.rowsRead ?? s.sampleRows.length} rows
										</span>
									</div>
								))}
							</div>
						</div>
					) : null}

					{result.skippedRows.length > 0 || result.rowsSkipped > 0
						? (() => {
								const reasonCounts = new Map<string, number>();
								for (const sr of result.skippedRows) {
									const reason = sr.reason.trim() || "Skipped row";
									reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
								}
								const groupedReasons = [...reasonCounts.entries()].sort(
									(a, b) => b[1] - a[1],
								);
								const skippedCount =
									result.skippedRows.length || result.rowsSkipped;
								return (
									<div className="space-y-2">
										<div className="flex flex-wrap items-center justify-between gap-2">
											<h3 className="text-xs font-semibold tracking-wide text-[var(--text-secondary)] uppercase">
												Skipped — not added to the ledger ({skippedCount})
											</h3>
											{result.skippedRows.length > 0 ? (
												<button
													type="button"
													aria-expanded={skippedExpanded}
													onClick={() => setSkippedExpanded((prev) => !prev)}
													className="inline-flex items-center gap-1 text-xs font-medium text-[var(--accent-text)] hover:underline"
												>
													{skippedExpanded ? (
														<>
															Hide skipped rows
															<ChevronUp
																className="h-3.5 w-3.5"
																aria-hidden="true"
															/>
														</>
													) : (
														<>
															Show {result.skippedRows.length} skipped{" "}
															{pluralise(result.skippedRows.length, "row")}
															<ChevronDown
																className="h-3.5 w-3.5"
																aria-hidden="true"
															/>
														</>
													)}
												</button>
											) : null}
										</div>
										{groupedReasons.length > 0 ? (
											<p className="rounded border border-[var(--border)] bg-[var(--bg-subtle)] px-3 py-2 text-xs text-[var(--text-secondary)]">
												{groupedReasons
													.map(([reason, count]) => `${reason} (${count})`)
													.join(" · ")}
											</p>
										) : null}
										{skippedExpanded && result.skippedRows.length > 0 ? (
											<div className="min-w-0 max-h-64 overflow-x-auto overflow-y-auto rounded border border-[var(--border)] bg-[var(--bg-subtle)]">
												<table className="w-full border-collapse text-left text-xs">
													<thead className="bg-[var(--bg-subtle)] text-[var(--text-secondary)]">
														<tr>
															<th className="border-b border-[var(--border)] px-3 py-2 font-medium whitespace-nowrap">
																Sheet
															</th>
															<th className="border-b border-[var(--border)] px-3 py-2 font-medium whitespace-nowrap">
																Row
															</th>
															<th className="border-b border-[var(--border)] px-3 py-2 font-medium whitespace-nowrap">
																Reason
															</th>
														</tr>
													</thead>
													<tbody>
														{result.skippedRows.map((sr) => (
															<tr
																key={`${sr.sheet}:${sr.rowIndex}:${sr.reason}`}
																className="border-b border-[var(--border)] last:border-b-0"
															>
																<td className="px-3 py-2 whitespace-nowrap">
																	{sr.sheet || "—"}
																</td>
																<td className="num px-3 py-2 whitespace-nowrap">
																	{sr.rowIndex + 1}
																</td>
																<td className="min-w-[240px] px-3 py-2 text-[var(--text-secondary)] whitespace-normal">
																	{sr.reason}
																</td>
															</tr>
														))}
													</tbody>
												</table>
											</div>
										) : null}
									</div>
								);
							})()
						: null}

					{rowErrors.length > 0 ? (
						<div id="row-errors" className="space-y-2">
							<h3 className="text-xs font-semibold tracking-wide text-[var(--loss)] uppercase">
								Row Errors ({rowErrors.length})
							</h3>
							<div className="min-w-0 max-h-64 overflow-x-auto overflow-y-auto rounded border border-[var(--border)]">
								<table className="w-full border-collapse text-left text-xs">
									<thead className="bg-[var(--bg-subtle)] text-[var(--text-secondary)]">
										<tr>
											<th className="border-b border-[var(--border)] px-3 py-2 font-medium whitespace-nowrap">
												Sheet
											</th>
											<th className="border-b border-[var(--border)] px-3 py-2 font-medium whitespace-nowrap">
												Row
											</th>
											<th className="border-b border-[var(--border)] px-3 py-2 font-medium whitespace-nowrap">
												Message
											</th>
										</tr>
									</thead>
									<tbody>
										{rowErrors.map((re) => (
											<tr
												key={`${re.sheet ?? ""}:${re.rowIndex}:${re.message}`}
												className="border-b border-[var(--border)] last:border-b-0"
											>
												<td className="px-3 py-2 whitespace-nowrap">
													{re.sheet ?? "—"}
												</td>
												<td className="num px-3 py-2 whitespace-nowrap">
													{re.rowIndex + 1}
												</td>
												<td className="min-w-[240px] px-3 py-2 text-[var(--loss)] whitespace-normal">
													{re.message}
												</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						</div>
					) : null}

					<div className="flex flex-wrap items-center gap-3 border-t border-[var(--border)] pt-3">
						{isUsEquityImport ? (
							<>
								<Link
									href="/us-stocks"
									className="inline-flex items-center gap-1.5 rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)]"
								>
									Open US Stocks report
									<ArrowRight className="h-4 w-4" aria-hidden="true" />
								</Link>
								<Link
									href="/transactions"
									className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--bg-surface)] px-4 py-2 text-sm font-medium hover:bg-[var(--bg-hover)]"
								>
									View transactions
								</Link>
							</>
						) : balanceSnapshot ? (
							<>
								<Link
									href="/report#statements"
									className="inline-flex items-center gap-1.5 rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)]"
								>
									View balance comparison
									<ArrowRight className="h-4 w-4" aria-hidden="true" />
								</Link>
								<Link
									href="/"
									className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--bg-surface)] px-4 py-2 text-sm font-medium hover:bg-[var(--bg-hover)]"
								>
									Overview &amp; compute report
								</Link>
							</>
						) : (
							<>
								<Link
									href="/transactions"
									className="inline-flex items-center gap-1.5 rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)]"
								>
									View transactions
									<ArrowRight className="h-4 w-4" aria-hidden="true" />
								</Link>
								<Link
									href="/"
									className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--bg-surface)] px-4 py-2 text-sm font-medium hover:bg-[var(--bg-hover)]"
								>
									Overview &amp; compute report
								</Link>
							</>
						)}
						<button
							type="button"
							onClick={resetAll}
							className="ml-auto text-sm font-medium text-[var(--accent-text)] hover:underline"
						>
							Import another file
						</button>
					</div>
				</section>
			) : (
				<form
					onSubmit={handleUpload}
					className="space-y-6 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-5"
				>
					{/* Drop zone */}
					<div>
						<span className="block text-sm font-medium">
							1. Export file (CSV, XLSX, or PDF, max 25 MB)
						</span>
						<label
							htmlFor={fileInputId}
							onDragOver={(e) => {
								e.preventDefault();
								setDragging(true);
							}}
							onDragLeave={() => setDragging(false)}
							onDrop={onDrop}
							className={`relative mt-2 flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors focus-within:border-[var(--accent)] focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--accent)] ${
								dragging
									? "border-[var(--accent)] bg-[var(--accent-soft)]"
									: "border-[var(--border-strong)] bg-[var(--bg-subtle)] hover:border-[var(--accent)]"
							}`}
						>
							<input
								id={fileInputId}
								type="file"
								accept=".csv,.xlsx,.pdf,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/pdf"
								onChange={(e) => handleFilePick(e.target.files?.[0] ?? null)}
								className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
							/>
							{file ? (
								<div className="flex flex-col items-center gap-1.5">
									<FileSpreadsheet
										className="h-8 w-8 text-[var(--accent)]"
										aria-hidden="true"
									/>
									<p className="text-sm font-semibold">{file.name}</p>
									<p className="num text-xs text-[var(--text-secondary)]">
										{(file.size / 1024).toFixed(1)} KB · Click or drop to
										replace
									</p>
								</div>
							) : (
								<div className="flex flex-col items-center gap-1.5">
									<Upload
										className="h-8 w-8 text-[var(--text-muted)]"
										aria-hidden="true"
									/>
									<p className="text-sm font-medium">
										Drop your exchange export here, or{" "}
										<span className="text-[var(--accent-text)] underline">
											browse files
										</span>
									</p>
									<p className="text-xs text-[var(--text-muted)]">
										CSV / XLSX: Binance, CoinDCX, Vested, and other exchanges or
										US stock brokers (Schwab, IBKR, generic CSV via recipes) ·
										PDF: Binance &amp; Vested Account Statements
									</p>
								</div>
							)}
						</label>
					</div>

					{/* Source picker */}
					<fieldset className="space-y-2">
						<legend className="text-sm font-medium">2. File source</legend>
						<div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
							{(
								[
									{
										id: "auto",
										title: "Auto-detect",
										desc: "Detect Binance, CoinDCX, Vested, or saved CSV recipe",
									},
									{
										id: "binance",
										title: "Binance",
										desc: "Spot trades, deposits, withdrawals, PDF statements",
									},
									{
										id: "coindcx",
										title: "CoinDCX",
										desc: "Multi-sheet Excel report (includes TDS)",
									},
									{
										id: "vested",
										title: "Vested",
										desc: "PDF or XLSX account statement — US stocks",
									},
									{
										id: "generic",
										title: "Other CSV / XLSX",
										desc: "Map columns with AI or manual recipe wizard",
									},
								] as const
							).map((opt) => (
								<label
									key={opt.id}
									className={`cursor-pointer rounded-md border p-3 transition-colors ${
										source === opt.id
											? "border-[var(--accent)] bg-[var(--accent-soft)]"
											: "border-[var(--border)] bg-[var(--bg-canvas)] hover:border-[var(--border-strong)]"
									}`}
								>
									<div className="flex items-center gap-2">
										<input
											type="radio"
											name="source"
											value={opt.id}
											checked={source === opt.id}
											onChange={() => setSource(opt.id)}
										/>
										<span className="text-sm font-medium">{opt.title}</span>
									</div>
									<p className="mt-1 pl-5 text-xs text-[var(--text-secondary)]">
										{opt.desc}
									</p>
								</label>
							))}
						</div>
					</fieldset>

					{/* Timezone question */}
					<fieldset className="space-y-2">
						<legend className="text-sm font-medium">
							3. What time zone are the times in this file?
						</legend>
						<p className="text-xs text-[var(--text-secondary)]">
							Indian tax years run 1 April – 31 March in IST. Binance file names
							carry the offset, e.g. &ldquo;(UTC+5)&rdquo;, and that offset will
							be used automatically.
						</p>
						<div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
							<label
								className={`cursor-pointer rounded-md border p-3 ${
									tzMode === "IST"
										? "border-[var(--accent)] bg-[var(--accent-soft)]"
										: "border-[var(--border)] bg-[var(--bg-canvas)]"
								}`}
							>
								<div className="flex items-center gap-2">
									<input
										type="radio"
										name="timezone"
										value="IST"
										checked={tzMode === "IST"}
										onChange={() => {
											setTzMode("IST");
											setTzError(null);
										}}
									/>
									<span className="text-sm font-medium">IST (+05:30)</span>
								</div>
								<p className="mt-1 pl-5 text-xs text-[var(--text-secondary)]">
									Asia/Kolkata · typical for CoinDCX
								</p>
							</label>

							<label
								className={`cursor-pointer rounded-md border p-3 ${
									tzMode === "UTC"
										? "border-[var(--accent)] bg-[var(--accent-soft)]"
										: "border-[var(--border)] bg-[var(--bg-canvas)]"
								}`}
							>
								<div className="flex items-center gap-2">
									<input
										type="radio"
										name="timezone"
										value="UTC"
										checked={tzMode === "UTC"}
										onChange={() => {
											setTzMode("UTC");
											setTzError(null);
										}}
									/>
									<span className="text-sm font-medium">UTC</span>
								</div>
								<p className="mt-1 pl-5 text-xs text-[var(--text-secondary)]">
									Coordinated Universal Time · +00:00
								</p>
							</label>

							<label
								className={`cursor-pointer rounded-md border p-3 ${
									tzMode === "custom"
										? "border-[var(--accent)] bg-[var(--accent-soft)]"
										: "border-[var(--border)] bg-[var(--bg-canvas)]"
								}`}
							>
								<div className="flex items-center gap-2">
									<input
										type="radio"
										name="timezone"
										value="custom"
										checked={tzMode === "custom"}
										onChange={() => setTzMode("custom")}
									/>
									<span className="text-sm font-medium">Other offset</span>
								</div>
								<p className="mt-1 pl-5 text-xs text-[var(--text-secondary)]">
									Fixed offset ±HH:MM within ±14:00
								</p>
							</label>
						</div>

						{tzMode === "custom" ? (
							<div className="mt-2 rounded-md border border-[var(--border)] bg-[var(--bg-subtle)] p-3">
								<label
									htmlFor={customOffsetId}
									className="block text-xs font-medium"
								>
									Fixed UTC offset (±HH:MM)
								</label>
								<input
									id={customOffsetId}
									type="text"
									value={customOffset}
									onChange={(e) => {
										setCustomOffset(e.target.value);
										setTzError(null);
									}}
									placeholder="+05:30"
									aria-invalid={Boolean(tzError)}
									aria-describedby={
										tzError ? `${customOffsetId}-error` : undefined
									}
									className={`font-mono-code mt-1 w-40 rounded border ${
										tzError ? "border-[var(--loss)]" : "border-[var(--border)]"
									} bg-[var(--bg-surface)] px-3 py-1.5 text-sm`}
								/>
								{tzError ? (
									<p
										id={`${customOffsetId}-error`}
										className="mt-1 text-xs text-[var(--loss)]"
									>
										{tzError}
									</p>
								) : (
									<p className="mt-1 text-xs text-[var(--text-muted)]">
										Examples: +05:30, +08:00, -04:00 (must be within ±14:00)
									</p>
								)}
							</div>
						) : null}
					</fieldset>

					{/* Conditional PDF Password prompt */}
					{pdfNeedsPassword ? (
						<div
							aria-live="polite"
							className="space-y-2 rounded-md border border-[var(--accent)]/40 bg-[var(--accent-soft)] p-4"
						>
							<div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
								<Lock
									className="h-4 w-4 text-[var(--accent)]"
									aria-hidden="true"
								/>
								PDF Password Required
							</div>
							<p className="text-xs text-[var(--text-secondary)]">
								Binance PDFs are protected with the 8-digit password shown when
								you downloaded the statement.
							</p>
							<div>
								<label
									htmlFor={pdfPasswordId}
									className="block text-xs font-medium"
								>
									PDF password
								</label>
								<input
									ref={pdfPasswordInputRef}
									id={pdfPasswordId}
									type="password"
									autoComplete="off"
									value={pdfPassword}
									onChange={(e) => setPdfPassword(e.target.value)}
									placeholder="Enter 8-digit password"
									className="font-mono-code mt-1 w-full max-w-xs rounded border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-1.5 text-sm"
								/>
							</div>
						</div>
					) : null}

					<div className="flex items-center justify-end border-t border-[var(--border)] pt-4">
						<button
							type="submit"
							disabled={uploading || !file}
							className="inline-flex items-center gap-2 rounded-md bg-[var(--accent)] px-5 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-50"
						>
							<Upload className="h-4 w-4" aria-hidden="true" />
							{uploading
								? "Parsing file…"
								: pdfNeedsPassword
									? "Unlock & import PDF"
									: "Upload & import"}
						</button>
					</div>
				</form>
			)}
		</div>
	);
}
