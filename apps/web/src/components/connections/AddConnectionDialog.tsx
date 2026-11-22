"use client";

import { AlertTriangle, ExternalLink, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { KeyCheckBanner } from "@/components/connections/KeyCheckBanner";
import { SymbolTagInput } from "@/components/connections/SymbolTagInput";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { Select, SelectItem } from "@/components/ui/Select";
import {
	api,
	type Connection,
	getErrorMessage,
	type KeyCheck,
} from "@/lib/client/api";
import { EVM_CHAINS } from "@/lib/client/chains";

const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

type ConnectionKind = Connection["kind"];

export function AddConnectionDialog({
	open,
	vaultUnlocked,
	onClose,
	onCreated,
}: {
	open: boolean;
	vaultUnlocked: boolean;
	onClose: () => void;
	onCreated: (
		conn: Connection,
		check?: { result?: KeyCheck; error?: string },
	) => void;
}) {
	const [kind, setKind] = useState<ConnectionKind>("binance");
	const [label, setLabel] = useState("");
	const [apiKey, setApiKey] = useState("");
	const [apiSecret, setApiSecret] = useState("");
	const [extraSymbols, setExtraSymbols] = useState<string[]>([]);
	const [address, setAddress] = useState("");
	const [chainId, setChainId] = useState<number>(1);

	const [busy, setBusy] = useState(false);
	const [checking, setChecking] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [savedCheck, setSavedCheck] = useState<{
		conn: Connection;
		result?: KeyCheck;
		error?: string;
	} | null>(null);

	const dialogRef = useRef<HTMLDialogElement>(null);
	const openerRef = useRef<HTMLElement | null>(null);
	const wasOpenRef = useRef(false);

	const titleId = useId();
	const labelId = useId();
	const keyId = useId();
	const secretId = useId();
	const addrId = useId();
	const chainSelectId = useId();

	function resetForm() {
		setLabel("");
		setApiKey("");
		setApiSecret("");
		setExtraSymbols([]);
		setAddress("");
		setChainId(1);
		setError(null);
		setSavedCheck(null);
		setBusy(false);
		setChecking(false);
	}

	useEffect(() => {
		const el = dialogRef.current;
		if (open) {
			if (!wasOpenRef.current) {
				const active = document.activeElement;
				openerRef.current =
					active instanceof HTMLElement && active !== document.body
						? active
						: null;
				wasOpenRef.current = true;
			}
			if (el && !el.open) el.showModal();
		} else {
			if (el?.open) el.close();
			if (wasOpenRef.current) {
				wasOpenRef.current = false;
				const opener = openerRef.current;
				openerRef.current = null;
				if (opener?.isConnected) opener.focus();
			}
		}
	}, [open]);

	function handleClose() {
		if (busy || checking) return;
		resetForm();
		onClose();
	}

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		setError(null);

		const trimmedLabel = label.trim();
		if (!trimmedLabel) {
			setError("Enter a connection label.");
			return;
		}

		if (kind === "evm") {
			const trimmedAddr = address.trim();
			if (!EVM_ADDRESS_RE.test(trimmedAddr)) {
				setError(
					"Enter a valid EVM address starting with 0x followed by 40 hex characters.",
				);
				return;
			}
			setBusy(true);
			try {
				const created = await api.createConnection({
					kind: "evm",
					label: trimmedLabel,
					address: trimmedAddr.toLowerCase(),
					chainId,
				});
				onCreated(created);
				resetForm();
				onClose();
			} catch (err) {
				setError(getErrorMessage(err));
			} finally {
				setBusy(false);
			}
			return;
		}

		if (!vaultUnlocked) {
			setError("Unlock the vault before saving exchange API keys.");
			return;
		}
		const trimmedKey = apiKey.trim();
		const trimmedSecret = apiSecret.trim();
		if (!trimmedKey || !trimmedSecret) {
			setError("Both API key and API secret are required.");
			return;
		}

		// Clear secrets from state before async calls
		setApiKey("");
		setApiSecret("");
		setBusy(true);

		let created: Connection;
		try {
			created = await api.createConnection({
				kind,
				label: trimmedLabel,
				apiKey: trimmedKey,
				apiSecret: trimmedSecret,
				...(kind === "binance" && extraSymbols.length > 0
					? { options: { extraSymbols } }
					: {}),
			});
		} catch (err) {
			setError(getErrorMessage(err));
			setBusy(false);
			return;
		}

		setBusy(false);
		setChecking(true);
		try {
			const checkResult = await api.checkConnection(created.id);
			setSavedCheck({ conn: created, result: checkResult });
			onCreated(created, { result: checkResult });
		} catch (err) {
			const checkError = getErrorMessage(err);
			setSavedCheck({ conn: created, error: checkError });
			onCreated(created, { error: checkError });
		} finally {
			setChecking(false);
		}
	}

	if (!open) return null;

	const needsVault = kind !== "evm" && !vaultUnlocked;

	return (
		<dialog
			ref={dialogRef}
			aria-labelledby={titleId}
			onCancel={(e) => {
				e.preventDefault();
				handleClose();
			}}
			onClick={(e) => {
				if (e.target === dialogRef.current) handleClose();
			}}
			onKeyDown={(e) => {
				if (e.key === "Escape") {
					e.preventDefault();
					handleClose();
				}
			}}
			className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-0 text-[var(--text-primary)] shadow-xl"
		>
			<div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
				<h2 id={titleId} className="text-base font-semibold tracking-tight">
					Add Connection
				</h2>
				<button
					type="button"
					onClick={handleClose}
					disabled={busy || checking}
					aria-label="Close dialog"
					className="rounded p-1 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-50"
				>
					<X className="h-4 w-4" aria-hidden="true" />
				</button>
			</div>

			{savedCheck ? (
				<div className="space-y-4 p-5 text-sm">
					<p className="text-xs text-[var(--text-secondary)]">
						Saved connection{" "}
						<strong className="text-[var(--text-primary)]">
							{savedCheck.conn.label}
						</strong>
						. Automatic key permission check result:
					</p>
					<KeyCheckBanner result={savedCheck.result} error={savedCheck.error} />
					<div className="flex justify-end pt-2">
						<button
							type="button"
							onClick={handleClose}
							className="rounded-md bg-[var(--accent)] px-4 py-1.5 text-sm font-medium text-white hover:bg-[var(--accent-hover)]"
						>
							Done
						</button>
					</div>
				</div>
			) : (
				<form onSubmit={handleSubmit} className="space-y-4 p-5">
					{/* Kind selector */}
					<fieldset className="space-y-1.5">
						<legend className="text-xs font-medium text-[var(--text-secondary)]">
							Connection type
						</legend>
						<div className="grid grid-cols-3 gap-2">
							{(
								[
									{ id: "binance", label: "Binance" },
									{ id: "coindcx", label: "CoinDCX" },
									{ id: "evm", label: "EVM address" },
								] as const
							).map((opt) => (
								<button
									key={opt.id}
									type="button"
									aria-pressed={kind === opt.id}
									onClick={() => {
										setKind(opt.id);
										setError(null);
									}}
									className={`rounded-md border px-3 py-2 text-xs font-medium transition-colors ${
										kind === opt.id
											? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-text)]"
											: "border-[var(--border)] bg-[var(--bg-canvas)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
									}`}
								>
									{opt.label}
								</button>
							))}
						</div>
					</fieldset>

					{error ? <ErrorBanner message={error} /> : null}

					{needsVault ? (
						<div className="rounded-md border border-[var(--warning)]/40 bg-[var(--warning-soft)] px-3 py-2 text-xs text-[var(--text-primary)]">
							<strong className="font-semibold text-[var(--warning)]">
								Vault locked:
							</strong>{" "}
							Unlock the vault first to encrypt and save exchange API keys.
						</div>
					) : null}

					{kind === "binance" ? (
						<div className="space-y-1 rounded-md border border-[var(--border)] bg-[var(--bg-subtle)] p-3 text-xs">
							<p className="font-semibold text-[var(--text-primary)]">
								Create a read-only key
							</p>
							<p className="text-[var(--text-secondary)]">
								API Management → Create API → System generated → enable only{" "}
								<strong>Enable Reading</strong>. Leave trading and withdrawals
								off.
							</p>
							<a
								href="https://www.binance.com/en/my/settings/api-management"
								target="_blank"
								rel="noopener noreferrer"
								className="inline-flex items-center gap-1 pt-0.5 font-medium text-[var(--accent-text)] hover:underline"
							>
								Open Binance API Management
								<ExternalLink className="h-3 w-3" aria-hidden="true" />
							</a>
						</div>
					) : null}

					{kind === "coindcx" ? (
						<div className="space-y-2 rounded-md border border-[var(--warning)]/40 bg-[var(--warning-soft)] p-3 text-xs">
							<p className="flex items-center gap-1.5 font-semibold text-[var(--warning)]">
								<AlertTriangle
									className="h-3.5 w-3.5 shrink-0"
									aria-hidden="true"
								/>
								Create a read-only key (Spot Orderbook only — CoinDCX API
								limits)
							</p>
							<p className="text-[var(--text-primary)]">
								CoinDCX keys cannot be limited to read-only. Turn on IP binding
								if you can, and use a sub-account.
							</p>
							<p className="text-[var(--text-primary)]">
								<strong>API sync imports Spot Orderbook trades only.</strong> It
								does not sync <strong>Instant Buy/Sell orders</strong>,{" "}
								<strong>crypto deposits/withdrawals</strong>,{" "}
								<strong>Earn/SIP</strong>, or <strong>TDS / Form 16A</strong>,
								and CoinDCX fees are reported without fee currency or GST split.
								Pair API sync with CoinDCX file exports (Instant/Spot XLSX +
								Form 16A PDF) on{" "}
								<Link
									href="/import"
									onClick={handleClose}
									className="font-medium text-[var(--accent-text)] underline"
								>
									Import
								</Link>
								.
							</p>
							<a
								href="https://coindcx.com/api-dashboard"
								target="_blank"
								rel="noopener noreferrer"
								className="inline-flex items-center gap-1 font-medium text-[var(--accent-text)] hover:underline"
							>
								Open CoinDCX API Dashboard
								<ExternalLink className="h-3 w-3" aria-hidden="true" />
							</a>
						</div>
					) : null}

					<div>
						<label htmlFor={labelId} className="block text-xs font-medium">
							Label
						</label>
						<input
							id={labelId}
							type="text"
							required
							value={label}
							onChange={(e) => setLabel(e.target.value)}
							placeholder={
								kind === "binance"
									? "e.g. Binance Main"
									: kind === "coindcx"
										? "e.g. CoinDCX Main"
										: "e.g. Hardware Wallet"
							}
							className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--bg-canvas)] px-3 py-1.5 text-sm"
						/>
					</div>

					{kind === "evm" ? (
						<>
							<div>
								<label htmlFor={addrId} className="block text-xs font-medium">
									Wallet address
								</label>
								<input
									id={addrId}
									type="text"
									required
									value={address}
									onChange={(e) => setAddress(e.target.value)}
									placeholder="0x1234…abcd"
									className="font-mono-code mt-1 w-full rounded border border-[var(--border)] bg-[var(--bg-canvas)] px-3 py-1.5 text-sm"
								/>
							</div>

							<div>
								<label
									htmlFor={chainSelectId}
									className="block text-xs font-medium"
								>
									Chain
								</label>
								<Select
									id={chainSelectId}
									value={String(chainId)}
									onValueChange={(value) => setChainId(Number(value))}
									className="mt-1 w-full"
								>
									{EVM_CHAINS.map((c) => (
										<SelectItem key={c.chainId} value={String(c.chainId)}>
											{c.name} ({c.chainId})
										</SelectItem>
									))}
								</Select>
								<p className="mt-1 text-xs text-[var(--text-muted)]">
									Base needs a free Alchemy key, and BNB Chain a free NodeReal
									key (or a paid Etherscan key).
								</p>
							</div>
						</>
					) : (
						<>
							<div>
								<label htmlFor={keyId} className="block text-xs font-medium">
									API key
								</label>
								<input
									id={keyId}
									type="password"
									autoComplete="new-password"
									required
									value={apiKey}
									onChange={(e) => setApiKey(e.target.value)}
									placeholder="Paste API key"
									className="font-mono-code mt-1 w-full rounded border border-[var(--border)] bg-[var(--bg-canvas)] px-3 py-1.5 text-sm"
								/>
							</div>

							<div>
								<label htmlFor={secretId} className="block text-xs font-medium">
									API secret
								</label>
								<input
									id={secretId}
									type="password"
									autoComplete="new-password"
									required
									value={apiSecret}
									onChange={(e) => setApiSecret(e.target.value)}
									placeholder="Paste API secret"
									className="font-mono-code mt-1 w-full rounded border border-[var(--border)] bg-[var(--bg-canvas)] px-3 py-1.5 text-sm"
								/>
							</div>

							{kind === "binance" ? (
								<SymbolTagInput
									symbols={extraSymbols}
									onChange={setExtraSymbols}
									disabled={busy || checking}
								/>
							) : null}
						</>
					)}

					<div className="flex justify-end gap-2 border-t border-[var(--border)] pt-3">
						<button
							type="button"
							disabled={busy || checking}
							onClick={handleClose}
							className="rounded border border-[var(--border)] bg-[var(--bg-surface)] px-3.5 py-1.5 text-sm font-medium hover:bg-[var(--bg-hover)] disabled:opacity-50"
						>
							Cancel
						</button>
						<button
							type="submit"
							disabled={busy || checking || needsVault}
							className="rounded-md bg-[var(--accent)] px-4 py-1.5 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
						>
							{busy
								? "Saving…"
								: checking
									? "Checking key…"
									: "Save connection"}
						</button>
					</div>
				</form>
			)}
		</dialog>
	);
}
