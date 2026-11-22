"use client";

import { ExternalLink, Key, Trash2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { Select, SelectItem } from "@/components/ui/Select";
import { api, getErrorMessage, type ProvidersMap } from "@/lib/client/api";

interface ProviderMeta {
	label: string;
	purpose: string;
	keyUrl?: string;
	keyLinkLabel?: string;
}

const PROVIDER_META: Record<string, ProviderMeta> = {
	etherscan: {
		label: "Etherscan",
		purpose:
			"Ethereum mainnet, Arbitrum, and Polygon history (a paid plan covers Base and BNB Chain too).",
		keyUrl: "https://etherscan.io/myapikey",
		keyLinkLabel: "Get free key",
	},
	blockscout: {
		label: "Blockscout",
		purpose:
			"Open-source EVM block explorer fallback for Ethereum, Base, Arbitrum, and Polygon.",
		keyUrl: "https://eth.blockscout.com/account/api-key",
		keyLinkLabel: "Get free key",
	},
	coingecko: {
		label: "CoinGecko",
		purpose:
			"Fallback daily historical prices (last 365 days) for coins without a Binance pair.",
		keyUrl: "https://www.coingecko.com/en/api/pricing",
		keyLinkLabel: "Get free Demo key",
	},
	alchemy: {
		label: "Alchemy",
		purpose:
			"Used for Base, and as a fallback for Ethereum, Polygon, and Arbitrum.",
		keyUrl: "https://dashboard.alchemy.com/",
		keyLinkLabel: "Get free key",
	},
	nodereal: {
		label: "NodeReal",
		purpose: "Used for BNB Chain transaction and token transfer history.",
		keyUrl: "https://nodereal.io/",
		keyLinkLabel: "Get free key",
	},
	polygon: {
		label: "Polygon.io (Massive)",
		purpose:
			"Free daily US stock prices (2 years history, 5 calls/min) to auto-fill Schedule FA peak and Dec 31 closing values.",
		keyUrl: "https://polygon.io/dashboard/api-keys",
		keyLinkLabel: "Get free key",
	},
	finnhub: {
		label: "Finnhub",
		purpose:
			"Alternative / fallback daily US stock prices (60 calls/min) for Schedule FA peak and Dec 31 closing values.",
		keyUrl: "https://finnhub.io/dashboard",
		keyLinkLabel: "Get free key",
	},
};

export function providerDisplayName(name: string): string {
	return (
		PROVIDER_META[name]?.label ?? name.charAt(0).toUpperCase() + name.slice(1)
	);
}

function metaForProvider(name: string): ProviderMeta {
	if (PROVIDER_META[name]) return PROVIDER_META[name];
	return {
		label: name.charAt(0).toUpperCase() + name.slice(1),
		purpose: `API key for ${name} provider requests.`,
	};
}

export function ProviderKeysCard({
	providers,
	vaultUnlocked,
	focusRequest,
	onUpdated,
}: {
	providers: ProvidersMap;
	vaultUnlocked: boolean;
	focusRequest?: { name: string; seq: number } | null;
	onUpdated: (next: ProvidersMap) => void;
}) {
	const [editingProvider, setEditingProvider] = useState<string | null>(null);
	const [keyDraft, setKeyDraft] = useState("");
	const [tierDraft, setTierDraft] = useState<"free" | "paid">(
		providers.etherscan?.tier ?? "free",
	);
	const [removeTarget, setRemoveTarget] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const inputId = useId();
	const tierId = useId();

	const cardRef = useRef<HTMLElement>(null);
	const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});
	const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});
	const buttonRefs = useRef<Record<string, HTMLButtonElement | null>>({});

	const entries = Object.entries(providers);

	useEffect(() => {
		if (!focusRequest) return;
		const { name } = focusRequest;
		setError(null);
		setKeyDraft("");
		if (name === "etherscan") {
			setTierDraft(providers.etherscan?.tier ?? "free");
		}
		if (vaultUnlocked) {
			setEditingProvider(name);
		}
		const timer = setTimeout(() => {
			const rowEl = rowRefs.current[name] ?? cardRef.current;
			rowEl?.scrollIntoView({ behavior: "smooth", block: "center" });
			if (vaultUnlocked) {
				inputRefs.current[name]?.focus({ preventScroll: true });
			} else {
				buttonRefs.current[name]?.focus({ preventScroll: true });
			}
		}, 50);
		return () => clearTimeout(timer);
	}, [focusRequest, providers.etherscan?.tier, vaultUnlocked]);

	async function handleSave(e: React.FormEvent) {
		e.preventDefault();
		if (!editingProvider) return;
		const trimmed = keyDraft.trim();
		if (!trimmed) {
			setError("Enter an API key.");
			return;
		}
		const target = editingProvider;
		const selectedTier = target === "etherscan" ? tierDraft : undefined;
		setKeyDraft("");
		setError(null);
		setBusy(true);
		try {
			const next = await api.putProvider(target, trimmed, selectedTier);
			setEditingProvider(null);
			onUpdated(next);
		} catch (err) {
			setError(getErrorMessage(err));
		} finally {
			setBusy(false);
		}
	}

	async function confirmRemove() {
		if (!removeTarget) return;
		setError(null);
		setBusy(true);
		try {
			const next = await api.deleteProvider(removeTarget);
			setRemoveTarget(null);
			onUpdated(next);
		} catch (err) {
			setError(getErrorMessage(err));
		} finally {
			setBusy(false);
		}
	}

	return (
		<section
			ref={cardRef}
			id="provider-keys"
			className="space-y-4 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-5"
		>
			<div className="flex flex-wrap items-center justify-between gap-2">
				<div>
					<h2 className="text-base font-semibold tracking-tight">
						Provider API Keys
					</h2>
					<p className="text-xs text-[var(--text-secondary)]">
						Used only when you sync an EVM wallet, run a CoinGecko crypto price
						lookup, or auto-fill US stock Schedule FA prices.
					</p>
				</div>
				{!vaultUnlocked ? (
					<Badge tone="warning">Unlock vault to edit keys</Badge>
				) : null}
			</div>

			{error ? <ErrorBanner message={error} /> : null}

			<div className="divide-y divide-[var(--border)] rounded-md border border-[var(--border)]">
				{entries.map(([name, info]) => {
					const meta = metaForProvider(name);
					const isEditing = editingProvider === name;
					return (
						<div
							key={name}
							ref={(el) => {
								rowRefs.current[name] = el;
							}}
							id={`provider-${name}`}
							className="space-y-3 p-4"
						>
							<div className="flex flex-wrap items-start justify-between gap-3">
								<div className="min-w-0 flex-1 space-y-1">
									<div className="flex flex-wrap items-center gap-2">
										<span className="text-sm font-semibold">{meta.label}</span>
										<Badge tone={info.keySet ? "positive" : "neutral"}>
											{info.keySet ? "Key set" : "Not set"}
										</Badge>
										{name === "etherscan" && info.keySet && info.tier ? (
											<Badge tone={info.tier === "paid" ? "accent" : "neutral"}>
												{info.tier === "paid" ? "Paid plan" : "Free plan"}
											</Badge>
										) : null}
										{meta.keyUrl ? (
											<a
												href={meta.keyUrl}
												target="_blank"
												rel="noopener noreferrer"
												className="inline-flex items-center gap-1 text-xs font-medium text-[var(--accent-text)] hover:underline"
											>
												{meta.keyLinkLabel ?? "Get key"}
												<ExternalLink className="h-3 w-3" aria-hidden="true" />
											</a>
										) : null}
									</div>
									<p className="text-xs text-[var(--text-secondary)]">
										{meta.purpose}
									</p>
								</div>

								<div className="flex shrink-0 items-center gap-2">
									<button
										ref={(el) => {
											buttonRefs.current[name] = el;
										}}
										type="button"
										disabled={!vaultUnlocked || busy}
										onClick={() => {
											setError(null);
											setKeyDraft("");
											if (name === "etherscan") {
												setTierDraft(info.tier ?? "free");
											}
											setEditingProvider(isEditing ? null : name);
										}}
										className="inline-flex items-center gap-1 rounded border border-[var(--border)] bg-[var(--bg-canvas)] px-2.5 py-1 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-50"
									>
										<Key className="h-3 w-3" aria-hidden="true" />
										{isEditing ? "Cancel" : info.keySet ? "Replace" : "Set key"}
									</button>
									{info.keySet ? (
										<button
											type="button"
											disabled={!vaultUnlocked || busy}
											onClick={() => {
												setError(null);
												setRemoveTarget(name);
											}}
											aria-label={`Remove ${meta.label} key`}
											className="inline-flex items-center gap-1 rounded border border-[var(--border)] px-2.5 py-1 text-xs font-medium text-[var(--loss)] hover:bg-[var(--loss-soft)] disabled:cursor-not-allowed disabled:opacity-50"
										>
											<Trash2 className="h-3 w-3" aria-hidden="true" />
											Remove
										</button>
									) : null}
								</div>
							</div>

							{isEditing ? (
								<form
									onSubmit={handleSave}
									className="space-y-3 rounded border border-[var(--border)] bg-[var(--bg-subtle)] p-3"
								>
									<div className="flex flex-col gap-2 sm:flex-row sm:items-end">
										<div className="flex-1">
											<label
												htmlFor={`${inputId}-${name}`}
												className="block text-xs font-medium"
											>
												{meta.label} API key
											</label>
											<input
												ref={(el) => {
													inputRefs.current[name] = el;
												}}
												id={`${inputId}-${name}`}
												type="password"
												autoComplete="new-password"
												required
												value={keyDraft}
												onChange={(e) => setKeyDraft(e.target.value)}
												placeholder={`Paste ${meta.label} key`}
												className="font-mono-code mt-1 w-full rounded border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-1.5 text-sm"
											/>
										</div>
										{name === "etherscan" ? (
											<div className="sm:w-44">
												<label
													htmlFor={tierId}
													className="block text-xs font-medium"
												>
													Plan tier
												</label>
												<Select
													id={tierId}
													value={tierDraft}
													onValueChange={(value) =>
														setTierDraft(value as "free" | "paid")
													}
													className="mt-1 w-full"
													tone="surface"
												>
													<SelectItem value="free">Free plan</SelectItem>
													<SelectItem value="paid">Paid plan</SelectItem>
												</Select>
											</div>
										) : null}
										<button
											type="submit"
											disabled={busy || !vaultUnlocked}
											className="rounded bg-[var(--accent)] px-3.5 py-1.5 text-xs font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
										>
											{busy ? "Saving…" : "Save key"}
										</button>
									</div>
									{name === "etherscan" ? (
										<p className="text-xs text-[var(--text-secondary)]">
											A paid Etherscan key covers Base and BNB Chain too.
											{info.keySet
												? " Enter your API key above to save a plan change."
												: ""}
										</p>
									) : null}
								</form>
							) : null}
						</div>
					);
				})}
			</div>

			<ConfirmDialog
				open={Boolean(removeTarget)}
				title={`Remove ${removeTarget ? metaForProvider(removeTarget).label : ""} key?`}
				description="This removes the encrypted provider key from your vault. Existing synced transactions are not affected."
				confirmLabel="Remove key"
				destructive
				busy={busy}
				onConfirm={confirmRemove}
				onCancel={() => setRemoveTarget(null)}
			/>
		</section>
	);
}
