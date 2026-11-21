"use client";

import { useId } from "react";
import type { TaxYearInfo } from "@/lib/client/api";
import { Select, type SelectOption } from "./Select";

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

const LAYOUTS = {
	header: {
		wrapper: "flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-2",
		trigger: "w-full sm:w-auto sm:min-w-48",
	},
	stacked: { wrapper: "flex flex-col gap-1", trigger: "w-full" },
} as const;

export function TaxYearSelect({
	value,
	onChange,
	taxYears = FALLBACK_TAX_YEARS,
	includeAllOption = false,
	label = "Tax year",
	layout = "header",
	className = "",
}: {
	value: string;
	onChange: (value: string) => void;
	taxYears?: TaxYearInfo[];
	includeAllOption?: boolean;
	label?: string;
	layout?: keyof typeof LAYOUTS;
	className?: string;
}) {
	const id = useId();
	const years = taxYears.length > 0 ? taxYears : FALLBACK_TAX_YEARS;
	const options: SelectOption[] = [
		...(includeAllOption ? [{ value: "", label: "All years" }] : []),
		...years.map((ty) => ({
			value: ty.id,
			label: `${ty.id} (${ty.act.includes("2025") ? "2025 Act" : "1961 Act"})`,
		})),
	];
	const styles = LAYOUTS[layout];

	return (
		<div className={`${styles.wrapper} ${className}`}>
			<label
				htmlFor={id}
				className="text-xs font-medium whitespace-nowrap text-[var(--text-secondary)]"
			>
				{label}
			</label>
			<Select
				id={id}
				value={value}
				onValueChange={onChange}
				options={options}
				tone={layout === "header" ? "surface" : "field"}
				className={`font-medium ${styles.trigger}`}
			/>
		</div>
	);
}
