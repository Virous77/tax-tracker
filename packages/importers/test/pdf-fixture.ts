import { createHash } from "node:crypto";

export interface FixtureText {
	text: string;
	x: number;
	y: number;
	fontSize?: number;
}
const padding = Buffer.from(
	"28bf4e5e4e758a4164004e56fffa01082e2e00b6d0683e802f0ca9fe6453697a",
	"hex",
);
function md5(bytes: Uint8Array) {
	return createHash("md5").update(bytes).digest();
}
function rc4(key: Uint8Array, bytes: Uint8Array) {
	const state = Array.from({ length: 256 }, (_, i) => i);
	let j = 0;
	for (let i = 0; i < 256; i++) {
		j = (j + (state[i] ?? 0) + (key[i % key.length] ?? 0)) % 256;
		[state[i], state[j]] = [state[j] ?? 0, state[i] ?? 0];
	}
	let i = 0;
	j = 0;
	return Buffer.from(
		bytes.map((byte) => {
			i = (i + 1) % 256;
			j = (j + (state[i] ?? 0)) % 256;
			[state[i], state[j]] = [state[j] ?? 0, state[i] ?? 0];
			return byte ^ (state[((state[i] ?? 0) + (state[j] ?? 0)) % 256] ?? 0);
		}),
	);
}
function padPassword(password: string) {
	return Buffer.concat([Buffer.from(password, "ascii"), padding]).subarray(
		0,
		32,
	);
}
/** A tiny PDF 1.4 / Standard R2 fixture writer; RC4 is solely for synthetic password-path tests. */
export function syntheticPdf(
	pages: FixtureText[][],
	password?: string,
): Uint8Array {
	const id = md5(Buffer.from("tax-tracker synthetic PDF fixture"));
	const owner = rc4(
		md5(padPassword("fixture-owner")).subarray(0, 5),
		padPassword(password ?? ""),
	);
	const permissions = Buffer.alloc(4);
	permissions.writeInt32LE(-4);
	const key = md5(
		Buffer.concat([padPassword(password ?? ""), owner, permissions, id]),
	).subarray(0, 5);
	const objects: Buffer[] = [];
	const put = (text: string) => objects.push(Buffer.from(text, "latin1"));
	put("<< /Type /Catalog /Pages 2 0 R >>");
	put(
		`<< /Type /Pages /Kids [${pages.map((_, i) => `${4 + i * 2} 0 R`).join(" ")}] /Count ${pages.length} >>`,
	);
	put("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
	for (const [index, rows] of pages.entries()) {
		const streamId = 5 + index * 2;
		put(
			`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${streamId} 0 R >>`,
		);
		let stream = Buffer.from(
			rows
				.map(
					(row) =>
						`BT /F1 ${row.fontSize ?? 10} Tf 1 0 0 1 ${row.x} ${792 - row.y} Tm (${row.text.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)")}) Tj ET`,
				)
				.join("\n"),
			"latin1",
		);
		if (password !== undefined) {
			const suffix = Buffer.alloc(5);
			suffix.writeUIntLE(streamId, 0, 3);
			stream = rc4(md5(Buffer.concat([key, suffix])).subarray(0, 10), stream);
		}
		objects.push(
			Buffer.concat([
				Buffer.from(`<< /Length ${stream.length} >>\nstream\n`),
				stream,
				Buffer.from("\nendstream"),
			]),
		);
	}
	let encryptId: number | undefined;
	if (password !== undefined) {
		put(
			`<< /Filter /Standard /V 1 /R 2 /Length 40 /O <${owner.toString("hex")}> /U <${rc4(key, padding).toString("hex")}> /P -4 >>`,
		);
		encryptId = objects.length;
	}
	const parts: Buffer[] = [
		Buffer.from("%PDF-1.4\n%\xff\xff\xff\xff\n", "latin1"),
	];
	const offsets = [0];
	for (const [index, object] of objects.entries()) {
		offsets.push(parts.reduce((n, part) => n + part.length, 0));
		parts.push(
			Buffer.from(`${index + 1} 0 obj\n`),
			object,
			Buffer.from("\nendobj\n"),
		);
	}
	const xref = parts.reduce((n, part) => n + part.length, 0);
	parts.push(
		Buffer.from(
			`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
				.slice(1)
				.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`)
				.join(
					"",
				)}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /ID [<${id.toString("hex")}><${id.toString("hex")}>] ${encryptId ? `/Encrypt ${encryptId} 0 R` : ""} >>\nstartxref\n${xref}\n%%EOF\n`,
		),
	);
	return new Uint8Array(Buffer.concat(parts));
}
export function statementPages(): FixtureText[][] {
	return [
		[
			{ text: "Binance Account Statement", x: 40, y: 40 },
			{ text: "Statement Date: 2026-03-31 UTC", x: 40, y: 65 },
			{ text: "Spot Wallet", x: 40, y: 100 },
			{ text: "Coin", x: 40, y: 125 },
			{ text: "Amount", x: 200, y: 125 },
			{ text: "Value (BTC)", x: 350, y: 125 },
			{ text: "BTC", x: 40, y: 150 },
			{ text: "0.01234567890123456789", x: 200, y: 150 },
			{ text: "0.0123456789", x: 350, y: 150 },
			{ text: "USDT", x: 40, y: 175 },
			{ text: "1,200.5", x: 200, y: 175 },
			{ text: "0.02", x: 350, y: 175 },
			{ text: "Page 1 of 2", x: 40, y: 775 },
		],
		[
			{ text: "Binance Account Statement", x: 40, y: 40 },
			{ text: "Funding Wallet", x: 40, y: 100 },
			{ text: "Coin", x: 40, y: 125 },
			{ text: "Amount", x: 200, y: 125 },
			{ text: "Value (BTC)", x: 350, y: 125 },
			{ text: "ETH", x: 40, y: 150 },
			{ text: "2", x: 200, y: 150 },
			{ text: "0.05", x: 350, y: 150 },
		],
	];
}
