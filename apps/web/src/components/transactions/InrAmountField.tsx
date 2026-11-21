"use client";

import { AlertTriangle } from "lucide-react";
import type { ReactNode } from "react";
import {
	describeOtherValue,
	type InrEntryMode,
	implausibleCostWarning,
	type PriceReference,
} from "@/lib/client/inr-cost";

const MODES: readonly { id: InrEntryMode; label: string }[] = [
	{ id: "total", label: "Total" },
	{ id: "perUnit", label: "Per unit" },
];

/**
 * An INR amount typed either as the row's total or as the price of one unit.
 * The other reading is always shown; the stored value is always the total.
 */
export function InrAmountField({
	id,
	totalLabel,
	perUnitLabel,
	mode,
	onModeChange,
	text,
	onTextChange,
	quantity,
	asset,
	reference,
	required,
	error,
	hint,
	placeholder,
	perUnitAvailable = true,
}: {
	id: string;
	totalLabel: string;
	perUnitLabel: string;
	mode: InrEntryMode;
	onModeChange: (mode: InrEntryMode) => void;
	text: string;
	onTextChange: (text: string) => void;
	quantity: string | undefined;
	asset: string;
	reference: PriceReference | null;
	required?: boolean;
	error?: string | null;
	hint?: ReactNode;
	placeholder?: string;
	/** False when the row has no quantity to price, e.g. a fee-only row. */
	perUnitAvailable?: boolean;
}) {
	const other = describeOtherValue(mode, text, quantity, asset);
	const warning = implausibleCostWarning(
		mode,
		text,
		quantity,
		asset,
		reference,
	);
	const describedBy = [
		other ? `${id}-other` : null,
		warning ? `${id}-warning` : null,
		hint ? `${id}-hint` : null,
		error ? `${id}-error` : null,
	]
		.filter(Boolean)
		.join(" ");

	return (
		<div>
			<div className="flex flex-wrap items-end justify-between gap-x-2 gap-y-1">
				<label
					htmlFor={id}
					className="block text-xs font-medium text-[var(--text-secondary)]"
				>
					{mode === "total" ? totalLabel : perUnitLabel}
				</label>
				{perUnitAvailable ? (
					<fieldset className="inline-flex rounded border border-[var(--border)] p-0.5 text-[11px]">
						<legend className="sr-only">Amount entered as</legend>
						{MODES.map((option) => (
							<label
								key={option.id}
								className="cursor-pointer rounded px-2 py-0.5 font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] has-checked:bg-[var(--accent-soft)] has-checked:text-[var(--accent-text)] has-focus-visible:outline-2 has-focus-visible:outline-[var(--accent)]"
							>
								<input
									type="radio"
									name={`${id}-mode`}
									value={option.id}
									checked={mode === option.id}
									onChange={() => onModeChange(option.id)}
									className="sr-only"
								/>
								{option.label}
							</label>
						))}
					</fieldset>
				) : null}
			</div>
			<input
				id={id}
				type="text"
				inputMode="decimal"
				required={required}
				placeholder={placeholder}
				value={text}
				aria-invalid={Boolean(error)}
				aria-describedby={describedBy || undefined}
				onChange={(e) => onTextChange(e.target.value)}
				className={`num mt-1 w-full rounded border ${error ? "border-[var(--loss)]" : "border-[var(--border)]"} bg-[var(--bg-canvas)] px-2.5 py-1.5 text-sm`}
			/>
			{other ? (
				<p
					id={`${id}-other`}
					className="num mt-1 text-xs font-medium text-[var(--text-primary)]"
				>
					{other}
				</p>
			) : null}
			<div aria-live="polite">
				{warning ? (
					<p
						id={`${id}-warning`}
						className="mt-1 flex gap-1.5 rounded border border-[var(--warning)]/40 bg-[var(--warning-soft)] px-2 py-1.5 text-xs text-[var(--text-primary)]"
					>
						<AlertTriangle
							className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--warning)]"
							aria-hidden="true"
						/>
						<span>{warning}</span>
					</p>
				) : null}
			</div>
			{error ? (
				<p id={`${id}-error`} className="mt-1 text-xs text-[var(--loss)]">
					{error}
				</p>
			) : null}
			{hint ? (
				<p
					id={`${id}-hint`}
					className="mt-1 text-[11px] text-[var(--text-muted)]"
				>
					{hint}
				</p>
			) : null}
		</div>
	);
}
