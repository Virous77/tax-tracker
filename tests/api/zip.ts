import { inflateRawSync } from "node:zlib";

/** Minimal ZIP reader (stored + deflate) so XLSX exports are checked without the app's own reader. */
export function unzip(bytes: Uint8Array): Map<string, Buffer> {
	const buf = Buffer.from(bytes);
	let eocd = -1;
	for (let i = buf.length - 22; i >= 0; i--)
		if (buf.readUInt32LE(i) === 0x06054b50) {
			eocd = i;
			break;
		}
	if (eocd < 0)
		throw new Error("not a zip: no end-of-central-directory record");
	const count = buf.readUInt16LE(eocd + 10);
	let p = buf.readUInt32LE(eocd + 16);
	const files = new Map<string, Buffer>();
	for (let n = 0; n < count; n++) {
		if (buf.readUInt32LE(p) !== 0x02014b50)
			throw new Error("bad central directory entry");
		const method = buf.readUInt16LE(p + 10);
		const size = buf.readUInt32LE(p + 20);
		const nameLen = buf.readUInt16LE(p + 28);
		const extraLen = buf.readUInt16LE(p + 30);
		const commentLen = buf.readUInt16LE(p + 32);
		const local = buf.readUInt32LE(p + 42);
		const name = buf.subarray(p + 46, p + 46 + nameLen).toString("utf8");
		if (buf.readUInt32LE(local) !== 0x04034b50)
			throw new Error(`bad local header for ${name}`);
		const start =
			local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
		const data = buf.subarray(start, start + size);
		if (method === 0) files.set(name, Buffer.from(data));
		else if (method === 8) files.set(name, inflateRawSync(data));
		else throw new Error(`unsupported compression ${method} for ${name}`);
		p += 46 + nameLen + extraLen + commentLen;
	}
	return files;
}

export function parseCsv(text: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let cell = "";
	let quoted = false;
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (quoted) {
			if (c === '"' && text[i + 1] === '"') {
				cell += '"';
				i++;
			} else if (c === '"') quoted = false;
			else cell += c;
		} else if (c === '"') quoted = true;
		else if (c === ",") {
			row.push(cell);
			cell = "";
		} else if (c === "\n" || c === "\r") {
			if (c === "\r" && text[i + 1] === "\n") i++;
			row.push(cell);
			rows.push(row);
			row = [];
			cell = "";
		} else cell += c;
	}
	if (cell || row.length) {
		row.push(cell);
		rows.push(row);
	}
	return rows;
}

const xmlEntities: Record<string, string> = {
	"&lt;": "<",
	"&gt;": ">",
	"&amp;": "&",
	"&quot;": '"',
	"&apos;": "'",
};
export function xmlText(xml: string): string[] {
	return [...xml.matchAll(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g)].map((m) =>
		m[1].replace(/&(lt|gt|amp|quot|apos);/g, (e) => xmlEntities[e]),
	);
}
