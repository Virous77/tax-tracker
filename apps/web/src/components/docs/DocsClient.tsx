"use client";

import { DISCLAIMER } from "@tax/core";
import { BookOpen } from "lucide-react";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Select } from "@/components/ui/Select";
import { CryptoSection } from "./CryptoSection";
import type { DocsYear } from "./docs-data";
import { IndianMarketSection } from "./IndianMarketSection";
import { OverviewSection } from "./OverviewSection";
import { ReferenceSection } from "./ReferenceSection";
import { UsStocksSection } from "./UsStocksSection";

const SECTIONS = [
	{ id: "overview", label: "Overview & quick start" },
	{ id: "crypto", label: "Crypto / VDA" },
	{ id: "us-stocks", label: "US Stocks" },
	{ id: "indian-market", label: "Indian market & ITR" },
	{ id: "reference", label: "Settings & reference" },
] as const;

export function DocsClient({
	years,
}: {
	years: readonly [DocsYear, ...DocsYear[]];
}) {
	const [taxYear, setTaxYear] = useState(years[0].vda.taxYear);
	const [activeSection, setActiveSection] = useState<string>("overview");
	const selected = years.find(({ vda }) => vda.taxYear === taxYear) ?? years[0];

	useEffect(() => {
		const updateHash = () => {
			const id = window.location.hash.slice(1);
			if (SECTIONS.some((section) => section.id === id)) setActiveSection(id);
		};
		updateHash();
		window.addEventListener("hashchange", updateHash);
		const observer = new IntersectionObserver(
			(entries) => {
				const visible = entries.find((entry) => entry.isIntersecting);
				if (visible) setActiveSection(visible.target.id);
			},
			{ rootMargin: "-15% 0px -65% 0px" },
		);
		for (const section of SECTIONS) {
			const element = document.getElementById(section.id);
			if (element) observer.observe(element);
		}
		return () => {
			observer.disconnect();
			window.removeEventListener("hashchange", updateHash);
		};
	}, []);

	function jumpTo(id: string) {
		setActiveSection(id);
		window.location.hash = id;
		document.getElementById(`${id}-title`)?.focus({ preventScroll: true });
	}

	return (
		<div className="space-y-6">
			<div className="space-y-4">
				<PageHeader
					title="Documentation & Tax Calculation Guide"
					description="Understand the numbers. Review the assumptions. Prepare your workpapers."
					eyebrow={
						<div className="mb-2 flex items-center gap-2 text-xs font-medium text-[var(--accent-text)]">
							<BookOpen className="h-4 w-4" aria-hidden="true" />
							Tax Tracker handbook
						</div>
					}
					actions={
						<fieldset className="space-y-2">
							<legend className="text-xs font-medium text-[var(--text-secondary)]">
								Tax year for this guide
							</legend>
							<div className="inline-flex gap-1 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-1">
								{years.map(({ vda }) => (
									<button
										key={vda.taxYear}
										type="button"
										aria-pressed={taxYear === vda.taxYear}
										onClick={() => setTaxYear(vda.taxYear)}
										className={`num rounded-md px-3 py-2 text-xs font-medium ${taxYear === vda.taxYear ? "bg-[var(--accent-soft)] text-[var(--accent-text)]" : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"}`}
									>
										{vda.taxYear}
									</button>
								))}
							</div>
						</fieldset>
					}
				/>
				<p className="rounded-lg border border-[var(--border)] bg-[var(--warning-soft)] px-4 py-3 text-sm font-medium text-[var(--warning)]">
					{DISCLAIMER}
				</p>
				<p aria-live="polite" className="num text-xs text-[var(--text-muted)]">
					Showing {selected.vda.taxYear} · {selected.vda.act} · Schedule FA CY{" "}
					{selected.equity.scheduleFaCalendarYear}. This switch changes the
					guide only; your saved workspace settings stay independent.
				</p>
			</div>
			<div className="grid items-start gap-8 xl:grid-cols-[13rem_minmax(0,1fr)]">
				<div className="xl:sticky xl:top-6">
					<nav
						aria-label="Documentation sections"
						className="hidden space-y-1 xl:block"
					>
						<p className="mb-3 px-3 text-xs font-semibold tracking-wide text-[var(--text-muted)] uppercase">
							In this guide
						</p>
						{SECTIONS.map((section, index) => (
							<a
								key={section.id}
								href={`#${section.id}`}
								onClick={() => setActiveSection(section.id)}
								aria-current={
									activeSection === section.id ? "location" : undefined
								}
								className={`flex items-start gap-3 rounded-md px-3 py-2.5 text-sm ${activeSection === section.id ? "bg-[var(--accent-soft)] font-medium text-[var(--accent-text)]" : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"}`}
							>
								<span className="num text-xs leading-5">0{index + 1}</span>
								{section.label}
							</a>
						))}
					</nav>
					<div className="xl:hidden">
						<Select
							aria-label="Jump to documentation section"
							value={activeSection}
							onValueChange={jumpTo}
							options={SECTIONS.map((section) => ({
								value: section.id,
								label: section.label,
							}))}
							className="w-full"
						/>
					</div>
				</div>
				<div className="min-w-0 space-y-10 text-sm leading-7 text-[var(--text-secondary)]">
					<OverviewSection {...selected} />
					<CryptoSection rules={selected.vda} />
					<UsStocksSection rules={selected.equity} />
					<IndianMarketSection years={years} selected={selected} />
					<ReferenceSection rules={selected.vda} />
					<a
						href="#overview"
						className="inline-block text-xs font-medium text-[var(--accent-text)] hover:underline"
					>
						Back to overview ↑
					</a>
				</div>
			</div>
		</div>
	);
}
