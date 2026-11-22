"use client";

import {
	AlertCircle,
	Check,
	ChevronDown,
	ChevronUp,
	Coins,
	Copy,
	Info,
	Key,
	Pencil,
	Plus,
	RefreshCw,
	ShieldCheck,
	Trash2,
	Wallet,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { AddConnectionDialog } from "@/components/connections/AddConnectionDialog";
import { KeyCheckBanner } from "@/components/connections/KeyCheckBanner";
import {
	ProviderKeysCard,
	providerDisplayName,
} from "@/components/connections/ProviderKeysCard";
import { SymbolTagInput } from "@/components/connections/SymbolTagInput";
import {
	classifyIncompleteSync,
	collectSyncNotes,
	hasBalanceDifference,
	type IncompleteSyncKind,
	SyncSummaryPanel,
} from "@/components/connections/SyncSummaryPanel";
import { VaultCard } from "@/components/connections/VaultCard";
import { Badge } from "@/components/ui/Badge";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import {
	ApiError,
	api,
	type Connection,
	type ConnectionBalances,
	getErrorMessage,
	type JobStatus,
	type KeyCheck,
	type ProvidersMap,
	type SyncSummary,
	type VaultStatus,
} from "@/lib/client/api";
import { getEvmChainName, shortenAddress } from "@/lib/client/chains";
import {
	formatIstDateTime,
	formatLocalTime,
	formatSyncStreamLabel,
} from "@/lib/client/format";

interface ActiveSyncState {
	jobId: string;
	job: JobStatus | null;
}

interface SyncErrorState {
	message: string;
	missingProviders?: string[];
}

function connectionKindLabel(conn: Connection): string {
	if (conn.kind === "binance") return "Binance";
	if (conn.kind === "coindcx") return "CoinDCX";
	return getEvmChainName(conn.chainId);
}

function connectionSourceKey(conn: Connection): string {
	if (conn.kind === "evm") return `evm:${conn.chainId ?? 1}`;
	return `${conn.kind}-api`;
}

function syncStatusBadge(
	status: string | null,
	running: boolean,
	incompleteKind: IncompleteSyncKind | null,
	balanceMismatch: boolean,
) {
	if (running || status === "running") {
		return <Badge tone="accent">Syncing</Badge>;
	}
	if (status === "completed") {
		return balanceMismatch ? (
			<Badge tone="loss">Balance mismatch</Badge>
		) : (
			<Badge tone="positive">Synced</Badge>
		);
	}
	if (status === "incomplete") {
		if (incompleteKind === "synced_with_notes") {
			return <Badge tone="warning">Synced with notes</Badge>;
		}
		if (incompleteKind === "incomplete_with_diff") {
			return <Badge tone="loss">Incomplete</Badge>;
		}
		return <Badge tone="warning">Incomplete</Badge>;
	}
	if (status === "failed") {
		return <Badge tone="loss">Failed</Badge>;
	}
	return <Badge tone="neutral">Not synced</Badge>;
}

function extractMissingProviders(details: unknown): string[] {
	if (!details || typeof details !== "object") return [];
	const needs = (details as { needs?: unknown }).needs;
	if (!Array.isArray(needs)) return [];
	return needs.filter((item): item is string => typeof item === "string");
}

export function ConnectionsClient() {
	const [vault, setVault] = useState<VaultStatus | null>(null);
	const [connections, setConnections] = useState<Connection[]>([]);
	const [providers, setProviders] = useState<ProvidersMap>({});
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const [addOpen, setAddOpen] = useState(false);
	const [deleteTarget, setDeleteTarget] = useState<Connection | null>(null);
	const [deleting, setDeleting] = useState(false);

	// Per-connection UI state
	const [copiedId, setCopiedId] = useState<string | null>(null);
	const [checkingId, setCheckingId] = useState<string | null>(null);
	const [keyChecks, setKeyChecks] = useState<
		Record<string, { result?: KeyCheck; error?: string }>
	>({});

	const [activeSyncs, setActiveSyncs] = useState<
		Record<string, ActiveSyncState>
	>({});
	const [syncErrors, setSyncErrors] = useState<Record<string, SyncErrorState>>(
		{},
	);
	const [syncSummaries, setSyncSummaries] = useState<
		Record<string, SyncSummary>
	>({});
	const [focusProvider, setFocusProvider] = useState<{
		name: string;
		seq: number;
	} | null>(null);

	const [expandedPanels, setExpandedPanels] = useState<Record<string, boolean>>(
		{},
	);
	const [balancesById, setBalancesById] = useState<
		Record<string, ConnectionBalances>
	>({});
	const [balancesLoading, setBalancesLoading] = useState<
		Record<string, boolean>
	>({});
	const [balancesErrors, setBalancesErrors] = useState<Record<string, string>>(
		{},
	);

	// Edit label / Binance extra trading pairs
	const [editingId, setEditingId] = useState<string | null>(null);
	const [editLabel, setEditLabel] = useState("");
	const [editSymbols, setEditSymbols] = useState<string[]>([]);
	const [editBusy, setEditBusy] = useState(false);
	const [editError, setEditError] = useState<string | null>(null);

	// Replace keys
	const [replaceKeysId, setReplaceKeysId] = useState<string | null>(null);
	const [replaceKey, setReplaceKey] = useState("");
	const [replaceSecret, setReplaceSecret] = useState("");
	const [replaceBusy, setReplaceBusy] = useState(false);
	const [replaceError, setReplaceError] = useState<string | null>(null);

	const mountedRef = useRef(true);
	const pollTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
		new Map(),
	);
	const resumedRunningJobsRef = useRef<Set<string>>(new Set());
	const fetchedLastJobIdsRef = useRef<Set<string>>(new Set());

	useEffect(() => {
		mountedRef.current = true;
		const timers = pollTimersRef.current;
		return () => {
			mountedRef.current = false;
			for (const timer of timers.values()) clearTimeout(timer);
			timers.clear();
		};
	}, []);

	const loadAll = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const [v, conns, provs] = await Promise.all([
				api.getVault(),
				api.listConnections(),
				api.getProviders(),
			]);
			if (!mountedRef.current) return;
			setVault(v);
			setConnections(conns);
			setProviders(provs);
		} catch (err) {
			if (!mountedRef.current) return;
			setError(getErrorMessage(err));
		} finally {
			if (mountedRef.current) setLoading(false);
		}
	}, []);

	useEffect(() => {
		loadAll();
	}, [loadAll]);

	const refreshConnectionsAndProviders = useCallback(async () => {
		try {
			const [conns, provs] = await Promise.all([
				api.listConnections(),
				api.getProviders(),
			]);
			if (!mountedRef.current) return;
			setConnections(conns);
			setProviders(provs);
		} catch {
			// keep existing state if background refresh fails
		}
	}, []);

	// If a connection was already running on load without a jobId, poll listConnections until it finishes
	const hasExternalRunning = connections.some(
		(c) => c.running && !c.runningJobId && !activeSyncs[c.id],
	);
	useEffect(() => {
		if (!hasExternalRunning) return;
		const timer = setInterval(() => {
			void refreshConnectionsAndProviders();
		}, 2000);
		return () => clearInterval(timer);
	}, [hasExternalRunning, refreshConnectionsAndProviders]);

	const fetchBalances = useCallback(async (connectionId: string) => {
		setBalancesLoading((prev) => ({ ...prev, [connectionId]: true }));
		setBalancesErrors((prev) => {
			const next = { ...prev };
			delete next[connectionId];
			return next;
		});
		try {
			const data = await api.getConnectionBalances(connectionId);
			if (!mountedRef.current) return;
			setBalancesById((prev) => ({ ...prev, [connectionId]: data }));
		} catch (err) {
			if (!mountedRef.current) return;
			setBalancesErrors((prev) => ({
				...prev,
				[connectionId]: getErrorMessage(err),
			}));
		} finally {
			if (mountedRef.current) {
				setBalancesLoading((prev) => ({ ...prev, [connectionId]: false }));
			}
		}
	}, []);

	const pollSyncJob = useCallback(
		(
			connectionId: string,
			jobId: string,
			opts: { immediate?: boolean } = {},
		) => {
			const existing = pollTimersRef.current.get(connectionId);
			if (existing) clearTimeout(existing);

			const tick = async () => {
				if (!mountedRef.current) return;
				try {
					const job = await api.getJob(jobId);
					if (!mountedRef.current) return;

					if (job.status === "pending" || job.status === "running") {
						setActiveSyncs((prev) => ({
							...prev,
							[connectionId]: { jobId, job },
						}));
						const nextTimer = setTimeout(tick, 1000);
						pollTimersRef.current.set(connectionId, nextTimer);
						return;
					}

					pollTimersRef.current.delete(connectionId);
					fetchedLastJobIdsRef.current.add(jobId);
					setActiveSyncs((prev) => {
						const next = { ...prev };
						delete next[connectionId];
						return next;
					});

					if (job.status === "completed") {
						if (job.result && "streams" in job.result) {
							setSyncSummaries((prev) => ({
								...prev,
								[connectionId]: job.result as SyncSummary,
							}));
						}
						setExpandedPanels((prev) => ({ ...prev, [connectionId]: true }));
						await Promise.all([
							refreshConnectionsAndProviders(),
							fetchBalances(connectionId),
						]);
					} else if (job.status === "failed") {
						setSyncErrors((prev) => ({
							...prev,
							[connectionId]: { message: job.error ?? "Sync failed." },
						}));
						await refreshConnectionsAndProviders();
					}
				} catch (err) {
					if (!mountedRef.current) return;
					pollTimersRef.current.delete(connectionId);
					setActiveSyncs((prev) => {
						const next = { ...prev };
						delete next[connectionId];
						return next;
					});
					setSyncErrors((prev) => ({
						...prev,
						[connectionId]: { message: getErrorMessage(err) },
					}));
					await refreshConnectionsAndProviders();
				}
			};

			if (opts.immediate) {
				void tick();
			} else {
				const timer = setTimeout(tick, 1000);
				pollTimersRef.current.set(connectionId, timer);
			}
		},
		[fetchBalances, refreshConnectionsAndProviders],
	);

	// Resume active runningJobId and hydrate lastSyncJobId summaries after reload
	useEffect(() => {
		for (const conn of connections) {
			if (
				conn.runningJobId &&
				!resumedRunningJobsRef.current.has(conn.runningJobId)
			) {
				const jobId = conn.runningJobId;
				resumedRunningJobsRef.current.add(jobId);
				setActiveSyncs((prev) => ({
					...prev,
					[conn.id]: { jobId, job: prev[conn.id]?.job ?? null },
				}));
				pollSyncJob(conn.id, jobId, { immediate: true });
			} else if (
				!conn.runningJobId &&
				conn.lastSyncJobId &&
				!fetchedLastJobIdsRef.current.has(conn.lastSyncJobId)
			) {
				const jobId = conn.lastSyncJobId;
				const connId = conn.id;
				const shouldFetchIncompleteBalances =
					conn.lastSyncStatus === "incomplete";
				fetchedLastJobIdsRef.current.add(jobId);
				void api
					.getJob(jobId)
					.then((job) => {
						if (!mountedRef.current) return;
						if (
							job.status === "completed" &&
							job.result &&
							"streams" in job.result
						) {
							setSyncSummaries((prev) => ({
								...prev,
								[connId]: job.result as SyncSummary,
							}));
							setExpandedPanels((prev) => ({ ...prev, [connId]: true }));
							void fetchBalances(connId);
						} else if (shouldFetchIncompleteBalances) {
							void fetchBalances(connId);
						}
					})
					.catch(() => {
						if (mountedRef.current && shouldFetchIncompleteBalances) {
							void fetchBalances(connId);
						}
					});
			} else if (
				!conn.runningJobId &&
				!conn.lastSyncJobId &&
				conn.lastSyncStatus === "incomplete" &&
				!balancesById[conn.id] &&
				!balancesLoading[conn.id] &&
				!balancesErrors[conn.id]
			) {
				void fetchBalances(conn.id);
			}
		}
	}, [
		balancesById,
		balancesErrors,
		balancesLoading,
		connections,
		fetchBalances,
		pollSyncJob,
	]);

	async function handleSyncNow(conn: Connection) {
		setSyncErrors((prev) => {
			const next = { ...prev };
			delete next[conn.id];
			return next;
		});
		try {
			const { jobId } = await api.syncConnection(conn.id);
			if (!mountedRef.current) return;
			resumedRunningJobsRef.current.add(jobId);
			setActiveSyncs((prev) => ({
				...prev,
				[conn.id]: { jobId, job: null },
			}));
			setConnections((prev) =>
				prev.map((c) =>
					c.id === conn.id ? { ...c, running: true, runningJobId: jobId } : c,
				),
			);
			pollSyncJob(conn.id, jobId);
		} catch (err) {
			if (!mountedRef.current) return;
			if (err instanceof ApiError && err.code === "provider_key_required") {
				const needs = extractMissingProviders(err.details);
				const needsText = needs.map(providerDisplayName).join(" or ");
				setSyncErrors((prev) => ({
					...prev,
					[conn.id]: {
						message: needsText
							? `This chain needs ${/^[AEIOU]/i.test(needsText) ? "an" : "a"} ${needsText} key.`
							: "This chain needs a provider API key.",
						missingProviders: needs,
					},
				}));
				return;
			}
			setSyncErrors((prev) => ({
				...prev,
				[conn.id]: { message: getErrorMessage(err) },
			}));
		}
	}

	async function handleCheckKey(conn: Connection) {
		setCheckingId(conn.id);
		setKeyChecks((prev) => {
			const next = { ...prev };
			delete next[conn.id];
			return next;
		});
		try {
			const result = await api.checkConnection(conn.id);
			if (!mountedRef.current) return;
			setKeyChecks((prev) => ({ ...prev, [conn.id]: { result } }));
		} catch (err) {
			if (!mountedRef.current) return;
			setKeyChecks((prev) => ({
				...prev,
				[conn.id]: { error: getErrorMessage(err) },
			}));
		} finally {
			if (mountedRef.current) setCheckingId(null);
		}
	}

	async function handleCopyAddress(conn: Connection) {
		if (!conn.address) return;
		try {
			await navigator.clipboard.writeText(conn.address);
			setCopiedId(conn.id);
			setTimeout(() => {
				if (mountedRef.current) {
					setCopiedId((cur) => (cur === conn.id ? null : cur));
				}
			}, 1500);
		} catch {
			// clipboard unavailable
		}
	}

	function openEdit(conn: Connection) {
		setReplaceKeysId(null);
		setEditingId(conn.id);
		setEditLabel(conn.label);
		setEditSymbols(conn.options.extraSymbols ?? []);
		setEditError(null);
	}

	async function handleSaveEdit(conn: Connection, e: React.FormEvent) {
		e.preventDefault();
		const trimmed = editLabel.trim();
		if (!trimmed) {
			setEditError("Label is required.");
			return;
		}
		setEditBusy(true);
		setEditError(null);
		try {
			const updated = await api.patchConnection(conn.id, {
				label: trimmed,
				...(conn.kind === "binance"
					? {
							options: {
								...conn.options,
								extraSymbols: editSymbols,
							},
						}
					: {}),
			});
			setConnections((prev) =>
				prev.map((c) => (c.id === updated.id ? updated : c)),
			);
			setEditingId(null);
		} catch (err) {
			setEditError(getErrorMessage(err));
		} finally {
			setEditBusy(false);
		}
	}

	function openReplaceKeys(conn: Connection) {
		setEditingId(null);
		setReplaceKeysId(conn.id);
		setReplaceKey("");
		setReplaceSecret("");
		setReplaceError(null);
	}

	async function handleSaveReplacedKeys(conn: Connection, e: React.FormEvent) {
		e.preventDefault();
		const k = replaceKey.trim();
		const s = replaceSecret.trim();
		if (!k || !s) {
			setReplaceError("Both API key and API secret are required.");
			return;
		}
		setReplaceKey("");
		setReplaceSecret("");
		setReplaceBusy(true);
		setReplaceError(null);
		try {
			const updated = await api.patchConnection(conn.id, {
				apiKey: k,
				apiSecret: s,
			});
			setConnections((prev) =>
				prev.map((c) => (c.id === updated.id ? updated : c)),
			);
			setReplaceKeysId(null);
			// Automatically check replaced exchange keys
			void handleCheckKey(updated);
		} catch (err) {
			setReplaceError(getErrorMessage(err));
		} finally {
			setReplaceBusy(false);
		}
	}

	async function confirmDeleteConnection() {
		if (!deleteTarget) return;
		setDeleting(true);
		setError(null);
		try {
			await api.deleteConnection(deleteTarget.id);
			const timer = pollTimersRef.current.get(deleteTarget.id);
			if (timer) {
				clearTimeout(timer);
				pollTimersRef.current.delete(deleteTarget.id);
			}
			setConnections((prev) => prev.filter((c) => c.id !== deleteTarget.id));
			setDeleteTarget(null);
		} catch (err) {
			setError(getErrorMessage(err));
		} finally {
			setDeleting(false);
		}
	}

	function toggleSummaryPanel(conn: Connection) {
		const nextOpen = !expandedPanels[conn.id];
		setExpandedPanels((prev) => ({ ...prev, [conn.id]: nextOpen }));
		if (nextOpen && !balancesById[conn.id] && !balancesLoading[conn.id]) {
			void fetchBalances(conn.id);
		}
	}

	return (
		<div className="space-y-6">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div>
					<h1 className="text-xl font-semibold tracking-tight">Connections</h1>
					<p className="mt-0.5 text-sm text-[var(--text-secondary)]">
						Encrypted vault, read-only exchange API syncs, EVM wallet tracking,
						and block explorer provider keys.
					</p>
				</div>
				<button
					type="button"
					onClick={() => setAddOpen(true)}
					disabled={!vault}
					className="inline-flex items-center gap-1.5 rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
				>
					<Plus className="h-4 w-4" aria-hidden="true" />
					Add connection
				</button>
			</div>

			{error ? <ErrorBanner message={error} onRetry={loadAll} /> : null}

			{loading ? (
				<div className="space-y-4">
					<div className="h-36 animate-pulse rounded-lg border border-[var(--border)] bg-[var(--bg-surface)]" />
					<div className="h-48 animate-pulse rounded-lg border border-[var(--border)] bg-[var(--bg-surface)]" />
				</div>
			) : (
				<>
					{vault ? (
						<VaultCard
							vault={vault}
							onChanged={(next, event) => {
								setVault(next);
								if (event === "reset" || event === "unlock") {
									void refreshConnectionsAndProviders();
								}
							}}
						/>
					) : null}

					{/* Connections List */}
					<section className="space-y-3">
						<div className="flex flex-wrap items-center justify-between gap-2">
							<h2 className="text-base font-semibold tracking-tight">
								Accounts &amp; Wallets ({connections.length})
							</h2>
						</div>

						{connections.length === 0 ? (
							<EmptyState
								icon={<Wallet className="h-8 w-8" />}
								title="No connections configured"
								description="Add a read-only Binance or CoinDCX API key, or track an EVM wallet address across Ethereum, Base, Arbitrum, Polygon, or BNB Chain. Prefer files? Import an export from the Import page instead."
								action={
									<button
										type="button"
										onClick={() => setAddOpen(true)}
										className="inline-flex items-center gap-1.5 rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)]"
									>
										<Plus className="h-4 w-4" aria-hidden="true" />
										Add connection
									</button>
								}
							/>
						) : (
							<div className="space-y-3">
								{connections.map((conn) => {
									const activeSync = activeSyncs[conn.id];
									const isRunning = Boolean(activeSync) || conn.running;
									const syncErr = syncErrors[conn.id];
									const checkState = keyChecks[conn.id];
									const summary = syncSummaries[conn.id];
									const balances = balancesById[conn.id];
									const incompleteKind =
										conn.lastSyncStatus === "incomplete"
											? classifyIncompleteSync(summary, balances)
											: null;
									const syncNotes = collectSyncNotes(summary);
									const showRedLastSyncError =
										Boolean(conn.lastSyncError) &&
										(conn.lastSyncStatus === "failed" ||
											incompleteKind === "incomplete_with_diff");
									const isPanelOpen = Boolean(expandedPanels[conn.id]);
									const KindIcon = conn.kind === "evm" ? Wallet : Coins;
									const canViewSummary =
										Boolean(summary) || Boolean(conn.lastSyncAt);

									return (
										<article
											key={conn.id}
											className="space-y-3 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-4"
										>
											<div className="flex flex-wrap items-start justify-between gap-3">
												<div className="min-w-0 space-y-1.5">
													<div className="flex flex-wrap items-center gap-2">
														<KindIcon
															className="h-4 w-4 shrink-0 text-[var(--accent)]"
															aria-hidden="true"
														/>
														<h3 className="text-sm font-semibold">
															{conn.label}
														</h3>
														<Badge tone="neutral">
															{connectionKindLabel(conn)}
														</Badge>
														{conn.kind === "coindcx" ? (
															<Badge tone="warning">Spot orderbook only</Badge>
														) : null}
														<Badge tone={conn.keySet ? "positive" : "warning"}>
															{conn.kind === "evm"
																? conn.keySet
																	? "Provider key set"
																	: "No provider key"
																: conn.keySet
																	? "Key set"
																	: "Key missing"}
														</Badge>
														{syncStatusBadge(
															conn.lastSyncStatus,
															isRunning,
															incompleteKind,
															hasBalanceDifference(summary, balances),
														)}
													</div>

													<div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--text-secondary)]">
														{conn.kind === "evm" && conn.address ? (
															<span className="inline-flex items-center gap-1.5">
																<code
																	title={conn.address}
																	className="font-mono-code rounded bg-[var(--bg-subtle)] px-1.5 py-0.5 text-[11px] text-[var(--text-primary)]"
																>
																	{shortenAddress(conn.address)}
																</code>
																<button
																	type="button"
																	onClick={() => handleCopyAddress(conn)}
																	aria-label={`Copy address ${conn.address}`}
																	className="inline-flex items-center gap-1 rounded border border-[var(--border)] px-1.5 py-0.5 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
																>
																	{copiedId === conn.id ? (
																		<>
																			<Check
																				className="h-3 w-3 text-[var(--positive)]"
																				aria-hidden="true"
																			/>
																			Copied
																		</>
																	) : (
																		<>
																			<Copy
																				className="h-3 w-3"
																				aria-hidden="true"
																			/>
																			Copy
																		</>
																	)}
																</button>
															</span>
														) : null}

														<span>
															Last sync:{" "}
															{conn.lastSyncAt
																? formatIstDateTime(conn.lastSyncAt)
																: "Never"}
														</span>

														{conn.kind === "binance" &&
														conn.options.extraSymbols &&
														conn.options.extraSymbols.length > 0 ? (
															<span>
																Extra pairs:{" "}
																<span className="font-mono-code text-[var(--text-primary)]">
																	{conn.options.extraSymbols.join(", ")}
																</span>
															</span>
														) : null}

														{conn.kind === "coindcx" ? (
															<Link
																href="/import"
																className="font-medium text-[var(--accent-text)] hover:underline"
															>
																Import Instant &amp; Form 16A files
															</Link>
														) : null}
													</div>

													{showRedLastSyncError ? (
														<p className="text-xs text-[var(--loss)]">
															Last sync error: {conn.lastSyncError}
														</p>
													) : !isPanelOpen &&
														incompleteKind === "synced_with_notes" &&
														syncNotes.length > 0 ? (
														<div className="space-y-1 pt-0.5 text-xs">
															<h4 className="font-semibold tracking-wide text-[var(--text-secondary)] uppercase">
																Notes
															</h4>
															<ul className="space-y-1 text-[var(--text-secondary)]">
																{syncNotes.map((note) => (
																	<li
																		key={note}
																		className="flex items-start gap-1.5"
																	>
																		<Info
																			className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--warning)]"
																			aria-hidden="true"
																		/>
																		<span>{note}</span>
																	</li>
																))}
															</ul>
														</div>
													) : null}
												</div>

												{/* Actions */}
												<div className="flex flex-wrap items-center gap-1.5">
													<button
														type="button"
														disabled={isRunning}
														onClick={() => handleSyncNow(conn)}
														className="inline-flex items-center gap-1 rounded-md bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
													>
														<RefreshCw
															className={`h-3.5 w-3.5 ${isRunning ? "animate-spin" : ""}`}
															aria-hidden="true"
														/>
														{isRunning ? "Syncing…" : "Sync now"}
													</button>

													<button
														type="button"
														disabled={checkingId === conn.id || isRunning}
														onClick={() => handleCheckKey(conn)}
														className="inline-flex items-center gap-1 rounded border border-[var(--border)] bg-[var(--bg-canvas)] px-2.5 py-1.5 text-xs font-medium hover:bg-[var(--bg-hover)] disabled:opacity-50"
													>
														<ShieldCheck
															className="h-3.5 w-3.5"
															aria-hidden="true"
														/>
														{checkingId === conn.id ? "Checking…" : "Check key"}
													</button>

													<button
														type="button"
														disabled={isRunning}
														onClick={() =>
															editingId === conn.id
																? setEditingId(null)
																: openEdit(conn)
														}
														className="inline-flex items-center gap-1 rounded border border-[var(--border)] bg-[var(--bg-canvas)] px-2.5 py-1.5 text-xs font-medium hover:bg-[var(--bg-hover)] disabled:opacity-50"
													>
														<Pencil className="h-3 w-3" aria-hidden="true" />
														Edit
													</button>

													{conn.kind !== "evm" ? (
														<button
															type="button"
															disabled={isRunning}
															onClick={() =>
																replaceKeysId === conn.id
																	? setReplaceKeysId(null)
																	: openReplaceKeys(conn)
															}
															className="inline-flex items-center gap-1 rounded border border-[var(--border)] bg-[var(--bg-canvas)] px-2.5 py-1.5 text-xs font-medium hover:bg-[var(--bg-hover)] disabled:opacity-50"
														>
															<Key className="h-3 w-3" aria-hidden="true" />
															Replace keys
														</button>
													) : null}

													{canViewSummary ? (
														<button
															type="button"
															aria-expanded={isPanelOpen}
															onClick={() => toggleSummaryPanel(conn)}
															className="inline-flex items-center gap-1 rounded border border-[var(--border)] bg-[var(--bg-canvas)] px-2.5 py-1.5 text-xs font-medium hover:bg-[var(--bg-hover)]"
														>
															{isPanelOpen ? (
																<ChevronUp
																	className="h-3.5 w-3.5"
																	aria-hidden="true"
																/>
															) : (
																<ChevronDown
																	className="h-3.5 w-3.5"
																	aria-hidden="true"
																/>
															)}
															Summary &amp; balances
														</button>
													) : null}

													<button
														type="button"
														disabled={isRunning}
														onClick={() => setDeleteTarget(conn)}
														aria-label={`Delete ${conn.label}`}
														className="inline-flex items-center gap-1 rounded border border-[var(--border)] px-2.5 py-1.5 text-xs font-medium text-[var(--loss)] hover:bg-[var(--loss-soft)] disabled:opacity-50"
													>
														<Trash2
															className="h-3.5 w-3.5"
															aria-hidden="true"
														/>
														Delete
													</button>
												</div>
											</div>

											{/* Live sync progress */}
											{isRunning ? (
												<div
													aria-live="polite"
													className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[var(--accent)]/30 bg-[var(--accent-soft)] px-3 py-2 text-xs text-[var(--accent-text)]"
												>
													{activeSync?.job?.progress ? (
														(() => {
															const progress = activeSync.job.progress;
															const streamLabel = formatSyncStreamLabel(
																progress.stream,
															);
															const vendor = connectionKindLabel(conn);
															const resumeAt = progress.waitingUntil
																? formatLocalTime(progress.waitingUntil)
																: null;
															return (
																<>
																	<span>
																		{progress.waitingUntil ? (
																			<>
																				Waiting for {vendor} rate limit —{" "}
																				{resumeAt
																					? `resumes at ${resumeAt}`
																					: "resuming shortly"}{" "}
																				<span className="text-[var(--text-secondary)]">
																					({streamLabel})
																				</span>
																			</>
																		) : (
																			<>Syncing {streamLabel}…</>
																		)}
																	</span>
																	<span className="num font-medium">
																		Streams: {progress.streamsDone}
																		{progress.streamsTotal !== null
																			? `/${progress.streamsTotal}`
																			: ""}{" "}
																		· {progress.rowsFetched} rows fetched
																	</span>
																</>
															);
														})()
													) : (
														<span>
															Sync in progress… polling status every second.
														</span>
													)}
												</div>
											) : null}

											{syncErr ? (
												syncErr.missingProviders &&
												syncErr.missingProviders.length > 0 ? (
													<div
														role="alert"
														className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-[var(--loss)]/40 bg-[var(--loss-soft)] px-4 py-3 text-sm text-[var(--loss)]"
													>
														<div className="flex items-start gap-2.5">
															<AlertCircle
																className="mt-0.5 h-4 w-4 shrink-0"
																aria-hidden="true"
															/>
															<div>
																<p className="font-semibold">
																	Provider key required
																</p>
																<p className="mt-0.5 text-[var(--text-primary)]">
																	{syncErr.message}
																	{!vault?.unlocked
																		? " Unlock your vault first to add a key."
																		: ""}
																</p>
															</div>
														</div>
														<div className="flex flex-wrap items-center gap-2">
															{syncErr.missingProviders.map((providerName) => (
																<button
																	key={providerName}
																	type="button"
																	onClick={() =>
																		setFocusProvider({
																			name: providerName,
																			seq: Date.now(),
																		})
																	}
																	className="rounded border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-1 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
																>
																	Add {providerDisplayName(providerName)} key
																</button>
															))}
														</div>
													</div>
												) : (
													<ErrorBanner message={syncErr.message} />
												)
											) : null}

											{checkState ? (
												<KeyCheckBanner
													result={checkState.result}
													error={checkState.error}
												/>
											) : null}

											{/* Inline edit form */}
											{editingId === conn.id ? (
												<form
													onSubmit={(e) => handleSaveEdit(conn, e)}
													className="space-y-3 rounded-md border border-[var(--border)] bg-[var(--bg-subtle)] p-3"
												>
													{editError ? (
														<ErrorBanner message={editError} />
													) : null}
													<div>
														<label
															htmlFor={`edit-label-${conn.id}`}
															className="block text-xs font-medium"
														>
															Connection label
														</label>
														<input
															id={`edit-label-${conn.id}`}
															type="text"
															required
															value={editLabel}
															onChange={(e) => setEditLabel(e.target.value)}
															className="mt-1 w-full max-w-sm rounded border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-1.5 text-sm"
														/>
													</div>
													{conn.kind === "binance" ? (
														<SymbolTagInput
															symbols={editSymbols}
															onChange={setEditSymbols}
															disabled={editBusy}
														/>
													) : null}
													<div className="flex justify-end gap-2">
														<button
															type="button"
															disabled={editBusy}
															onClick={() => setEditingId(null)}
															className="rounded border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-1 text-xs font-medium hover:bg-[var(--bg-hover)]"
														>
															Cancel
														</button>
														<button
															type="submit"
															disabled={editBusy}
															className="rounded bg-[var(--accent)] px-3 py-1 text-xs font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
														>
															{editBusy ? "Saving…" : "Save"}
														</button>
													</div>
												</form>
											) : null}

											{/* Inline replace keys form */}
											{replaceKeysId === conn.id ? (
												<form
													onSubmit={(e) => handleSaveReplacedKeys(conn, e)}
													className="space-y-3 rounded-md border border-[var(--border)] bg-[var(--bg-subtle)] p-3"
												>
													{replaceError ? (
														<ErrorBanner message={replaceError} />
													) : null}
													{!vault?.unlocked ? (
														<p className="text-xs text-[var(--warning)]">
															Unlock the vault first before replacing keys.
														</p>
													) : null}
													<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
														<div>
															<label
																htmlFor={`replace-key-${conn.id}`}
																className="block text-xs font-medium"
															>
																New API key
															</label>
															<input
																id={`replace-key-${conn.id}`}
																type="password"
																autoComplete="new-password"
																required
																value={replaceKey}
																onChange={(e) => setReplaceKey(e.target.value)}
																className="font-mono-code mt-1 w-full rounded border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-1.5 text-sm"
															/>
														</div>
														<div>
															<label
																htmlFor={`replace-secret-${conn.id}`}
																className="block text-xs font-medium"
															>
																New API secret
															</label>
															<input
																id={`replace-secret-${conn.id}`}
																type="password"
																autoComplete="new-password"
																required
																value={replaceSecret}
																onChange={(e) =>
																	setReplaceSecret(e.target.value)
																}
																className="font-mono-code mt-1 w-full rounded border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-1.5 text-sm"
															/>
														</div>
													</div>
													<div className="flex justify-end gap-2">
														<button
															type="button"
															disabled={replaceBusy}
															onClick={() => {
																setReplaceKey("");
																setReplaceSecret("");
																setReplaceKeysId(null);
															}}
															className="rounded border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-1 text-xs font-medium hover:bg-[var(--bg-hover)]"
														>
															Cancel
														</button>
														<button
															type="submit"
															disabled={replaceBusy || !vault?.unlocked}
															className="rounded bg-[var(--accent)] px-3 py-1 text-xs font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
														>
															{replaceBusy ? "Saving…" : "Save new keys"}
														</button>
													</div>
												</form>
											) : null}

											{/* Sync summary + balance check panel */}
											{isPanelOpen ? (
												<SyncSummaryPanel
													summary={summary}
													balances={balancesById[conn.id]}
													balancesLoading={Boolean(balancesLoading[conn.id])}
													balancesError={balancesErrors[conn.id]}
													connectionSource={connectionSourceKey(conn)}
													connectionKind={conn.kind}
													connectionLastSyncStatus={conn.lastSyncStatus}
												/>
											) : null}
										</article>
									);
								})}
							</div>
						)}
					</section>

					{/* Provider Keys Card */}
					<ProviderKeysCard
						providers={providers}
						vaultUnlocked={Boolean(vault?.unlocked)}
						focusRequest={focusProvider}
						onUpdated={(next) => {
							setProviders(next);
							setSyncErrors((prev) => {
								const updated: Record<string, SyncErrorState> = {};
								for (const [id, errState] of Object.entries(prev)) {
									const nowSatisfied = errState.missingProviders?.some(
										(name) => next[name]?.keySet,
									);
									if (!nowSatisfied) {
										updated[id] = errState;
									}
								}
								return updated;
							});
							void refreshConnectionsAndProviders();
						}}
					/>
				</>
			)}

			<AddConnectionDialog
				open={addOpen}
				vaultUnlocked={Boolean(vault?.unlocked)}
				onClose={() => setAddOpen(false)}
				onCreated={(conn, check) => {
					setConnections((prev) => [...prev, conn]);
					if (check) {
						setKeyChecks((prev) => ({ ...prev, [conn.id]: check }));
					}
				}}
			/>

			<ConfirmDialog
				open={Boolean(deleteTarget)}
				title="Delete connection?"
				description={
					deleteTarget
						? `Delete "${deleteTarget.label}"? This removes its stored keys, sync cursors, and fetched balances. Synced transactions stay in your ledger until you delete the sync imports on the Imports page.`
						: ""
				}
				confirmLabel="Delete connection"
				destructive
				busy={deleting}
				onConfirm={confirmDeleteConnection}
				onCancel={() => setDeleteTarget(null)}
			/>
		</div>
	);
}
