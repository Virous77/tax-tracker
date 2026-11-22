import type { UsEquityRules, VdaRules } from "@tax/rules";
import Link from "next/link";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/Badge";
import { type ReferenceRow, statutoryReferences } from "./docs-data";

export function DocSection({
	id,
	title,
	intro,
	children,
}: {
	id: string;
	title: string;
	intro: string;
	children: ReactNode;
}) {
	return (
		<section
			id={id}
			aria-labelledby={`${id}-title`}
			className="scroll-mt-24 space-y-6 border-t border-[var(--border)] pt-8 first:border-t-0 first:pt-0"
		>
			<header className="space-y-2">
				<h2
					id={`${id}-title`}
					tabIndex={-1}
					className="text-xl font-semibold tracking-tight text-[var(--text-primary)]"
				>
					{title}
				</h2>
				<p>{intro}</p>
			</header>
			{children}
		</section>
	);
}
export function Topic({
	title,
	children,
}: {
	title: string;
	children: ReactNode;
}) {
	return (
		<div className="space-y-2">
			<h3 className="text-base font-semibold text-[var(--text-primary)]">
				{title}
			</h3>
			{children}
		</div>
	);
}
export function Callout({
	title,
	children,
}: {
	title: string;
	children: ReactNode;
}) {
	return (
		<aside className="space-y-2 rounded-lg border border-[var(--border)] bg-[var(--warning-soft)] p-4 text-[var(--warning)]">
			<p className="font-semibold">{title}</p>
			{children}
		</aside>
	);
}
export function DocLink({
	href,
	children,
}: {
	href: string;
	children: ReactNode;
}) {
	return (
		<Link
			href={href}
			className="font-medium text-[var(--accent-text)] underline decoration-[var(--border-strong)] underline-offset-4 hover:decoration-current"
		>
			{children}
		</Link>
	);
}
export function ReferenceTable({
	caption,
	rows,
	headers = ["Item", "Details"],
}: {
	caption: string;
	rows: readonly ReferenceRow[];
	headers?: readonly [string, string];
}) {
	return (
		<div className="overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--bg-surface)]">
			<table className="w-full text-left text-sm">
				<caption className="border-b border-[var(--border)] px-4 py-3 text-left font-semibold text-[var(--text-primary)]">
					{caption}
				</caption>
				<thead className="bg-[var(--bg-subtle)] text-xs text-[var(--text-muted)]">
					<tr>
						{headers.map((label) => (
							<th key={label} scope="col" className="px-4 py-2 font-medium">
								{label}
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					{rows.map(([label, value]) => (
						<tr
							key={label}
							className="border-t border-[var(--border)] align-top"
						>
							<th
								scope="row"
								className="w-2/5 min-w-40 px-4 py-3 font-medium break-words text-[var(--text-primary)]"
							>
								{label}
							</th>
							<td className="num px-4 py-3 break-words">{value}</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}
export function RuleCitations({ rules }: { rules: VdaRules | UsEquityRules }) {
	return (
		<div className="space-y-3">
			{rules.sectionsVerified === false ? (
				<div className="space-y-2">
					<Badge tone="warning">Pending CA verification</Badge>
					<p className="text-xs">
						Section numbers pending CA verification. These are the labels
						bundled with the selected tax year; confirm their applicability
						before filing.
					</p>
				</div>
			) : null}
			<ReferenceTable
				caption={`Statutory references · ${rules.taxYear}`}
				rows={statutoryReferences(rules)}
			/>
			<p className="text-xs">
				Rule-file sources:{" "}
				{rules.sources.map((url, i) => (
					<span key={url}>
						{i > 0 ? " · " : ""}
						<a
							href={url}
							target="_blank"
							rel="noreferrer"
							className="text-[var(--accent-text)] underline"
						>
							{new URL(url).hostname}
						</a>
					</span>
				))}
			</p>
		</div>
	);
}
export function Playbook({ children }: { children: ReactNode }) {
	return (
		<ol className="list-decimal space-y-4 pl-5 marker:font-semibold marker:text-[var(--accent-text)]">
			{children}
		</ol>
	);
}
