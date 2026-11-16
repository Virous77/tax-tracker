"use client";

import {
	AlertTriangle,
	ArrowRight,
	CheckCircle2,
	FileSpreadsheet,
	Upload,
	XCircle,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { type DragEvent, useEffect, useId, useState } from "react";
import { RecipeWizard } from "@/components/import/RecipeWizard";
import { Badge } from "@/components/ui/Badge";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import {
	api,
	getErrorMessage,
	type ImportDetail,
	type ImportSummary,
} from "@/lib/client/api";
import { formatSourceLabel } from "@/lib/client/format";

type SourceChoice = "auto" | "binance" | "coindcx" | "generic";
type TzChoice = "IST" | "UTC";

const MAX_BYTES = 25 * 1024 * 1024;

export function ImportClient() {
	const searchParams = useSearchParams();
	const resumeImportId = searchParams.get("importId");

	const [file, setFile] = useState<File | null>(null);
	const [dragging, setDragging] = useState(false);
	const [source, setSource] = useState<SourceChoice>("auto");
	const [timezone, setTimezone] = useState<TzChoice>("IST");
	const [uploading, setUploading] = useState(false);
	const [loadingResume, setLoadingResume] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [result, setResult] = useState<ImportSummary | ImportDetail | null>(
		null,
	);

	const fileInputId = useId();

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

	function handleFilePick(picked: File | null) {
		setError(null);
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
		if (source === "auto") {
			if (name.includes("binance")) setTimezone("UTC");
			else if (name.includes("coindcx")) setTimezone("IST");
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
			setError("Choose a CSV or XLSX export file first.");
			return;
		}
		setUploading(true);
		setError(null);
		try {
			const summary = await api.createImport({ file, source, timezone });
			if (summary.status !== "pending_recipe") {
				const detail = await api.getImport(summary.id).catch(() => summary);
				setResult(detail);
			} else {
				setResult(summary);
			}
		} catch (err) {
			setError(getErrorMessage(err));
		} finally {
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
	}

	if (loadingResume) {
		return (
			<div className="h-48 animate-pulse rounded-lg border border-[var(--border)] bg-[var(--bg-surface)]" />
		);
	}

	if (result?.status === "pending_recipe") {
		return (
			<div className="space-y-4">
				<div>
					<h1 className="text-xl font-semibold tracking-tight">Import File</h1>
					<p className="mt-0.5 text-sm text-[var(--text-secondary)]">
						Configure column mapping for your generic CSV / XLSX export.
					</p>
				</div>
				<RecipeWizard
					importItem={result}
					onConfirmed={handleWizardConfirmed}
					onCancel={resetAll}
				/>
			</div>
		);
	}

	const rowErrors = result && "rowErrors" in result ? result.rowErrors : [];

	return (
		<div className="space-y-6">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div>
					<h1 className="text-xl font-semibold tracking-tight">Import</h1>
					<p className="mt-0.5 text-sm text-[var(--text-secondary)]">
						Upload Binance, CoinDCX, or other CSV/XLSX exchange exports.
						Duplicate rows are safely skipped.
					</p>
				</div>
				<Link
					href="/imports"
					className="inline-flex items-center gap-1.5 rounded border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs font-medium hover:bg-[var(--bg-hover)]"
				>
					Import history
					<ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
				</Link>
			</div>

			{error ? <ErrorBanner message={error} /> : null}

			{result ? (
				<section
					aria-live="polite"
					className="space-y-4 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-5"
				>
					<div className="flex flex-wrap items-start justify-between gap-3">
						<div className="flex items-start gap-2.5">
							{result.status === "imported" ? (
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
							<div>
								<h2 className="text-base font-semibold">
									{result.fileName} —{" "}
									{result.status === "imported"
										? "Import complete"
										: "Import failed"}
								</h2>
								<p className="text-xs text-[var(--text-secondary)]">
									Source: {formatSourceLabel(result.source)} · File timezone:{" "}
									{result.timezone}
								</p>
							</div>
						</div>
						<Badge tone={result.status === "imported" ? "positive" : "loss"}>
							{result.status}
						</Badge>
					</div>

					{result.error ? (
						<p className="rounded border border-[var(--loss)]/40 bg-[var(--loss-soft)] px-3 py-2 text-sm text-[var(--loss)]">
							{result.error}
						</p>
					) : null}

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
								<p className="text-xs text-[var(--text-secondary)]">Inserted</p>
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
								<p className="text-xs text-[var(--text-secondary)]">Skipped</p>
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
						<p className="num text-[11px] text-[var(--text-muted)]">
							{`${result.rowsRead} read = ${result.rowsInserted} inserted + ${result.rowsDuplicate} duplicates + ${result.rowsSkipped} skipped + ${result.rowsError} errors`}
						</p>
					</div>

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

					{result.warnings.length > 0 ? (
						<div className="space-y-1.5 rounded border border-[var(--warning)]/40 bg-[var(--warning-soft)] p-3 text-xs">
							<p className="flex items-center gap-1.5 font-semibold text-[var(--warning)]">
								<AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
								Warnings ({result.warnings.length})
							</p>
							<ul className="list-disc space-y-0.5 pl-5 text-[var(--text-primary)]">
								{result.warnings.map((w) => (
									<li key={`${w.code}:${w.txId ?? ""}:${w.message}`}>
										<span className="font-mono-code font-medium">{w.code}</span>
										: {w.message}
									</li>
								))}
							</ul>
						</div>
					) : null}

					{result.skippedRows.length > 0 || result.rowsSkipped > 0 ? (
						<div className="space-y-2">
							<h3 className="text-xs font-semibold tracking-wide text-[var(--text-secondary)] uppercase">
								Skipped — covered by another export ({result.skippedRows.length}
								)
							</h3>
							{result.skippedRows.length > 0 ? (
								<div className="max-h-64 overflow-auto rounded border border-[var(--border)] bg-[var(--bg-subtle)]">
									<table className="w-full border-collapse text-left text-xs">
										<thead className="bg-[var(--bg-subtle)] text-[var(--text-secondary)]">
											<tr>
												<th className="border-b border-[var(--border)] px-3 py-2 font-medium">
													Sheet
												</th>
												<th className="border-b border-[var(--border)] px-3 py-2 font-medium">
													Row
												</th>
												<th className="border-b border-[var(--border)] px-3 py-2 font-medium">
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
													<td className="px-3 py-2">{sr.sheet || "—"}</td>
													<td className="num px-3 py-2">{sr.rowIndex + 1}</td>
													<td className="px-3 py-2 text-[var(--text-secondary)]">
														{sr.reason}
													</td>
												</tr>
											))}
										</tbody>
									</table>
								</div>
							) : null}
						</div>
					) : null}

					{rowErrors.length > 0 ? (
						<div className="space-y-2">
							<h3 className="text-xs font-semibold tracking-wide text-[var(--loss)] uppercase">
								Row Errors ({rowErrors.length})
							</h3>
							<div className="max-h-64 overflow-auto rounded border border-[var(--border)]">
								<table className="w-full border-collapse text-left text-xs">
									<thead className="bg-[var(--bg-subtle)] text-[var(--text-secondary)]">
										<tr>
											<th className="border-b border-[var(--border)] px-3 py-2 font-medium">
												Sheet
											</th>
											<th className="border-b border-[var(--border)] px-3 py-2 font-medium">
												Row
											</th>
											<th className="border-b border-[var(--border)] px-3 py-2 font-medium">
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
												<td className="px-3 py-2">{re.sheet ?? "—"}</td>
												<td className="num px-3 py-2">{re.rowIndex + 1}</td>
												<td className="px-3 py-2 text-[var(--loss)]">
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
							1. Export file (CSV or XLSX, max 25 MB)
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
								accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
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
										Supports Binance CSV/XLSX, CoinDCX multi-tab XLSX, and any
										other CSV
									</p>
								</div>
							)}
						</label>
					</div>

					{/* Source picker */}
					<fieldset className="space-y-2">
						<legend className="text-sm font-medium">2. File source</legend>
						<div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
							{(
								[
									{
										id: "auto",
										title: "Auto-detect",
										desc: "Detect Binance, CoinDCX, or saved CSV recipe",
									},
									{
										id: "binance",
										title: "Binance",
										desc: "Spot trades, deposits, withdrawals, statements",
									},
									{
										id: "coindcx",
										title: "CoinDCX",
										desc: "Multi-sheet Excel report (includes TDS)",
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
							3. Are times in this file IST or UTC?
						</legend>
						<p className="text-xs text-[var(--text-secondary)]">
							Indian tax years run 1 April – 31 March in IST. Files without
							explicit offsets need this to place 31 March / 1 April trades in
							the right year.
						</p>
						<div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
							<label
								className={`cursor-pointer rounded-md border p-3 ${
									timezone === "IST"
										? "border-[var(--accent)] bg-[var(--accent-soft)]"
										: "border-[var(--border)] bg-[var(--bg-canvas)]"
								}`}
							>
								<div className="flex items-center gap-2">
									<input
										type="radio"
										name="timezone"
										value="IST"
										checked={timezone === "IST"}
										onChange={() => setTimezone("IST")}
									/>
									<span className="text-sm font-medium">
										IST (Asia/Kolkata, UTC+05:30)
									</span>
								</div>
								<p className="mt-1 pl-5 text-xs text-[var(--text-secondary)]">
									Typical for CoinDCX and Indian exchanges
								</p>
							</label>

							<label
								className={`cursor-pointer rounded-md border p-3 ${
									timezone === "UTC"
										? "border-[var(--accent)] bg-[var(--accent-soft)]"
										: "border-[var(--border)] bg-[var(--bg-canvas)]"
								}`}
							>
								<div className="flex items-center gap-2">
									<input
										type="radio"
										name="timezone"
										value="UTC"
										checked={timezone === "UTC"}
										onChange={() => setTimezone("UTC")}
									/>
									<span className="text-sm font-medium">
										UTC (Coordinated Universal Time)
									</span>
								</div>
								<p className="mt-1 pl-5 text-xs text-[var(--text-secondary)]">
									Typical for Binance and global exchanges
								</p>
							</label>
						</div>
					</fieldset>

					<div className="flex items-center justify-end border-t border-[var(--border)] pt-4">
						<button
							type="submit"
							disabled={uploading || !file}
							className="inline-flex items-center gap-2 rounded-md bg-[var(--accent)] px-5 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-50"
						>
							<Upload className="h-4 w-4" aria-hidden="true" />
							{uploading ? "Parsing file…" : "Upload & import"}
						</button>
					</div>
				</form>
			)}
		</div>
	);
}
