import {
	createCipheriv,
	createDecipheriv,
	randomBytes,
	scrypt,
} from "node:crypto";

export interface EncryptedBlob {
	iv: string;
	ct: string;
	tag: string;
}
export interface VaultSecret extends EncryptedBlob {
	id: string;
	kind: string;
	createdAt: string;
}
export interface VaultMeta {
	v: 1;
	kdf: "scrypt";
	N: number;
	r: number;
	p: number;
	salt: string;
	check: EncryptedBlob;
}
export interface VaultStorage {
	getMeta(): VaultMeta | undefined;
	setMeta(meta: VaultMeta): void;
	list(): VaultSecret[];
	get(id: string): VaultSecret | undefined;
	put(row: VaultSecret): void;
	delete(id: string): void;
	clear(): void;
	transaction<T>(operation: () => T): T;
}
export class VaultError extends Error {
	constructor(
		public code:
			| "vault_locked"
			| "vault_not_initialized"
			| "wrong_passphrase"
			| "vault_initialized"
			| "invalid_passphrase"
			| "invalid_confirmation",
	) {
		super(code);
	}
}
const params = { N: 2 ** 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
const aad = (id: string, kind: string) =>
	Buffer.from(`tax-tracker:v1:${id}:${kind}`);
const derive = (passphrase: string, salt: string): Promise<Buffer> =>
	new Promise((resolve, reject) => {
		scrypt(
			passphrase.normalize("NFC"),
			Buffer.from(salt, "base64"),
			32,
			params,
			(error, key) => (error ? reject(error) : resolve(key)),
		);
	});
function encrypt(
	key: Buffer,
	id: string,
	kind: string,
	value: Buffer,
): EncryptedBlob {
	const iv = randomBytes(12);
	const cipher = createCipheriv("aes-256-gcm", key, iv);
	cipher.setAAD(aad(id, kind));
	const ct = Buffer.concat([cipher.update(value), cipher.final()]);
	return {
		iv: iv.toString("base64"),
		ct: ct.toString("base64"),
		tag: cipher.getAuthTag().toString("base64"),
	};
}
function decrypt(
	key: Buffer,
	id: string,
	kind: string,
	blob: EncryptedBlob,
): Buffer {
	const cipher = createDecipheriv(
		"aes-256-gcm",
		key,
		Buffer.from(blob.iv, "base64"),
	);
	cipher.setAAD(aad(id, kind));
	cipher.setAuthTag(Buffer.from(blob.tag, "base64"));
	return Buffer.concat([
		cipher.update(Buffer.from(blob.ct, "base64")),
		cipher.final(),
	]);
}
function check(key: Buffer, meta: VaultMeta): void {
	try {
		const value = decrypt(key, "check", "check", meta.check);
		const ok = value.toString() === "tax-tracker vault v1";
		value.fill(0);
		if (!ok) throw new Error();
	} catch {
		key.fill(0);
		throw new VaultError("wrong_passphrase");
	}
}
export class Vault {
	private key: Buffer | undefined;
	private lastUse = 0;
	private timer: ReturnType<typeof setTimeout> | undefined;
	private generation = 0;
	constructor(
		private storage: VaultStorage,
		private now: () => number = Date.now,
		readonly idleLockMinutes = 30,
	) {}
	status() {
		this.expire();
		return {
			initialized: Boolean(this.storage.getMeta()),
			unlocked: Boolean(this.key),
			idleLockMinutes: this.idleLockMinutes,
		};
	}
	private expire() {
		if (this.key && this.now() - this.lastUse >= this.idleLockMinutes * 60000)
			this.lock();
	}
	private touch() {
		this.lastUse = this.now();
		clearTimeout(this.timer);
		this.timer = setTimeout(() => this.expire(), this.idleLockMinutes * 60000);
		this.timer.unref?.();
	}
	requireUnlocked(): void {
		this.expire();
		if (!this.storage.getMeta()) throw new VaultError("vault_not_initialized");
		if (!this.key) throw new VaultError("vault_locked");
		this.touch();
	}
	private activeKey() {
		this.requireUnlocked();
		return this.key as Buffer;
	}
	lock(): void {
		this.generation++;
		this.key?.fill(0);
		this.key = undefined;
		clearTimeout(this.timer);
	}
	async setup(passphrase: string): Promise<void> {
		if (this.storage.getMeta()) throw new VaultError("vault_initialized");
		this.validate(passphrase);
		const generation = this.generation;
		const salt = randomBytes(16).toString("base64");
		const key = await derive(passphrase, salt);
		if (this.storage.getMeta() || generation !== this.generation) {
			key.fill(0);
			throw new VaultError("vault_initialized");
		}
		try {
			this.storage.setMeta({
				v: 1,
				kdf: "scrypt",
				N: params.N,
				r: params.r,
				p: params.p,
				salt,
				check: encrypt(
					key,
					"check",
					"check",
					Buffer.from("tax-tracker vault v1"),
				),
			});
			this.key = key;
			this.touch();
		} catch (error) {
			key.fill(0);
			throw error;
		}
	}
	async unlock(passphrase: string): Promise<void> {
		const meta = this.storage.getMeta();
		if (!meta) throw new VaultError("vault_not_initialized");
		const generation = this.generation;
		const key = await derive(passphrase, meta.salt);
		check(key, meta);
		if (
			generation !== this.generation ||
			this.storage.getMeta()?.salt !== meta.salt
		) {
			key.fill(0);
			throw new VaultError("vault_locked");
		}
		this.lock();
		this.key = key;
		this.touch();
	}
	private validate(passphrase: string) {
		if (passphrase.length < 12) throw new VaultError("invalid_passphrase");
	}
	put(id: string, kind: string, value: string): void {
		const key = this.activeKey();
		const plain = Buffer.from(value);
		try {
			this.storage.put({
				id,
				kind,
				...encrypt(key, id, kind, plain),
				createdAt: new Date(this.now()).toISOString(),
			});
		} finally {
			plain.fill(0);
		}
	}
	get(id: string): string | undefined {
		const key = this.activeKey();
		const row = this.storage.get(id);
		if (!row) return undefined;
		const value = decrypt(key, id, row.kind, row);
		try {
			return value.toString();
		} finally {
			value.fill(0);
		}
	}
	has(id: string): boolean {
		return Boolean(this.storage.get(id));
	}
	delete(id: string): void {
		this.activeKey();
		this.storage.delete(id);
	}
	async changePassphrase(current: string, next: string): Promise<void> {
		this.activeKey();
		this.validate(next);
		const meta = this.storage.getMeta();
		if (!meta) throw new VaultError("vault_not_initialized");
		const generation = this.generation;
		const old = await derive(current, meta.salt);
		check(old, meta);
		const salt = randomBytes(16).toString("base64");
		let key: Buffer | undefined;
		try {
			key = await derive(next, salt);
			this.requireUnlocked();
			if (
				generation !== this.generation ||
				this.storage.getMeta()?.salt !== meta.salt
			)
				throw new VaultError("vault_locked");
			const nextKey = key;
			this.storage.transaction(() => {
				for (const row of this.storage.list()) {
					const value = decrypt(old, row.id, row.kind, row);
					try {
						this.storage.put({
							...row,
							...encrypt(nextKey, row.id, row.kind, value),
						});
					} finally {
						value.fill(0);
					}
				}
				this.storage.setMeta({
					v: 1,
					kdf: "scrypt",
					N: params.N,
					r: params.r,
					p: params.p,
					salt,
					check: encrypt(
						nextKey,
						"check",
						"check",
						Buffer.from("tax-tracker vault v1"),
					),
				});
			});
			this.lock();
			this.key = key;
			key = undefined;
			this.touch();
		} finally {
			old.fill(0);
			key?.fill(0);
		}
	}
	reset(input: unknown): void {
		if (
			!input ||
			typeof input !== "object" ||
			Object.keys(input).length !== 1 ||
			!("confirm" in input) ||
			input.confirm !== "RESET"
		)
			throw new VaultError("invalid_confirmation");
		this.storage.transaction(() => this.storage.clear());
		this.lock();
	}
}
