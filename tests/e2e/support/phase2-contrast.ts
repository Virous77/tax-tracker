import type { Page } from "@playwright/test";

export async function textContrastFailures(page: Page) {
	return await page.evaluate(() => {
		const canvas = document.createElement("canvas").getContext("2d");
		if (!canvas) return [];
		const rgba = (c: string) => {
			canvas.clearRect(0, 0, 1, 1);
			canvas.fillStyle = "#000";
			canvas.fillStyle = c;
			canvas.fillRect(0, 0, 1, 1);
			return Array.from(canvas.getImageData(0, 0, 1, 1).data);
		};
		const lum = ([r, g, b]: number[]) => {
			const f = (v: number) => {
				const x = v / 255;
				return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
			};
			return 0.2126 * f(r ?? 0) + 0.7152 * f(g ?? 0) + 0.0722 * f(b ?? 0);
		};
		const bgOf = (el: Element | null): string => {
			for (let e = el; e; e = e.parentElement) {
				const bg = getComputedStyle(e).backgroundColor;
				if (rgba(bg)[3] === 255) return bg;
			}
			return getComputedStyle(document.body).backgroundColor;
		};
		const out: string[] = [];
		for (const el of document.querySelectorAll<HTMLElement>(
			"p, span, dt, dd, th, td, label, code, h3, a, button",
		)) {
			const text = [...el.childNodes]
				.filter((n) => n.nodeType === 3)
				.map((n) => n.textContent ?? "")
				.join("")
				.trim();
			if (!text || el.offsetParent === null) continue;
			const fg = rgba(getComputedStyle(el).color);
			const bg = rgba(bgOf(el));
			const a = (fg[3] ?? 255) / 255;
			const blended = [0, 1, 2].map(
				(i) => (fg[i] ?? 0) * a + (bg[i] ?? 0) * (1 - a),
			);
			const l1 = lum(blended);
			const l2 = lum(bg);
			const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
			const size = Number.parseFloat(getComputedStyle(el).fontSize);
			const bold = Number(getComputedStyle(el).fontWeight) >= 700;
			const need = size >= 24 || (bold && size >= 18.66) ? 3 : 4.5;
			if (ratio < need)
				out.push(`${ratio.toFixed(2)}:1 "${text.slice(0, 40)}"`);
		}
		return out;
	});
}
