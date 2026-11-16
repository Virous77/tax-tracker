"use client";

import type { Recipe } from "@tax/core";
import { Eye, FileSpreadsheet, Plus, Trash2, Wrench } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Drawer } from "@/components/ui/Drawer";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import {
	api,
	getErrorMessage,
	type ImportDetail,
	type ImportSummary,
} from "@/lib/client/api";
import {
	formatIstDateTime,
	formatSignStyle,
	formatSourceLabel,
} from "@/lib/client/format";

export function ImportsClient() {
	const [imports, setImports] = useState<ImportSummary[]>([]);
	const [recipes, setRecipes] = useState<Recipe[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const [detail, setDetail] = useState<ImportDetail | null>(null);
	const [detailLoading, setDetailLoading] = useState(false);

	const [deleteTarget, setDeleteTarget] = useState<ImportSummary | null>(null);
	const [deleteRecipeTarget, setDeleteRecipeTarget] = useState<Recipe | null>(
		null,
	);
	const [deleting, setDeleting] = useState(false);

	const loadAll = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const [impList, recList] = await Promise.all([
				api.listImports(),
				api.listRecipes().catch(() => []),
			]);
			setImports(impList);
			setRecipes(recList);
		} catch (err) {
			setError(getErrorMessage(err));
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		loadAll();
	}, [loadAll]);

	async function openDetail(id: string) {
		setDetailLoading(true);
		setError(null);
		try {
			const res = await api.getImport(id);
			setDetail(res);
		} catch (err) {
			setError(getErrorMessage(err));
		} finally {
			setDetailLoading(false);
		}
	}

	async function confirmDeleteImport() {
		if (!deleteTarget) return;
		setDeleting(true);
		setError(null);
		try {
			await api.deleteImport(deleteTarget.id);
			setImports((prev) => prev.filter((item) => item.id !== deleteTarget.id));
			if (detail?.id === deleteTarget.id) setDetail(null);
			setDeleteTarget(null);
		} catch (err) {
			setError(getErrorMessage(err));
		} finally {
			setDeleting(false);
		}
	}

	async function confirmDeleteRecipe() {
		if (!deleteRecipeTarget) return;
		setDeleting(true);
		setError(null);
		try {
			await api.deleteRecipe(deleteRecipeTarget.id);
			setRecipes((prev) =>
				prev.filter((item) => item.id !== deleteRecipeTarget.id),
			);
			setDeleteRecipeTarget(null);
		} catch (err) {
			setError(getErrorMessage(err));
		} finally {
			setDeleting(false);
		}
	}

	return (
		<div className="space-y-6">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div>
					<h1 className="text-xl font-semibold tracking-tight">Imports</h1>
					<p className="mt-0.5 text-sm text-[var(--text-secondary)]">
						Uploaded exchange files and saved generic CSV mapping recipes.
					</p>
				</div>
				<Link
					href="/import"
					className="inline-flex items-center gap-1.5 rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)]"
				>
					<Plus className="h-4 w-4" aria-hidden="true" />
					New import
				</Link>
			</div>

			{error ? <ErrorBanner message={error} onRetry={loadAll} /> : null}

			{loading ? (
				<div className="h-48 animate-pulse rounded-lg border border-[var(--border)] bg-[var(--bg-surface)]" />
			) : imports.length === 0 ? (
				<EmptyState
					icon={<FileSpreadsheet className="h-8 w-8" />}
					title="No files imported yet"
					description="Upload a Binance, CoinDCX, or generic CSV export to populate your ledger."
					action={
						<Link
							href="/import"
							className="inline-flex items-center gap-1.5 rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)]"
						>
							Import a file
						</Link>
					}
				/>
			) : (
				<>
					{/* Mobile card view */}
					<div className="space-y-3 md:hidden">
						{imports.map((imp) => (
							<div
								key={imp.id}
								className="space-y-3 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-4"
							>
								<div className="flex items-start justify-between gap-2">
									<div className="min-w-0">
										<p className="truncate text-sm font-medium">
											{imp.fileName}
										</p>
										<p className="mt-0.5 text-xs text-[var(--text-secondary)]">
											{formatSourceLabel(imp.source)} · {imp.timezone} ·{" "}
											{formatIstDateTime(imp.createdAt)}
										</p>
									</div>
									<Badge
										tone={
											imp.status === "imported"
												? "positive"
												: imp.status === "pending_recipe"
													? "warning"
													: "loss"
										}
									>
										{imp.status === "pending_recipe"
											? "Needs recipe"
											: imp.status}
									</Badge>
								</div>

								<dl className="grid grid-cols-5 gap-2 rounded border border-[var(--border)] bg-[var(--bg-subtle)] px-3 py-2 text-xs">
									<div>
										<dt className="text-[var(--text-muted)]">Read</dt>
										<dd className="num font-medium">{imp.rowsRead}</dd>
									</div>
									<div>
										<dt className="text-[var(--text-muted)]">Inserted</dt>
										<dd className="num font-medium text-[var(--positive)]">
											{imp.rowsInserted}
										</dd>
									</div>
									<div>
										<dt className="text-[var(--text-muted)]">Dupes</dt>
										<dd className="num font-medium text-[var(--text-secondary)]">
											{imp.rowsDuplicate}
										</dd>
									</div>
									<div>
										<dt className="text-[var(--text-muted)]">Skipped</dt>
										<dd className="num font-medium text-[var(--text-secondary)]">
											{imp.rowsSkipped}
										</dd>
									</div>
									<div>
										<dt className="text-[var(--text-muted)]">Errors</dt>
										<dd
											className={`num font-medium ${
												imp.rowsError > 0
													? "text-[var(--loss)]"
													: "text-[var(--text-secondary)]"
											}`}
										>
											{imp.rowsError}
										</dd>
									</div>
								</dl>

								<div className="flex flex-wrap items-center justify-end gap-2">
									{imp.status === "pending_recipe" ? (
										<Link
											href={`/import?importId=${encodeURIComponent(imp.id)}`}
											className="inline-flex items-center gap-1 rounded border border-[var(--accent)] px-2.5 py-1.5 text-xs font-medium text-[var(--accent-text)] hover:bg-[var(--accent-soft)]"
										>
											<Wrench className="h-3.5 w-3.5" aria-hidden="true" />
											Map
										</Link>
									) : null}
									<button
										type="button"
										onClick={() => openDetail(imp.id)}
										aria-label={`Inspect ${imp.fileName}`}
										className="inline-flex items-center gap-1 rounded border border-[var(--border)] px-2.5 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
									>
										<Eye className="h-3.5 w-3.5" aria-hidden="true" />
										Inspect
									</button>
									<button
										type="button"
										onClick={() => setDeleteTarget(imp)}
										aria-label={`Delete ${imp.fileName}`}
										className="inline-flex items-center gap-1 rounded border border-[var(--border)] px-2.5 py-1.5 text-xs font-medium text-[var(--loss)] hover:bg-[var(--loss-soft)]"
									>
										<Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
										Delete
									</button>
								</div>
							</div>
						))}
					</div>

					{/* Desktop table view */}
					<div className="hidden overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] md:block">
						<div className="overflow-x-auto">
							<table className="w-full border-collapse text-left text-sm">
								<thead className="border-b border-[var(--border)] bg-[var(--bg-subtle)] text-xs text-[var(--text-secondary)]">
									<tr>
										<th className="px-4 py-2.5 font-medium">File</th>
										<th className="px-4 py-2.5 font-medium">Source</th>
										<th className="px-4 py-2.5 font-medium">TZ</th>
										<th className="px-4 py-2.5 font-medium">Status</th>
										<th className="num-right px-4 py-2.5 font-medium">Read</th>
										<th className="num-right px-4 py-2.5 font-medium">
											Inserted
										</th>
										<th className="num-right px-4 py-2.5 font-medium">Dupes</th>
										<th className="num-right px-4 py-2.5 font-medium">
											Errors
										</th>
										<th className="px-4 py-2.5 font-medium">Imported at</th>
										<th className="px-4 py-2.5 text-right font-medium">
											Actions
										</th>
									</tr>
								</thead>
								<tbody>
									{imports.map((imp) => (
										<tr
											key={imp.id}
											className="border-b border-[var(--border)] last:border-b-0 hover:bg-[var(--bg-hover)]/60"
										>
											<td className="max-w-52 truncate px-4 py-2.5 font-medium">
												<span>{imp.fileName}</span>
												{imp.rowsSkipped > 0 ? (
													<span className="num block text-[11px] font-normal text-[var(--text-muted)]">
														{imp.rowsSkipped} skipped (overlap)
													</span>
												) : null}
											</td>
											<td className="px-4 py-2.5 whitespace-nowrap text-[var(--text-secondary)]">
												{formatSourceLabel(imp.source)}
											</td>
											<td className="px-4 py-2.5 whitespace-nowrap">
												<Badge tone="neutral">{imp.timezone}</Badge>
											</td>
											<td className="px-4 py-2.5 whitespace-nowrap">
												<Badge
													tone={
														imp.status === "imported"
															? "positive"
															: imp.status === "pending_recipe"
																? "warning"
																: "loss"
													}
												>
													{imp.status === "pending_recipe"
														? "Needs recipe"
														: imp.status}
												</Badge>
											</td>
											<td className="num-right px-4 py-2.5">{imp.rowsRead}</td>
											<td className="num-right px-4 py-2.5 text-[var(--positive)]">
												{imp.rowsInserted}
											</td>
											<td className="num-right px-4 py-2.5 text-[var(--text-secondary)]">
												{imp.rowsDuplicate}
											</td>
											<td
												className={`num-right px-4 py-2.5 ${
													imp.rowsError > 0
														? "font-medium text-[var(--loss)]"
														: "text-[var(--text-secondary)]"
												}`}
											>
												{imp.rowsError}
											</td>
											<td className="px-4 py-2.5 text-xs whitespace-nowrap text-[var(--text-secondary)]">
												{formatIstDateTime(imp.createdAt)}
											</td>
											<td className="px-4 py-2.5 text-right whitespace-nowrap">
												<div className="inline-flex items-center gap-1.5">
													{imp.status === "pending_recipe" ? (
														<Link
															href={`/import?importId=${encodeURIComponent(imp.id)}`}
															className="inline-flex items-center gap-1 rounded border border-[var(--accent)] px-2 py-1 text-xs font-medium text-[var(--accent-text)] hover:bg-[var(--accent-soft)]"
														>
															<Wrench className="h-3 w-3" aria-hidden="true" />
															Map
														</Link>
													) : null}
													<button
														type="button"
														onClick={() => openDetail(imp.id)}
														aria-label={`Inspect ${imp.fileName}`}
														className="rounded border border-[var(--border)] p-1.5 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
													>
														<Eye className="h-3.5 w-3.5" aria-hidden="true" />
													</button>
													<button
														type="button"
														onClick={() => setDeleteTarget(imp)}
														aria-label={`Delete ${imp.fileName}`}
														className="rounded border border-[var(--border)] p-1.5 text-[var(--loss)] hover:bg-[var(--loss-soft)]"
													>
														<Trash2
															className="h-3.5 w-3.5"
															aria-hidden="true"
														/>
													</button>
												</div>
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					</div>
				</>
			)}

			{recipes.length > 0 ? (
				<section className="space-y-3">
					<h2 className="text-base font-semibold tracking-tight">
						Saved CSV Recipes ({recipes.length})
					</h2>
					<div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg-surface)]">
						<div className="overflow-x-auto">
							<table className="w-full border-collapse text-left text-sm">
								<thead className="border-b border-[var(--border)] bg-[var(--bg-subtle)] text-xs text-[var(--text-secondary)]">
									<tr>
										<th className="px-4 py-2 font-medium">Name</th>
										<th className="px-4 py-2 font-medium">Sign style</th>
										<th className="px-4 py-2 font-medium">Date format</th>
										<th className="px-4 py-2 font-medium">Fingerprint</th>
										<th className="px-4 py-2 text-right font-medium">Delete</th>
									</tr>
								</thead>
								<tbody>
									{recipes.map((rec) => (
										<tr
											key={rec.id}
											className="border-b border-[var(--border)] last:border-b-0"
										>
											<td className="px-4 py-2 font-medium">{rec.name}</td>
											<td className="px-4 py-2 text-xs text-[var(--text-secondary)]">
												{formatSignStyle(rec.signStyle)}
											</td>
											<td className="font-mono-code px-4 py-2 text-xs text-[var(--text-secondary)]">
												{rec.dateFormat}
											</td>
											<td className="font-mono-code max-w-44 truncate px-4 py-2 text-xs text-[var(--text-muted)]">
												{rec.fingerprint}
											</td>
											<td className="px-4 py-2 text-right">
												<button
													type="button"
													onClick={() => setDeleteRecipeTarget(rec)}
													aria-label={`Delete recipe ${rec.name}`}
													className="rounded border border-[var(--border)] p-1.5 text-[var(--loss)] hover:bg-[var(--loss-soft)]"
												>
													<Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
												</button>
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					</div>
				</section>
			) : null}

			<Drawer
				open={Boolean(detail) || detailLoading}
				onClose={() => setDetail(null)}
				title={detail?.fileName ?? "Import details"}
				subtitle={detail ? `ID: ${detail.id}` : undefined}
			>
				{detailLoading ? (
					<div className="h-40 animate-pulse rounded bg-[var(--bg-subtle)]" />
				) : detail ? (
					<div className="space-y-4 text-sm">
						<dl className="grid grid-cols-2 gap-3 rounded-md border border-[var(--border)] bg-[var(--bg-subtle)] p-3 text-xs">
							<div>
								<dt className="text-[var(--text-muted)]">Source</dt>
								<dd className="mt-0.5 font-medium">
									{formatSourceLabel(detail.source)}
								</dd>
							</div>
							<div>
								<dt className="text-[var(--text-muted)]">Timezone</dt>
								<dd className="mt-0.5 font-medium">{detail.timezone}</dd>
							</div>
							<div className="col-span-2">
								<dt className="text-[var(--text-muted)]">File SHA-256</dt>
								<dd className="font-mono-code mt-0.5 break-all text-[11px]">
									{detail.fileSha256}
								</dd>
							</div>
						</dl>

						<div className="space-y-1.5">
							<dl className="grid grid-cols-5 gap-2 rounded-md border border-[var(--border)] bg-[var(--bg-subtle)] p-3 text-xs">
								<div>
									<dt className="text-[var(--text-muted)]">Read</dt>
									<dd className="num mt-0.5 font-semibold">
										{detail.rowsRead}
									</dd>
								</div>
								<div>
									<dt className="text-[var(--text-muted)]">Inserted</dt>
									<dd className="num mt-0.5 font-semibold text-[var(--positive)]">
										{detail.rowsInserted}
									</dd>
								</div>
								<div>
									<dt className="text-[var(--text-muted)]">Dupes</dt>
									<dd className="num mt-0.5 font-semibold text-[var(--text-secondary)]">
										{detail.rowsDuplicate}
									</dd>
								</div>
								<div>
									<dt className="text-[var(--text-muted)]">Skipped</dt>
									<dd className="num mt-0.5 font-semibold text-[var(--text-secondary)]">
										{detail.rowsSkipped}
									</dd>
								</div>
								<div>
									<dt className="text-[var(--text-muted)]">Errors</dt>
									<dd
										className={`num mt-0.5 font-semibold ${
											detail.rowsError > 0
												? "text-[var(--loss)]"
												: "text-[var(--text-secondary)]"
										}`}
									>
										{detail.rowsError}
									</dd>
								</div>
							</dl>
							<p className="num text-[11px] text-[var(--text-muted)]">
								{`${detail.rowsRead} read = ${detail.rowsInserted} inserted + ${detail.rowsDuplicate} duplicates + ${detail.rowsSkipped} skipped + ${detail.rowsError} errors`}
							</p>
						</div>

						{detail.sheets && detail.sheets.length > 0 ? (
							<div className="space-y-2">
								<h3 className="text-xs font-semibold tracking-wide text-[var(--text-secondary)] uppercase">
									Sheets
								</h3>
								<ul className="space-y-1.5 text-xs">
									{detail.sheets.map((s) => (
										<li
											key={s.name}
											className="flex items-center justify-between rounded border border-[var(--border)] px-3 py-2"
										>
											<span className="font-medium">{s.name}</span>
											<span className="num text-[var(--text-secondary)]">
												{s.rowsRead ?? s.sampleRows.length} rows ·{" "}
												{s.headers.length} columns
											</span>
										</li>
									))}
								</ul>
							</div>
						) : null}

						{detail.warnings.length > 0 ? (
							<div className="space-y-1.5">
								<h3 className="text-xs font-semibold tracking-wide text-[var(--warning)] uppercase">
									Warnings ({detail.warnings.length})
								</h3>
								<ul className="space-y-1 text-xs">
									{detail.warnings.map((w) => (
										<li
											key={`${w.code}:${w.txId ?? ""}:${w.message}`}
											className="rounded border border-[var(--warning)]/30 bg-[var(--warning-soft)] px-3 py-2"
										>
											<span className="font-mono-code font-medium">
												{w.code}
											</span>
											: {w.message}
										</li>
									))}
								</ul>
							</div>
						) : null}

						{detail.skippedRows.length > 0 || detail.rowsSkipped > 0 ? (
							<div className="space-y-2">
								<h3 className="text-xs font-semibold tracking-wide text-[var(--text-secondary)] uppercase">
									Skipped — covered by another export (
									{detail.skippedRows.length})
								</h3>
								{detail.skippedRows.length > 0 ? (
									<div className="max-h-60 space-y-1.5 overflow-y-auto">
										{detail.skippedRows.map((sr) => (
											<div
												key={`${sr.sheet}:${sr.rowIndex}:${sr.reason}`}
												className="rounded border border-[var(--border)] bg-[var(--bg-subtle)] p-2.5 text-xs"
											>
												<p className="font-medium text-[var(--text-primary)]">
													{sr.sheet ? `${sr.sheet} · ` : ""}Row{" "}
													{sr.rowIndex + 1}
												</p>
												<p className="mt-0.5 text-[var(--text-secondary)]">
													{sr.reason}
												</p>
											</div>
										))}
									</div>
								) : null}
							</div>
						) : null}

						<div className="space-y-2">
							<h3 className="text-xs font-semibold tracking-wide text-[var(--text-secondary)] uppercase">
								Row Errors ({detail.rowErrors.length})
							</h3>
							{detail.rowErrors.length === 0 ? (
								<p className="text-xs text-[var(--text-muted)]">
									No row-level errors recorded.
								</p>
							) : (
								<div className="space-y-2">
									{detail.rowErrors.map((re) => (
										<div
											key={`${re.sheet ?? ""}:${re.rowIndex}:${re.message}`}
											className="rounded border border-[var(--loss)]/30 bg-[var(--loss-soft)] p-2.5 text-xs"
										>
											<p className="font-medium text-[var(--loss)]">
												{re.sheet ? `${re.sheet} · ` : ""}Row {re.rowIndex + 1}:{" "}
												{re.message}
											</p>
											{re.raw !== undefined ? (
												<pre className="font-mono-code mt-1 overflow-x-auto text-[11px] text-[var(--text-secondary)]">
													{JSON.stringify(re.raw, null, 2)}
												</pre>
											) : null}
										</div>
									))}
								</div>
							)}
						</div>
					</div>
				) : null}
			</Drawer>

			<ConfirmDialog
				open={Boolean(deleteTarget)}
				title="Delete import?"
				description={
					deleteTarget
						? `This will permanently delete "${deleteTarget.fileName}" along with all ${deleteTarget.rowsInserted} imported transactions and raw source rows.`
						: ""
				}
				confirmLabel="Delete import"
				destructive
				busy={deleting}
				onConfirm={confirmDeleteImport}
				onCancel={() => setDeleteTarget(null)}
			/>

			<ConfirmDialog
				open={Boolean(deleteRecipeTarget)}
				title="Delete saved recipe?"
				description={
					deleteRecipeTarget
						? `Delete recipe "${deleteRecipeTarget.name}"? Existing imported transactions will not be removed.`
						: ""
				}
				confirmLabel="Delete recipe"
				destructive
				busy={deleting}
				onConfirm={confirmDeleteRecipe}
				onCancel={() => setDeleteRecipeTarget(null)}
			/>
		</div>
	);
}
