"use client";

import { useId } from "react";
import type { TaxYearInfo } from "@/lib/client/api";

export const FALLBACK_TAX_YEARS: TaxYearInfo[] = [
	{
		id: "2026-27",
		act: "Income-tax Act, 2025",
		start: "2026-04-01",
		end: "2027-03-31",
	},
	{
		id: "2025-26",
		act: "Income-tax Act, 1961",
		start: "2025-04-01",
		end: "2026-03-31",
	},
];

export function TaxYearSelect({
	value,
	onChange,
	taxYears = FALLBACK_TAX_YEARS,
	includeAllOption = false,
	label = "Tax year",
	className = "",
}: {
	value: string;
	onChange: (value: string) => void;
	taxYears?: TaxYearInfo[];
	includeAllOption?: boolean;
	label?: string;
	className?: string;
}) {
	const id = useId();
	const options = taxYears.length > 0 ? taxYears : FALLBACK_TAX_YEARS;

	return (
		<div className={`flex items-center gap-2 ${className}`}>
			<label
				htmlFor={id}
				className="text-xs font-medium whitespace-nowrap text-[var(--text-secondary)]"
			>
				{label}
			</label>
			<select
				id={id}
				value={value}
				onChange={(e) => onChange(e.target.value)}
				className="rounded border border-[var(--border)] bg-[var(--bg-surface)] px-2.5 py-1.5 text-sm font-medium text-[var(--text-primary)] hover:border-[var(--border-strong)]"
			>
				{includeAllOption ? <option value="">All years</option> : null}
				{options.map((ty) => (
					<option key={ty.id} value={ty.id}>
						{ty.id} ({ty.act.includes("2025") ? "2025 Act" : "1961 Act"})
					</option>
				))}
			</select>
		</div>
	);
}
