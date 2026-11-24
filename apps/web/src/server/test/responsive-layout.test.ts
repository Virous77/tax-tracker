import { globSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { rootViewport } from "@/lib/seo";

it("uses a 16px font for text-entry controls on mobile and touch devices", () => {
	const css = readFileSync(
		new URL("../../app/globals.css", import.meta.url),
		"utf8",
	);
	expect(css).toMatch(
		/^@media \(max-width: 767px\), \(hover: none\) and \(pointer: coarse\) \{\s+input:not\([\s\S]*?\)\s*,\s*textarea,\s*select\s*\{\s*font-size: 16px;\s*\}\s*\}/m,
	);
});

it("sets the initial viewport and leaves the zoom settings at browser defaults", () => {
	const viewport = rootViewport();
	expect(viewport).toMatchObject({ width: "device-width", initialScale: 1 });
	expect(viewport).not.toHaveProperty("maximumScale");
	expect(viewport).not.toHaveProperty("userScalable");
});

it("keeps table headers and scalar cells on one line inside local scroll containers", () => {
	const components = new URL("../../components/", import.meta.url);
	const files = globSync("**/*.tsx", { cwd: fileURLToPath(components) });
	let tableCount = 0;
	for (const file of files) {
		const source = readFileSync(new URL(file, components), "utf8");
		const tables = [...source.matchAll(/<table\b[\s\S]*?<\/table>/g)];
		tableCount += tables.length;
		for (const { 0: table, index } of tables) {
			const wrapper = source
				.slice(0, index)
				.match(/<div className="([^"]*)"[^>]*>\s*$/)?.[1]
				?.split(" ");
			expect(wrapper, file).toEqual(
				expect.arrayContaining(["min-w-0", "overflow-x-auto"]),
			);
			for (const [header] of table.matchAll(/<th\b[^>]*>/g)) {
				expect(header, file).toMatch(/\bwhitespace-nowrap\b/);
			}
			for (const [cell] of table.matchAll(/<td\b[^>]*>/g)) {
				if (/\/\s*>$/.test(cell)) continue;
				expect(cell, file).toMatch(/\bwhitespace-(nowrap|normal)\b/);
				if (/\bwhitespace-normal\b/.test(cell) && !cell.includes("colSpan")) {
					expect(cell, file).toMatch(/min-w-\[2[2-6]0px\]/);
				}
			}
		}
	}
	expect(tableCount).toBeGreaterThan(0);
});
