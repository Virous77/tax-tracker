import { AssetSchema, D } from "@tax/core";
import { pdfError } from "../pdf/text.js";
import type { PdfLine } from "../pdf/types.js";
import {
	timezoneConflict,
	timezoneFromFileName,
	timezoneOffsetMinutes,
} from "../timezone.js";
import type {
	BalanceSnapshot,
	ImportOptions,
	ImportResult,
	ImportTimezone,
} from "../types.js";
import { numberString, parseTimestamp } from "../values.js";
// Catalogue §1.10: no real PDF layout is verified. Accept only explicit date and Coin/Amount tables.
export const reportKind = {
	id: "binance:account-statement-pdf",
	verified: false,
	detect: (text: string) =>
		/binance/i.test(text) && /account\s*statement/i.test(text),
	parse(lines: PdfLine[], options: ImportOptions, fileName = ""): ImportResult {
		timezoneOffsetMinutes(options.timezone);
		const text = lines
			.map((l) => l.cells.map((c) => c.str).join(" "))
			.join("\n");
		const dates = [
			...text.matchAll(
				/(?:statement\s*date|as\s*of|snapshot\s*date)\s*:?\s*(\d{4}-\d{2}-\d{2})(?!\d)/gi,
			),
		].map((m) => m[1]);
		const asOf = dates[0];
		if (!asOf || new Set(dates).size !== 1)
			throw pdfError("pdf_unknown_layout", this.id);
		try {
			parseTimestamp(`${asOf} 00:00:00`, "yyyy-MM-dd HH:mm:ss", "UTC");
		} catch {
			throw pdfError("pdf_unknown_layout", this.id);
		}
		const zones = [
			...text.matchAll(/\bUTC(?:([+-])(\d{1,2})(?::(\d{2}))?)?\b/g),
		].map((m) =>
			m[1]
				? (`${m[1]}${m[2]?.padStart(2, "0")}:${m[3] ?? "00"}` as ImportTimezone)
				: ("UTC" as const),
		);
		if (new Set(zones).size > 1) throw pdfError("pdf_unknown_layout", this.id);
		const fileTimezone = zones[0] ?? timezoneFromFileName(fileName);
		const timezone = fileTimezone ?? options.timezone;
		try {
			timezoneOffsetMinutes(timezone);
		} catch {
			throw pdfError("pdf_unknown_layout", this.id);
		}
		const rows: BalanceSnapshot["rows"] = [];
		let wallet: string | undefined;
		let header: PdfLine | undefined;
		let lastRaw:
			| {
					page: number;
					bbox: number[];
					cells: PdfLine["cells"];
					wrappedLines: PdfLine[];
			  }
			| undefined;
		for (const line of lines) {
			if (line.pageHeight && line.y > line.pageHeight - 24) continue;
			const lineText = line.cells
				.map((c) => c.str)
				.join(" ")
				.trim();
			if (
				/^(?:page\s+\d+|\d+\s*\/\s*\d+|generated\s+(?:on|at)|binance\s+account\s*statement)/i.test(
					lineText,
				)
			)
				continue;
			const walletMatch = lineText.match(
				/^(Spot|Funding|Earn|Margin|Cross Margin|Isolated Margin|Futures)(?:\s+Wallet|\s+Account)?$/i,
			);
			if (walletMatch) {
				wallet = walletMatch[1];
				header = undefined;
				lastRaw = undefined;
				continue;
			}
			const coinHeader = line.cells.find((c) =>
				/^(coin|asset)$/i.test(c.str.trim()),
			);
			const amountHeader = line.cells.find((c) =>
				/^(amount|balance)$/i.test(c.str.trim()),
			);
			if (coinHeader && amountHeader) {
				header = line;
				lastRaw = undefined;
				continue;
			}
			if (!header) continue;
			const columns = header.cells;
			const buckets = columns.map(() => [] as string[]);
			for (const cell of line.cells) {
				const overlaps = columns.map((column, i) => {
					const left = i === 0 ? 0 : column.x - line.height * 0.5;
					const right = columns[i + 1]
						? (columns[i + 1]?.x ?? 0) - line.height * 0.5
						: Number.POSITIVE_INFINITY;
					return Math.max(
						0,
						Math.min(cell.x + cell.width, right) - Math.max(cell.x, left),
					);
				});
				const rightAligned = /^[+-]?[\d,.]+$/.test(cell.str.trim())
					? columns.findIndex(
							(column, i) =>
								/^(amount|balance)$/i.test(column.str.trim()) &&
								Math.abs(cell.x + cell.width - column.x - column.width) <=
									line.height &&
								(!columns[i + 1] ||
									cell.x + cell.width < (columns[i + 1]?.x ?? 0)),
						)
					: -1;
				const index =
					rightAligned >= 0
						? rightAligned
						: overlaps.indexOf(Math.max(...overlaps));
				buckets[index]?.push(cell.str);
			}
			const assetIndex = columns.findIndex((c) =>
				/^(coin|asset)$/i.test(c.str.trim()),
			);
			const amountIndex = columns.findIndex((c) =>
				/^(amount|balance)$/i.test(c.str.trim()),
			);
			const asset = buckets[assetIndex]?.join(" ").trim().toUpperCase() ?? "";
			const value = buckets[amountIndex]?.join("").trim() ?? "";
			if (!value) {
				if (!lastRaw) throw pdfError("pdf_unknown_layout", this.id);
				lastRaw.wrappedLines.push(line);
				continue;
			}
			if (!AssetSchema.safeParse(asset).success || asset === "OTHERS")
				throw pdfError("pdf_unknown_layout", this.id);
			let amount: string;
			try {
				amount = numberString(value);
			} catch {
				throw pdfError("pdf_unknown_layout", this.id);
			}
			if (D(amount).lt("0")) throw pdfError("pdf_unknown_layout", this.id);
			lastRaw = {
				page: line.page,
				bbox: [
					Math.min(...line.cells.map((c) => c.x)),
					line.y - line.height,
					Math.max(...line.cells.map((c) => c.x + c.width)),
					line.y,
				],
				cells: line.cells,
				wrappedLines: [],
			};
			rows.push({ asset, amount, wallet, raw: lastRaw });
		}
		if (!rows.length) throw pdfError("pdf_unknown_layout", this.id);
		return {
			reportKind: this.id,
			balanceSnapshot: { asOf, timezone, rows },
			transactions: [],
			rowsRead: rows.length,
			rowErrors: [],
			warnings: [
				{
					code: "parse_warning",
					message:
						"The Binance PDF layout is unverified; check the balance rows against the original statement. This snapshot creates no transactions.",
				},
				...timezoneConflict(
					options.timezone,
					fileTimezone,
					zones.length ? "the PDF statement" : "the file name",
				),
				...(!fileTimezone
					? [
							{
								code: "ambiguous_timezone" as const,
								message:
									"The PDF does not state a timezone; confirm the selected timezone for this balance snapshot.",
							},
						]
					: []),
			],
			timezoneSource: fileTimezone ? "file" : "user",
			detectedTimezone: fileTimezone,
		};
	},
};
