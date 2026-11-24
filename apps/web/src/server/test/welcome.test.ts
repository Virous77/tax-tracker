import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { D, DISCLAIMER, formatInr } from "@tax/core";
import { loadRules } from "@tax/rules";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import WelcomePage from "@/app/welcome/page";
import {
	buildPreviewData,
	COMPARISON_ROWS,
	DEPLOY_OPTIONS,
	formatPercent,
	UX_HIGHLIGHTS,
} from "@/components/welcome/welcome-data";

const welcomeComponentsDir = new URL(
	"../../components/welcome/",
	import.meta.url,
);
const welcomePageFile = new URL("../../app/welcome/page.tsx", import.meta.url);

describe("/welcome landing page", () => {
	it("renders separate hero pills, deploy commands and footer links", () => {
		const html = renderToStaticMarkup(createElement(WelcomePage));
		expect(html).toMatch(/Open Source \(AGPL-3\.0\)<\/span>/);
		expect(html).toMatch(/Local-First PWA<\/span>/);
		expect(html).toMatch(/Pending CA verification<\/span>/);
		for (const { title } of DEPLOY_OPTIONS) {
			expect(html).toContain(
				`aria-label="Copy ${title.replaceAll("&", "&amp;")} commands"`,
			);
		}
		expect(html.match(/<pre[^>]*overflow-x-auto/g)).toHaveLength(
			DEPLOY_OPTIONS.length,
		);
		const footer = html.slice(html.indexOf("<footer"));
		expect(footer).toContain(DISCLAIMER);
		for (const href of ["/", "/docs", "/import"])
			expect(footer).toContain(`href="${href}"`);
	});

	it.each(["2025-26", "2026-27"])(
		"builds live preview data from @tax/rules for %s",
		(year) => {
			const vda = loadRules("india-vda", year);
			const equity = loadRules("india-us-equity", year);
			const preview = buildPreviewData(vda, equity);

			expect(preview.vda.taxYear).toBe(vda.taxYear);
			expect(preview.vda.act).toBe(vda.act);
			expect(preview.vda.sectionTax).toBe(vda.sections.vdaTax);
			expect(preview.vda.sectionTds).toBe(vda.sections.vdaTds);
			expect(preview.vda.rateLabel).toBe(formatPercent(vda.rate));
			expect(preview.vda.cessLabel).toBe(formatPercent(vda.cess));
			expect(preview.vda.tdsRateLabel).toBe(formatPercent(vda.tds.rate));

			expect(preview.equity.taxYear).toBe(equity.taxYear);
			expect(preview.equity.act).toBe(equity.act);
			expect(preview.equity.scheduleFaCy).toBe(equity.scheduleFaCalendarYear);
			expect(preview.equity.sectionLtcg).toBe(equity.sections.ltcgTax);
			expect(preview.equity.sectionForeignAssets).toBe(
				equity.sections.foreignAssets,
			);
			expect(preview.equity.sectionForeignTaxCredit).toBe(
				equity.sections.foreignTaxCredit,
			);
			expect(preview.equity.dtaaArticle).toBe(equity.dtaa.dividendArticle);
			expect(preview.equity.longTermRateLabel).toBe(
				formatPercent(equity.longTermRate),
			);
			expect(preview.equity.holdingMonthsLabel).toContain(
				String(equity.longTermHoldingMonths),
			);
		},
	);

	it("follows changed rule inputs dynamically instead of duplicating tax constants", () => {
		const vda = loadRules("india-vda", "2026-27");
		const equity = loadRules("india-us-equity", "2026-27");

		vda.rate = D(vda.rate).div("2").toFixed();
		vda.cess = D(vda.cess).mul("2").toFixed();
		vda.tds.rate = D(vda.tds.rate).mul("2").toFixed();
		vda.sections.vdaTax = "Synthetic VDA Tax Citation";
		vda.sections.vdaTds = "Synthetic VDA TDS Citation";

		equity.longTermRate = D(equity.longTermRate).div("2").toFixed();
		equity.longTermHoldingMonths += 6;
		equity.scheduleFaCalendarYear += 1;
		equity.dtaa.dividendArticle = "Synthetic DTAA Article";
		equity.sections.ltcgTax = "Synthetic LTCG Citation";

		const preview = buildPreviewData(vda, equity);

		expect(preview.vda.rateLabel).toBe(formatPercent(vda.rate));
		expect(preview.vda.cessLabel).toBe(formatPercent(vda.cess));
		expect(preview.vda.tdsRateLabel).toBe(formatPercent(vda.tds.rate));
		expect(preview.vda.sectionTax).toBe("Synthetic VDA Tax Citation");
		expect(preview.vda.sectionTds).toBe("Synthetic VDA TDS Citation");
		expect(preview.vda.baseTaxInr).toBe(
			formatInr(D("185000").minus("125000").mul(vda.rate)),
		);

		expect(preview.equity.longTermRateLabel).toBe(
			formatPercent(equity.longTermRate),
		);
		expect(preview.equity.holdingMonthsLabel).toContain(
			String(equity.longTermHoldingMonths),
		);
		expect(preview.equity.scheduleFaCy).toBe(equity.scheduleFaCalendarYear);
		expect(preview.equity.dtaaArticle).toBe("Synthetic DTAA Article");
		expect(preview.equity.sectionLtcg).toBe("Synthetic LTCG Citation");
	});

	it("loads both tax years via @tax/rules in the server page and renders DISCLAIMER", async () => {
		const pageSource = await readFile(welcomePageFile, "utf8");
		expect(pageSource).toContain('from "@tax/rules"');
		expect(pageSource).toContain('loadRules("india-vda", "2025-26")');
		expect(pageSource).toContain('loadRules("india-vda", "2026-27")');
		expect(pageSource).toContain('loadRules("india-us-equity", "2025-26")');
		expect(pageSource).toContain('loadRules("india-us-equity", "2026-27")');
		expect(pageSource).not.toContain('"use client"');

		const clientSource = await readFile(
			new URL("WelcomeClient.tsx", welcomeComponentsDir),
			"utf8",
		);
		expect(clientSource).toContain("DISCLAIMER");
		expect(DISCLAIMER.length).toBeGreaterThan(10);
	});

	it("contains zero hard-coded statutory section numbers or tax rates in welcome components", async () => {
		const entries = await readdir(welcomeComponentsDir);
		const files = [
			...entries
				.filter((name) => name.endsWith(".ts") || name.endsWith(".tsx"))
				.map((name) => new URL(name, welcomeComponentsDir)),
			welcomePageFile,
		];

		for (const fileUrl of files) {
			const content = await readFile(fileUrl, "utf8");
			expect(content, fileUrl.pathname).not.toMatch(
				/\b(115BBH|194S|112A|285BAA|Rule 115|Rule 206|Rule 128|Section \d+|Article 10)\b/i,
			);
			expect(content, fileUrl.pathname).not.toMatch(
				/(\b30%|\b12\.5%|\b4%|\b1%|\b25%|₹\d)/,
			);
		}
	});

	it("documents comparison matrix, UX highlights, and self-host options", () => {
		expect(COMPARISON_ROWS.length).toBeGreaterThanOrEqual(6);
		expect(UX_HIGHLIGHTS.map((h) => h.id)).toEqual(
			expect.arrayContaining([
				"imports",
				"review-queue",
				"missing-buy",
				"price-autofill",
				"pwa",
			]),
		);
		expect(DEPLOY_OPTIONS.map((d) => d.id)).toEqual(
			expect.arrayContaining(["docker", "railway", "cli"]),
		);
		const allText = [
			...COMPARISON_ROWS.flatMap((r) => [
				r.criterion,
				r.taxTracker,
				r.hostedPlatforms,
			]),
			...UX_HIGHLIGHTS.flatMap((h) => [h.title, h.description, ...h.details]),
			...DEPLOY_OPTIONS.flatMap((d) => [
				d.title,
				d.summary,
				d.commands,
				d.note,
			]),
		].join("\n");
		expect(allText).toContain("14-day");
		expect(allText).toContain("22-day");
		expect(allText).toContain("Railway");
		expect(allText).toContain("PWA");
		expect(join("apps", "web")).toBe("apps/web");
	});
});
