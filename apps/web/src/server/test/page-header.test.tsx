import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { PageHeader } from "@/components/ui/PageHeader";
import { TaxYearSelect } from "@/components/ui/TaxYearSelect";

it("renders a single heading and keeps descriptive content and actions in reading order", () => {
	const html = renderToStaticMarkup(
		<PageHeader
			title="Transactions"
			description="Review ledger entries."
			eyebrow={<span>Workspace</span>}
			actions={
				<button type="button" aria-label="Add manual entry">
					Add
				</button>
			}
		/>,
	);
	expect(html).toMatch(
		/<header[^>]*>.*Workspace.*<h1[^>]*>Transactions<\/h1>.*<p[^>]*>Review ledger entries\.<\/p>.*<button[^>]*aria-label="Add manual entry"/,
	);
	expect(html.match(/<h1/g)).toHaveLength(1);
});

it("supports a heading without optional content", () => {
	const html = renderToStaticMarkup(<PageHeader title="Settings" />);
	expect(html).toMatch(/<h1[^>]*>Settings<\/h1>/);
	expect(html).not.toContain("<p");
	expect(html).not.toContain("<button");
});

it("aligns the stacked tax-year trigger with adjacent header actions", () => {
	const html = renderToStaticMarkup(
		<PageHeader
			title="Report"
			actions={
				<>
					<TaxYearSelect value="2026-27" onChange={() => undefined} />
					<button type="button" className="h-9 whitespace-nowrap">
						Compute report
					</button>
				</>
			}
		/>,
	);
	expect(html).toMatch(
		/<div class="[^"]*\bitems-end\b[^"]*\bsm:items-center\b[^"]*">\s*<div class="[^"]*\bflex-col\b[^"]*\bsm:flex-row\b/,
	);
	expect(html).toMatch(/<button[^>]*role="combobox"[^>]*class="[^"]*\bh-9\b/);
});
