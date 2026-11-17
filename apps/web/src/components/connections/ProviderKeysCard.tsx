"use client";

import { ExternalLink, Key, Trash2 } from "lucide-react";
import { useId, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
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
			"Ethereum mainnet, Arbitrum, and Polygon history (and BNB Chain on paid tiers).",
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
			"EVM transaction and token balance lookups (needed for Base and fast mainnet/L2 sync).",
		keyUrl: "https://dashboard.alchemy.com/",
		keyLinkLabel: "Get free key",
	},
	nodereal: {
		label: "NodeReal",
		purpose: "BNB Smart Chain (BSC) transaction and token transfer history.",
		keyUrl: "https://nodereal.io/",
		keyLinkLabel: "Get free key",
	},
};

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
	onUpdated,
}: {
	providers: ProvidersMap;
	vaultUnlocked: boolean;
	onUpdated: (next: ProvidersMap) => void;
}) {
	const [editingProvider, setEditingProvider] = useState<string | null>(null);
	const [keyDraft, setKeyDraft] = useState("");
	const [removeTarget, setRemoveTarget] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const inputId = useId();

	const entries = Object.entries(providers);

	async function handleSave(e: React.FormEvent) {
		e.preventDefault();
		if (!editingProvider) return;
		const trimmed = keyDraft.trim();
		if (!trimmed) {
			setError("Enter an API key.");
			return;
		}
		const target = editingProvider;
		setKeyDraft("");
		setError(null);
		setBusy(true);
		try {
			const next = await api.putProvider(target, trimmed);
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
		<section className="space-y-4 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-5">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<div>
					<h2 className="text-base font-semibold tracking-tight">
						Provider API Keys
					</h2>
					<p className="text-xs text-[var(--text-secondary)]">
						Used only when you sync an EVM wallet or run a CoinGecko price
						lookup.
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
						<div key={name} className="space-y-3 p-4">
							<div className="flex flex-wrap items-start justify-between gap-3">
								<div className="min-w-0 flex-1 space-y-1">
									<div className="flex flex-wrap items-center gap-2">
										<span className="text-sm font-semibold">{meta.label}</span>
										<Badge tone={info.keySet ? "positive" : "neutral"}>
											{info.keySet ? "Key set" : "Not set"}
										</Badge>
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
										type="button"
										disabled={!vaultUnlocked || busy}
										onClick={() => {
											setError(null);
											setKeyDraft("");
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
									className="flex flex-col gap-2 rounded border border-[var(--border)] bg-[var(--bg-subtle)] p-3 sm:flex-row sm:items-end"
								>
									<div className="flex-1">
										<label
											htmlFor={`${inputId}-${name}`}
											className="block text-xs font-medium"
										>
											{meta.label} API key
										</label>
										<input
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
									<button
										type="submit"
										disabled={busy || !vaultUnlocked}
										className="rounded bg-[var(--accent)] px-3.5 py-1.5 text-xs font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
									>
										{busy ? "Saving…" : "Save key"}
									</button>
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
