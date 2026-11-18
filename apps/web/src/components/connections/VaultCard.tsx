"use client";

import { KeyRound, Lock, RefreshCw, ShieldAlert, Unlock } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { api, getErrorMessage, type VaultStatus } from "@/lib/client/api";

export function VaultCard({
	vault,
	onChanged,
}: {
	vault: VaultStatus;
	onChanged: (next: VaultStatus, event?: "reset" | "unlock" | "lock") => void;
}) {
	const [passphrase, setPassphrase] = useState("");
	const [confirmPassphrase, setConfirmPassphrase] = useState("");
	const [unlockPassphrase, setUnlockPassphrase] = useState("");

	const [showChangeForm, setShowChangeForm] = useState(false);
	const [currentPass, setCurrentPass] = useState("");
	const [nextPass, setNextPass] = useState("");
	const [confirmNextPass, setConfirmNextPass] = useState("");

	const [resetOpen, setResetOpen] = useState(false);
	const [resetConfirmText, setResetConfirmText] = useState("");

	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);

	const setupPassId = useId();
	const setupConfirmId = useId();
	const unlockPassId = useId();
	const changeCurrentId = useId();
	const changeNextId = useId();
	const changeConfirmId = useId();
	const resetTitleId = useId();
	const resetDescId = useId();
	const resetInputId = useId();

	const resetDialogRef = useRef<HTMLDialogElement>(null);
	const resetOpenerRef = useRef<HTMLElement | null>(null);

	useEffect(() => {
		const el = resetDialogRef.current;
		if (resetOpen) {
			const active = document.activeElement;
			resetOpenerRef.current =
				active instanceof HTMLElement && active !== document.body
					? active
					: null;
			if (el && !el.open) el.showModal();
		} else {
			if (el?.open) el.close();
			const opener = resetOpenerRef.current;
			resetOpenerRef.current = null;
			if (opener?.isConnected) opener.focus();
		}
	}, [resetOpen]);

	async function handleSetup(e: React.FormEvent) {
		e.preventDefault();
		setError(null);
		setNotice(null);
		if (passphrase.length < 12) {
			setError("Passphrase must be at least 12 characters.");
			return;
		}
		if (passphrase !== confirmPassphrase) {
			setError("Passphrases do not match.");
			return;
		}
		const submitted = passphrase;
		setPassphrase("");
		setConfirmPassphrase("");
		setBusy(true);
		try {
			const status = await api.setupVault(submitted);
			setNotice("Vault set up and unlocked.");
			onChanged(status, "unlock");
		} catch (err) {
			setError(getErrorMessage(err));
		} finally {
			setBusy(false);
		}
	}

	async function handleUnlock(e: React.FormEvent) {
		e.preventDefault();
		setError(null);
		setNotice(null);
		if (!unlockPassphrase) {
			setError("Enter your vault passphrase.");
			return;
		}
		const submitted = unlockPassphrase;
		setUnlockPassphrase("");
		setBusy(true);
		try {
			const status = await api.unlockVault(submitted);
			setNotice("Vault unlocked.");
			onChanged(status, "unlock");
		} catch (err) {
			setError(getErrorMessage(err));
		} finally {
			setBusy(false);
		}
	}

	async function handleLock() {
		setError(null);
		setNotice(null);
		setBusy(true);
		try {
			const status = await api.lockVault();
			setShowChangeForm(false);
			setNotice("Vault locked.");
			onChanged(status, "lock");
		} catch (err) {
			setError(getErrorMessage(err));
		} finally {
			setBusy(false);
		}
	}

	async function handleChangePassphrase(e: React.FormEvent) {
		e.preventDefault();
		setError(null);
		setNotice(null);
		if (!currentPass) {
			setError("Enter your current passphrase.");
			return;
		}
		if (nextPass.length < 12) {
			setError("New passphrase must be at least 12 characters.");
			return;
		}
		if (nextPass !== confirmNextPass) {
			setError("New passphrases do not match.");
			return;
		}
		const cur = currentPass;
		const nxt = nextPass;
		setCurrentPass("");
		setNextPass("");
		setConfirmNextPass("");
		setBusy(true);
		try {
			const status = await api.changeVaultPassphrase(cur, nxt);
			setShowChangeForm(false);
			setNotice("Vault passphrase changed and keys re-encrypted.");
			onChanged(status);
		} catch (err) {
			setError(getErrorMessage(err));
		} finally {
			setBusy(false);
		}
	}

	async function handleReset(e: React.FormEvent) {
		e.preventDefault();
		if (resetConfirmText !== "RESET") return;
		setError(null);
		setNotice(null);
		setBusy(true);
		try {
			const status = await api.resetVault("RESET");
			setResetConfirmText("");
			setResetOpen(false);
			setShowChangeForm(false);
			setNotice("Vault reset. All encrypted keys were removed.");
			onChanged(status, "reset");
		} catch (err) {
			setError(getErrorMessage(err));
		} finally {
			setBusy(false);
		}
	}

	return (
		<section className="space-y-4 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-5">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="space-y-1">
					<div className="flex flex-wrap items-center gap-2">
						<KeyRound
							className="h-4 w-4 text-[var(--accent)]"
							aria-hidden="true"
						/>
						<h2 className="text-base font-semibold tracking-tight">
							Secrets Vault
						</h2>
						{!vault.initialized ? (
							<Badge tone="warning">Not set up</Badge>
						) : vault.autoUnlock && vault.unlocked ? (
							<Badge tone="accent">Auto-unlock via env</Badge>
						) : vault.unlocked ? (
							<Badge tone="positive">Unlocked</Badge>
						) : (
							<Badge tone="warning">Locked</Badge>
						)}
					</div>
					<p className="text-xs leading-relaxed text-[var(--text-secondary)]">
						Your exchange and provider keys are encrypted with this passphrase.
						If you forget it, the keys cannot be recovered. You will need to
						create new read-only keys. Your transactions and reports are not
						affected.
					</p>
					{vault.initialized ? (
						<p className="text-[11px] text-[var(--text-muted)]">
							{vault.autoUnlock
								? "SECRETS_PASSPHRASE is configured in the server environment (auto-unlocks on boot)."
								: `Auto-locks after ${vault.idleLockMinutes} minutes idle or on server restart.`}
						</p>
					) : null}
				</div>

				{vault.initialized ? (
					<div className="flex flex-wrap items-center gap-2">
						{vault.unlocked ? (
							<button
								type="button"
								disabled={busy}
								onClick={handleLock}
								className="inline-flex items-center gap-1.5 rounded border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-50"
							>
								<Lock className="h-3.5 w-3.5" aria-hidden="true" />
								Lock vault
							</button>
						) : null}
						<button
							type="button"
							disabled={busy}
							onClick={() => {
								setShowChangeForm((prev) => !prev);
								setError(null);
							}}
							className="inline-flex items-center gap-1.5 rounded border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-50"
						>
							<RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
							Change passphrase
						</button>
						<button
							type="button"
							disabled={busy}
							onClick={() => {
								setResetConfirmText("");
								setError(null);
								setResetOpen(true);
							}}
							className="inline-flex items-center gap-1.5 rounded border border-[var(--loss)]/40 bg-[var(--bg-surface)] px-3 py-1.5 text-xs font-medium text-[var(--loss)] hover:bg-[var(--loss-soft)] disabled:opacity-50"
						>
							<ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
							Reset vault
						</button>
					</div>
				) : null}
			</div>

			{error ? <ErrorBanner message={error} /> : null}
			{notice ? (
				<p
					aria-live="polite"
					className="rounded border border-[var(--positive)]/40 bg-[var(--positive-soft)] px-3 py-2 text-xs text-[var(--positive)]"
				>
					{notice}
				</p>
			) : null}

			{!vault.initialized ? (
				<form
					noValidate
					onSubmit={handleSetup}
					className="grid grid-cols-1 gap-3 border-t border-[var(--border)] pt-4 sm:grid-cols-3 sm:items-end"
				>
					<div>
						<label htmlFor={setupPassId} className="block text-xs font-medium">
							Passphrase (min 12 characters)
						</label>
						<input
							id={setupPassId}
							type="password"
							autoComplete="new-password"
							minLength={12}
							required
							value={passphrase}
							onChange={(e) => setPassphrase(e.target.value)}
							placeholder="At least 12 characters"
							className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--bg-canvas)] px-3 py-1.5 text-sm"
						/>
					</div>
					<div>
						<label
							htmlFor={setupConfirmId}
							className="block text-xs font-medium"
						>
							Confirm passphrase
						</label>
						<input
							id={setupConfirmId}
							type="password"
							autoComplete="new-password"
							minLength={12}
							required
							value={confirmPassphrase}
							onChange={(e) => setConfirmPassphrase(e.target.value)}
							placeholder="Re-enter passphrase"
							className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--bg-canvas)] px-3 py-1.5 text-sm"
						/>
					</div>
					<div>
						<button
							type="submit"
							disabled={busy}
							className="inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-[var(--accent)] px-4 py-1.5 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-50 sm:w-auto"
						>
							<KeyRound className="h-4 w-4" aria-hidden="true" />
							{busy ? "Setting up…" : "Set up vault"}
						</button>
					</div>
				</form>
			) : !vault.unlocked ? (
				<form
					noValidate
					onSubmit={handleUnlock}
					className="flex flex-col gap-3 border-t border-[var(--border)] pt-4 sm:flex-row sm:items-end"
				>
					<div className="flex-1 sm:max-w-xs">
						<label htmlFor={unlockPassId} className="block text-xs font-medium">
							Vault passphrase
						</label>
						<input
							id={unlockPassId}
							type="password"
							autoComplete="off"
							required
							value={unlockPassphrase}
							onChange={(e) => setUnlockPassphrase(e.target.value)}
							placeholder="Enter passphrase to unlock"
							className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--bg-canvas)] px-3 py-1.5 text-sm"
						/>
					</div>
					<button
						type="submit"
						disabled={busy}
						className="inline-flex items-center justify-center gap-1.5 rounded-md bg-[var(--accent)] px-4 py-1.5 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
					>
						<Unlock className="h-4 w-4" aria-hidden="true" />
						{busy ? "Unlocking…" : "Unlock vault"}
					</button>
				</form>
			) : null}

			{vault.initialized && showChangeForm ? (
				<form
					noValidate
					onSubmit={handleChangePassphrase}
					className="grid grid-cols-1 gap-3 rounded-md border border-[var(--border)] bg-[var(--bg-subtle)] p-4 sm:grid-cols-3"
				>
					<div>
						<label
							htmlFor={changeCurrentId}
							className="block text-xs font-medium"
						>
							Current passphrase
						</label>
						<input
							id={changeCurrentId}
							type="password"
							autoComplete="off"
							required
							value={currentPass}
							onChange={(e) => setCurrentPass(e.target.value)}
							className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-1.5 text-sm"
						/>
					</div>
					<div>
						<label htmlFor={changeNextId} className="block text-xs font-medium">
							New passphrase (min 12 chars)
						</label>
						<input
							id={changeNextId}
							type="password"
							autoComplete="new-password"
							minLength={12}
							required
							value={nextPass}
							onChange={(e) => setNextPass(e.target.value)}
							className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-1.5 text-sm"
						/>
					</div>
					<div>
						<label
							htmlFor={changeConfirmId}
							className="block text-xs font-medium"
						>
							Confirm new passphrase
						</label>
						<input
							id={changeConfirmId}
							type="password"
							autoComplete="new-password"
							minLength={12}
							required
							value={confirmNextPass}
							onChange={(e) => setConfirmNextPass(e.target.value)}
							className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-1.5 text-sm"
						/>
					</div>
					<div className="flex justify-end gap-2 sm:col-span-3">
						<button
							type="button"
							disabled={busy}
							onClick={() => {
								setCurrentPass("");
								setNextPass("");
								setConfirmNextPass("");
								setShowChangeForm(false);
							}}
							className="rounded border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs font-medium hover:bg-[var(--bg-hover)]"
						>
							Cancel
						</button>
						<button
							type="submit"
							disabled={busy}
							className="rounded bg-[var(--accent)] px-3.5 py-1.5 text-xs font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
						>
							{busy ? "Updating…" : "Update passphrase"}
						</button>
					</div>
				</form>
			) : null}

			{resetOpen ? (
				<dialog
					ref={resetDialogRef}
					aria-labelledby={resetTitleId}
					aria-describedby={resetDescId}
					onCancel={(e) => {
						e.preventDefault();
						if (!busy) {
							setResetConfirmText("");
							setResetOpen(false);
						}
					}}
					onClick={(e) => {
						if (e.target === resetDialogRef.current && !busy) {
							setResetConfirmText("");
							setResetOpen(false);
						}
					}}
					onKeyDown={(e) => {
						if (e.key === "Escape" && !busy) {
							e.preventDefault();
							setResetConfirmText("");
							setResetOpen(false);
						}
					}}
					className="m-auto w-[calc(100%-2rem)] max-w-md rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-0 text-[var(--text-primary)] shadow-xl"
				>
					<form onSubmit={handleReset} className="p-5">
						<h3 id={resetTitleId} className="text-base font-semibold">
							Reset vault and erase stored keys?
						</h3>
						<p
							id={resetDescId}
							className="mt-2 text-sm text-[var(--text-secondary)]"
						>
							This deletes all encrypted exchange and provider keys from your
							vault. Your connections stay listed without keys, and your
							transactions and reports are not affected.
						</p>
						<div className="mt-4">
							<label
								htmlFor={resetInputId}
								className="block text-xs font-medium"
							>
								Type <code className="font-mono-code font-semibold">RESET</code>{" "}
								to confirm
							</label>
							<input
								id={resetInputId}
								type="text"
								autoComplete="off"
								value={resetConfirmText}
								onChange={(e) => setResetConfirmText(e.target.value)}
								placeholder="RESET"
								className="font-mono-code mt-1 w-full rounded border border-[var(--border)] bg-[var(--bg-canvas)] px-3 py-1.5 text-sm"
							/>
						</div>
						<div className="mt-5 flex justify-end gap-2">
							<button
								type="button"
								disabled={busy}
								onClick={() => {
									setResetConfirmText("");
									setResetOpen(false);
								}}
								className="rounded border border-[var(--border)] bg-[var(--bg-surface)] px-3.5 py-1.5 text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-50"
							>
								Cancel
							</button>
							<button
								type="submit"
								disabled={busy || resetConfirmText !== "RESET"}
								className="rounded bg-[var(--loss-solid)] px-3.5 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
							>
								{busy ? "Resetting…" : "Reset vault"}
							</button>
						</div>
					</form>
				</dialog>
			) : null}
		</section>
	);
}
