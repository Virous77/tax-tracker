import {
	D,
	DEFAULT_ENGINE_SETTINGS,
	formatInr,
	ReviewCodeSchema,
} from "@tax/core";
import { loadRules } from "@tax/rules";
import { describe, expect, it } from "vitest";
import {
	equitySummary,
	percent,
	settingsReference,
	statutoryReferences,
	vdaSummary,
} from "@/components/docs/docs-data";
import {
	PROVIDER_REFERENCE,
	REVIEW_FIXES,
} from "@/components/docs/reference-data";
import { PAGE_SEO, pageMetadata } from "@/lib/seo";

const rowsAsMap = (rows: readonly (readonly [string, string])[]) =>
	new Map(rows);

describe("documentation", () => {
	it("has centralized page and social metadata", () => {
		const metadata = pageMetadata("docs");
		expect(metadata.title).toBe(PAGE_SEO.docs.title);
		expect(metadata.description).toBe(PAGE_SEO.docs.description);
		expect(metadata.openGraph).toMatchObject({
			title: `${PAGE_SEO.docs.title} — Tax Tracker`,
			description: PAGE_SEO.docs.description,
		});
		expect(metadata.twitter).toMatchObject({
			description: PAGE_SEO.docs.description,
		});
		const overview = pageMetadata("overview");
		expect(overview.title).toEqual({
			absolute: `${PAGE_SEO.overview.title} — Tax Tracker`,
		});
	});

	it.each(["2025-26", "2026-27"])(
		"builds summaries from both live rule files for %s",
		(year) => {
			const vda = loadRules("india-vda", year);
			const equity = loadRules("india-us-equity", year);
			const crypto = rowsAsMap(vdaSummary(vda));
			const stocks = rowsAsMap(equitySummary(equity));
			expect(crypto.get("Act")).toBe(vda.act);
			expect(crypto.get("Flat VDA tax rate")).toBe(percent(vda.rate));
			expect(crypto.get("Health & Education Cess")).toContain(
				percent(vda.cess),
			);
			expect(crypto.get("Annual TDS threshold · normal")).toBe(
				formatInr(vda.tds.thresholdInr),
			);
			expect(crypto.get("Annual TDS threshold · specified person")).toBe(
				formatInr(vda.tds.specifiedPersonThresholdInr),
			);
			expect(crypto.get("Gift review threshold")).toBe(
				formatInr(vda.giftThresholdInr),
			);
			expect(stocks.get("Act")).toBe(equity.act);
			expect(stocks.get("Schedule FA calendar year")).toBe(
				String(equity.scheduleFaCalendarYear),
			);
			expect(stocks.get("LTCG rate")).toBe(percent(equity.longTermRate));
			expect(stocks.get("LTCG surcharge cap")).toBe(
				percent(equity.surchargeCapLtcg),
			);
			expect(stocks.get("Long-term holding period")).toContain(
				String(equity.longTermHoldingMonths),
			);
			expect(stocks.get("DTAA dividend article")).toBe(
				equity.dtaa.dividendArticle,
			);
			expect(
				stocks.get("Loss carry-forward · eligibility requires review"),
			).toContain(String(equity.lossSetOff.carryForwardYears));
			expect(vda.sectionsVerified).toBe(false);
			expect(equity.sectionsVerified).toBe(false);
			for (const rules of [vda, equity]) {
				expect(statutoryReferences(rules).map(([, value]) => value)).toEqual(
					Object.values(rules.sections),
				);
			}
			expect(JSON.parse(JSON.stringify({ vda, equity }))).toEqual({
				vda,
				equity,
			});
		},
	);

	it("follows changed rule inputs instead of duplicating their tax constants", () => {
		const vda = loadRules("india-vda", "2025-26");
		const equity = loadRules("india-us-equity", "2025-26");
		vda.rate = D(vda.rate).div("2").toFixed();
		vda.tds.thresholdInr = D(vda.tds.thresholdInr).plus("1").toFixed();
		equity.longTermRate = D(equity.longTermRate).div("2").toFixed();
		equity.longTermHoldingMonths += 1;
		equity.dtaa.dividendArticle = "Synthetic treaty citation";
		vda.sections.vdaTax = "Synthetic VDA citation";
		equity.sections.ltcgTax = "Synthetic equity citation";
		const crypto = rowsAsMap(vdaSummary(vda));
		const stocks = rowsAsMap(equitySummary(equity));
		expect(crypto.get("Flat VDA tax rate")).toBe(percent(vda.rate));
		expect(crypto.get("Annual TDS threshold · normal")).toBe(
			formatInr(vda.tds.thresholdInr),
		);
		expect(stocks.get("LTCG rate")).toBe(percent(equity.longTermRate));
		expect(stocks.get("Long-term holding period")).toContain(
			String(equity.longTermHoldingMonths),
		);
		expect(stocks.get("DTAA dividend article")).toBe(
			equity.dtaa.dividendArticle,
		);
		expect(rowsAsMap(settingsReference(vda)).get("specifiedPerson")).toContain(
			formatInr(vda.tds.thresholdInr),
		);
		expect(rowsAsMap(statutoryReferences(vda)).get("VDA Tax")).toBe(
			vda.sections.vdaTax,
		);
		expect(rowsAsMap(statutoryReferences(equity)).get("LTCG Tax")).toBe(
			equity.sections.ltcgTax,
		);
	});

	it("documents all current review codes and shared engine defaults", () => {
		expect(Object.keys(REVIEW_FIXES).sort()).toEqual(
			[...ReviewCodeSchema.options].sort(),
		);
		const settings = rowsAsMap(
			settingsReference(loadRules("india-vda", "2026-27")),
		);
		for (const key of [
			"feeTreatment",
			"usEquityFeeTreatment",
			"incomeCostBasis",
			"usEquityFxBasis",
		] as const) {
			expect(settings.get(key)).toContain(DEFAULT_ENGINE_SETTINGS[key]);
		}
	});

	it("documents provider accuracy limits without hard-coding statutory tax rules", () => {
		const providers = rowsAsMap(PROVIDER_REFERENCE);
		expect(providers.get("Polygon.io (Massive)")).toMatch(
			/unadjusted.*daily.*bars/i,
		);
		const cg = providers.get("CoinGecko Demo") ?? "";
		for (const chain of [
			"Ethereum",
			"Base",
			"Arbitrum",
			"Polygon",
			"BNB Chain",
		]) {
			expect(cg).toContain(chain);
		}
		expect(cg).toContain("365");
		const coindcx = providers.get("CoinDCX") ?? "";
		expect(coindcx).toMatch(/Spot Orderbook/i);
		expect(coindcx).toMatch(/Instant Buy\/Sell/i);
		expect(coindcx).toMatch(/Form 16A/i);
		expect(REVIEW_FIXES.fx_unavailable).toMatch(/freshness guard/i);

		const staticText = [
			...PROVIDER_REFERENCE.flat(),
			...Object.values(REVIEW_FIXES),
		].join("\n");
		expect(staticText).not.toMatch(
			/\b(115BBH|194S|112A|Rule 115|Rule 206|Section \d+)\b/i,
		);
		expect(staticText).not.toMatch(/(\b30%|\b12\.5%|\b4%|₹\d)/);
	});
});
