"use client";

import { Plus, X } from "lucide-react";
import { useId, useState } from "react";

const SYMBOL_RE = /^[A-Z0-9]+$/;

export function SymbolTagInput({
	symbols,
	onChange,
	disabled = false,
}: {
	symbols: string[];
	onChange: (next: string[]) => void;
	disabled?: boolean;
}) {
	const [draft, setDraft] = useState("");
	const [error, setError] = useState<string | null>(null);
	const inputId = useId();

	function addDraft() {
		const parts = draft
			.split(/[\s,]+/)
			.map((s) => s.trim().toUpperCase())
			.filter(Boolean);
		if (parts.length === 0) return;

		for (const sym of parts) {
			if (!SYMBOL_RE.test(sym) || sym.length < 3) {
				setError(
					`"${sym}" is not valid. Use uppercase letters/digits like BTCUSDT.`,
				);
				return;
			}
		}

		const next = [...symbols];
		for (const sym of parts) {
			if (!next.includes(sym)) next.push(sym);
		}
		onChange(next);
		setDraft("");
		setError(null);
	}

	function removeSymbol(sym: string) {
		onChange(symbols.filter((item) => item !== sym));
	}

	return (
		<div className="space-y-2">
			<label htmlFor={inputId} className="block text-xs font-medium">
				Extra trading pairs (optional)
			</label>
			<div className="flex gap-2">
				<input
					id={inputId}
					type="text"
					disabled={disabled}
					value={draft}
					onChange={(e) => {
						setDraft(e.target.value.toUpperCase());
						setError(null);
					}}
					onKeyDown={(e) => {
						if (e.key === "Enter") {
							e.preventDefault();
							addDraft();
						}
					}}
					placeholder="e.g. BTCUSDT"
					className="font-mono-code min-w-0 flex-1 rounded border border-[var(--border)] bg-[var(--bg-canvas)] px-3 py-1.5 text-sm uppercase"
				/>
				<button
					type="button"
					disabled={disabled || !draft.trim()}
					onClick={addDraft}
					className="inline-flex items-center gap-1 rounded border border-[var(--border)] bg-[var(--bg-subtle)] px-3 py-1.5 text-xs font-medium hover:bg-[var(--bg-hover)] disabled:opacity-50"
				>
					<Plus className="h-3.5 w-3.5" aria-hidden="true" />
					Add
				</button>
			</div>
			{error ? <p className="text-xs text-[var(--loss)]">{error}</p> : null}
			{symbols.length > 0 ? (
				<div className="flex flex-wrap gap-1.5">
					{symbols.map((sym) => (
						<span
							key={sym}
							className="font-mono-code inline-flex items-center gap-1 rounded border border-[var(--border)] bg-[var(--bg-subtle)] px-2 py-0.5 text-xs font-medium"
						>
							{sym}
							<button
								type="button"
								disabled={disabled}
								onClick={() => removeSymbol(sym)}
								aria-label={`Remove ${sym}`}
								className="rounded p-0.5 text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
							>
								<X className="h-3 w-3" aria-hidden="true" />
							</button>
						</span>
					))}
				</div>
			) : (
				<p className="text-[11px] text-[var(--text-muted)]">
					Add extra pairs (like BTCUSDT or ETHINR) if Binance history omits
					older quote markets.
				</p>
			)}
		</div>
	);
}
