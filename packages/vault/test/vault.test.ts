import { describe, expect, it } from "vitest";
import {
	Vault,
	type VaultMeta,
	type VaultSecret,
	type VaultStorage,
} from "../src/index.js";

function fixture() {
	let meta: VaultMeta | undefined;
	const rows = new Map<string, VaultSecret>();
	let now = 0;
	const storage: VaultStorage = {
		getMeta: () => meta,
		setMeta: (value) => {
			meta = value;
		},
		get: (id) => rows.get(id),
		list: () => [...rows.values()],
		put: (row) => {
			rows.set(row.id, row);
		},
		delete: (id) => {
			rows.delete(id);
		},
		clear: () => {
			rows.clear();
			meta = undefined;
		},
		transaction: <T>(fn: () => T) => {
			const oldMeta = meta;
			const old = new Map(rows);
			try {
				return fn();
			} catch (error) {
				meta = oldMeta;
				rows.clear();
				for (const row of old.values()) rows.set(row.id, row);
				throw error;
			}
		},
	};
	const vault = new Vault(storage, () => now);
	return {
		vault,
		storage,
		advance: (ms: number) => {
			now += ms;
		},
	};
}
const pass = "correct horse battery staple";
describe("encrypted vault", () => {
	it("rejects a wrong passphrase and never stores plaintext", async () => {
		const { vault, storage } = fixture();
		await vault.setup(pass);
		vault.put("one", "key", "secret-value");
		expect(JSON.stringify(storage.list())).not.toContain("secret-value");
		vault.lock();
		await expect(vault.unlock("wrong password")).rejects.toMatchObject({
			code: "wrong_passphrase",
		});
		expect(() => vault.get("one")).toThrow("vault_locked");
		await vault.unlock(pass);
		expect(vault.get("one")).toBe("secret-value");
		vault.lock();
	});
	it("rejects tampered ciphertext", async () => {
		const { vault, storage } = fixture();
		await vault.setup(pass);
		vault.put("one", "key", "secret-value");
		const row = storage.get("one");
		if (!row) throw new Error();
		const bytes = Buffer.from(row.ct, "base64");
		bytes[0] = (bytes[0] ?? 0) ^ 1;
		storage.put({ ...row, ct: bytes.toString("base64") });
		expect(() => vault.get("one")).toThrow();
		vault.lock();
	});
	it("binds ciphertext to both row id and kind", async () => {
		const { vault, storage } = fixture();
		await vault.setup(pass);
		vault.put("one", "key", "one secret");
		const row = storage.get("one");
		if (!row) throw new Error();
		storage.put({ ...row, id: "two" });
		expect(() => vault.get("two")).toThrow();
		storage.put({ ...row, kind: "other" });
		expect(() => vault.get("one")).toThrow();
		vault.lock();
	});
	it("changes the passphrase for every secret", async () => {
		const { vault } = fixture();
		await vault.setup(pass);
		vault.put("one", "key", "first");
		vault.put("two", "secret", "second");
		await expect(
			vault.changePassphrase("wrong", "another long passphrase"),
		).rejects.toMatchObject({ code: "wrong_passphrase" });
		expect(vault.get("one")).toBe("first");
		await vault.changePassphrase(pass, "another long passphrase");
		vault.lock();
		await expect(vault.unlock(pass)).rejects.toMatchObject({
			code: "wrong_passphrase",
		});
		await vault.unlock("another long passphrase");
		expect(vault.get("one")).toBe("first");
		expect(vault.get("two")).toBe("second");
		vault.lock();
	});
	it("requires the exact reset confirmation and clears only the vault", async () => {
		const { vault, storage } = fixture();
		await vault.setup(pass);
		vault.put("one", "key", "first");
		expect(() => vault.reset({ confirm: "no" })).toThrow();
		vault.reset({ confirm: "RESET" });
		expect(storage.list()).toEqual([]);
		expect(vault.status()).toMatchObject({
			initialized: false,
			unlocked: false,
		});
		await vault.setup(pass);
		expect(vault.has("one")).toBe(false);
		vault.lock();
	});
	it("locks after thirty idle minutes using the injected clock", async () => {
		const { vault, advance } = fixture();
		await vault.setup(pass);
		vault.put("one", "key", "first");
		advance(29 * 60000);
		expect(vault.get("one")).toBe("first");
		advance(29 * 60000);
		expect(vault.status().unlocked).toBe(true);
		advance(60000);
		expect(vault.status().unlocked).toBe(false);
		expect(() => vault.put("two", "key", "second")).toThrow("vault_locked");
	});
	it("rolls back rotation if a stored secret has been corrupted", async () => {
		const { vault, storage } = fixture();
		await vault.setup(pass);
		vault.put("one", "key", "first");
		vault.put("two", "key", "second");
		const row = storage.get("two");
		if (!row) throw new Error();
		storage.put({ ...row, tag: Buffer.alloc(16).toString("base64") });
		await expect(
			vault.changePassphrase(pass, "another long passphrase"),
		).rejects.toThrow();
		vault.lock();
		await vault.unlock(pass);
		expect(vault.get("one")).toBe("first");
		vault.lock();
	});
});
