import { execFileSync } from "node:child_process";
import { expect } from "vitest";
import { api, BASE_URL, call, fail, ok, ROOT, wipe } from "./lib";

export const MOCK_SYNC_PORT = Number(process.env.MOCK_SYNC_PORT ?? 11601);
export const MOCK_SYNC = `http://localhost:${MOCK_SYNC_PORT}`;
export const PROJECT = process.env.COMPOSE_PROJECT ?? "taxapi";
export const APP_PORT = process.env.APP_PORT ?? "3101";
export const PASS = "correct horse battery staple";
export const SYNC_TIMEOUT = 600_000;

export const WALLET_A = "0x5a17c9e3b4d28f6019ca7b3e5d8f2a4c6b1e9d70";
export const WALLET_B = "0x9c4e2a7d1f83b650e4d9a2c5f7b1e8d3a6c0b459";
export const CHAIN_IDS = [1, 8453, 42161, 137, 56] as const;

export const KEYS = {
	binanceKey: "mock-binance-key",
	binanceSecret: "mock-binance-secret",
	dcxKey: "mock-dcx-key",
	dcxSecret: "mock-dcx-secret",
	etherscan: "mock-etherscan-key",
	etherscanPaid: "mock-etherscan-paid-key",
	blockscout: "mock-blockscout-key",
	alchemy: "mock-alchemy-key",
	nodereal: "mock-nodereal-key",
	coingecko: "mock-coingecko-key",
};
/** Every secret the app is given; none may ever come back out. */
export const SECRETS = [
	KEYS.binanceSecret,
	KEYS.dcxSecret,
	KEYS.binanceKey,
	KEYS.dcxKey,
	KEYS.etherscan,
	KEYS.etherscanPaid,
	KEYS.blockscout,
	KEYS.alchemy,
	KEYS.nodereal,
	KEYS.coingecko,
	PASS,
];

export const HASH = {
	binanceToA:
		"0x54384b38e97e03d44bc1158616ccd431c3db3bdadd7f69c7f0066a948f1a529d",
	bToBinance:
		"0xce63aebf5339e600280ac09344f3337e6506e3387a2d7b53e69d3923ff07645c",
	aToB: "0xc9b4a25df76a3251030f5c50ca3888b61e011432319d8c984897d8289cc7295e",
	swap: "0xde70126bef21b4af3f2c56263037c6ea64651fd39150c9018f728ff064d1b31d",
	spam: "0x49ee4f71773ace339a85a076743a985ac3cd74061492ab43abde3bb14e7e162f",
	failedSwap:
		"0x4250c7dd03dd53cad203886c33e225ed55fc198e8a062899afab1ebf27b61d6a",
	approve: "0xdb520e2ef24fb7d776b7755dba1ea7d2fcde8383620e3dea37530c683b009320",
	baseWithdrawal:
		"0x773006ac7f9871986ffc3a6a24053788da45131399700e0583e6d4859b66c086",
	baseSwap:
		"0x4175ab429d1f9915ae7eeb75184c75bb66560288af72cd201ae03a23b7ac84a5",
	bridge: "0xa5be56b86cbd89d5534d3390cf0ddfa5c9ec3f5ffcb1d36c9b7c98aff0cd939e",
	bscUsdt: "0x4d495f1618bf5b00b493bbb75d50b6cf99b4495ce0d28076c75a3e469b92389a",
	bscBnb: "0x4d526d59e6385800539ecc3b6023f94ccb30649c430660f57c3e867d34d9b999",
	maticIn: "0xe71bc7ce4b5c12bd820c9a32a83a79dc626dfb65f1fccb2033f7af06a2a0c832",
	polIn: "0x7b4bef3bcf95e2e4ccb6e420f8edcfd11942da1fcfdfacfce4d225be5d56bb48",
};

export interface MockRequest {
	method: string;
	path: string;
	params: Record<string, string>;
	status: number;
	headers?: Record<string, string>;
}

export async function scenario(name: string, now?: string) {
	const res = await fetch(`${MOCK_SYNC}/__control`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ scenario: name, ...(now ? { now } : {}) }),
	});
	expect(res.ok).toBe(true);
}
export async function clearRequests() {
	await fetch(`${MOCK_SYNC}/__requests`, { method: "DELETE" });
}
export async function requests(): Promise<MockRequest[]> {
	const body = (await (await fetch(`${MOCK_SYNC}/__requests`)).json()) as
		| MockRequest[]
		| { requests: MockRequest[] };
	return (Array.isArray(body) ? body : body.requests).filter(
		(r) => !r.path.startsWith("/__"),
	);
}

export async function vaultStatus() {
	return ok(await call("GET", "/api/vault"), 200, api.VaultStatusSchema);
}
/** Brings the vault to "initialized + unlocked with PASS", resetting it if it holds another passphrase. */
export async function readyVault() {
	let status = await vaultStatus();
	if (status.initialized && !status.unlocked) {
		const res = await call("POST", "/api/vault/unlock", {
			json: { passphrase: PASS },
		});
		if (res.status !== 200)
			ok(
				await call("POST", "/api/vault/reset", { json: { confirm: "RESET" } }),
				200,
				api.VaultStatusSchema,
			);
		status = await vaultStatus();
	}
	if (!status.initialized)
		ok(
			await call("POST", "/api/vault/setup", { json: { passphrase: PASS } }),
			200,
			api.VaultStatusSchema,
		);
	expect((await vaultStatus()).unlocked).toBe(true);
}

export async function providers() {
	return ok(
		await call("GET", "/api/providers"),
		200,
		api.ProvidersResponseSchema,
	);
}
export async function putProvider(
	name: string,
	apiKey: string,
	tier?: "free" | "paid",
) {
	return ok(
		await call("PUT", `/api/providers/${name}`, {
			json: { apiKey, ...(tier ? { tier } : {}) },
		}),
		200,
		api.ProvidersResponseSchema,
	);
}
export async function allProviders() {
	await putProvider("etherscan", KEYS.etherscan, "free");
	await putProvider("blockscout", KEYS.blockscout);
	await putProvider("alchemy", KEYS.alchemy);
	await putProvider("nodereal", KEYS.nodereal);
	await putProvider("coingecko", KEYS.coingecko);
}
export async function clearProviders() {
	for (const name of [
		"etherscan",
		"blockscout",
		"alchemy",
		"nodereal",
		"coingecko",
	])
		await call("DELETE", `/api/providers/${name}`);
}

export async function connections() {
	return ok(
		await call("GET", "/api/connections"),
		200,
		api.ConnectionSchema.array(),
	);
}
export async function createConnection(body: Record<string, unknown>) {
	return ok(
		await call("POST", "/api/connections", { json: body }),
		201,
		api.ConnectionSchema,
	);
}
export const addBinance = (label = "Binance") =>
	createConnection({
		kind: "binance",
		label,
		apiKey: KEYS.binanceKey,
		apiSecret: KEYS.binanceSecret,
	});
export const addCoindcx = (label = "CoinDCX") =>
	createConnection({
		kind: "coindcx",
		label,
		apiKey: KEYS.dcxKey,
		apiSecret: KEYS.dcxSecret,
	});
export const addEvm = (address: string, chainId: number, label?: string) =>
	createConnection({
		kind: "evm",
		label: label ?? `${address.slice(0, 6)}@${chainId}`,
		address,
		chainId,
	});

export async function waitJob(id: string, timeout = SYNC_TIMEOUT) {
	const deadline = Date.now() + timeout;
	for (;;) {
		const job = ok(await call("GET", `/api/jobs/${id}`), 200, api.JobSchema);
		if (job.status === "completed" || job.status === "failed") return job;
		if (Date.now() > deadline) throw new Error(`job ${id} still ${job.status}`);
		await new Promise((r) => setTimeout(r, 400));
	}
}
export async function startSync(id: string) {
	return ok(
		await call("POST", `/api/connections/${id}/sync`),
		202,
		api.JobStartedSchema,
	).jobId;
}
export async function sync(id: string) {
	return waitJob(await startSync(id));
}
export async function syncOk(id: string) {
	const job = await sync(id);
	expect(job.status, job.error ?? "").toBe("completed");
	return api.SyncSummarySchema.parse(job.result);
}
export function streamTotals(summary: api.SyncSummary) {
	return summary.streams.reduce(
		(sum, s) => ({
			fetched: sum.fetched + s.rowsFetched,
			inserted: sum.inserted + s.rowsInserted,
			duplicate: sum.duplicate + s.rowsDuplicate,
		}),
		{ fetched: 0, inserted: 0, duplicate: 0 },
	);
}
export async function balances(id: string) {
	return ok(
		await call("GET", `/api/connections/${id}/balances`),
		200,
		api.ConnectionBalancesSchema,
	);
}

async function waitIdle() {
	const deadline = Date.now() + SYNC_TIMEOUT;
	while ((await connections()).some((c) => c.running)) {
		if (Date.now() > deadline) throw new Error("a sync is still running");
		await new Promise((r) => setTimeout(r, 500));
	}
}
/** Phase 1 wipe plus: no connections, no provider keys, a fresh unlocked vault, prices off, mock normal. */
export async function wipeP2() {
	await scenario("normal", "2026-04-01T00:00:00Z");
	await readyVault();
	await waitIdle();
	for (const c of await connections())
		expect((await call("DELETE", `/api/connections/${c.id}`)).status).toBe(204);
	await clearProviders();
	await wipe();
	ok(
		await call("PUT", "/api/settings", {
			json: {
				prices: { enabled: false, coingeckoFallback: true },
				marketPriceBasis: "close",
			},
		}),
		200,
		api.PutSettingsResponseSchema,
	);
	await clearRequests();
}

export async function uploadP2(
	bytes: Uint8Array | string,
	fileName: string,
	fields: {
		source?: string;
		timezone?: string;
		pdfPassword?: string;
		type?: string;
	} = {},
) {
	const form = new FormData();
	const data =
		typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
	form.set(
		"file",
		new Blob([data], { type: fields.type ?? "text/csv" }),
		fileName,
	);
	if (fields.source !== undefined) form.set("source", fields.source);
	form.set("timezone", fields.timezone ?? "UTC");
	if (fields.pdfPassword !== undefined)
		form.set("pdfPassword", fields.pdfPassword);
	return call("POST", "/api/imports", { body: form });
}

export function expectNoSecrets(text: string, where: string) {
	for (const secret of SECRETS)
		expect(text.includes(secret), `${where} contains ${secret}`).toBe(false);
}

export function dockerLogs(): string {
	return execFileSync(
		"docker",
		["compose", "-p", PROJECT, "logs", "--no-color", "app"],
		{ cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
	);
}

function currentDataDir(): string {
	const source = execFileSync(
		"docker",
		[
			"inspect",
			`${PROJECT}-app-1`,
			"--format",
			"{{range .Mounts}}{{.Source}}{{end}}",
		],
		{ encoding: "utf8" },
	).trim();
	return source.replace(/^\/host_mnt/, "");
}
/** Recreates the app container on the SAME data dir (a restart), with optional extra env. */
export async function restartSameData(env: Record<string, string> = {}) {
	const dataDir = currentDataDir();
	execFileSync(
		"docker",
		[
			"compose",
			"-p",
			PROJECT,
			"up",
			"-d",
			"--no-build",
			"--force-recreate",
			"app",
		],
		{
			cwd: ROOT,
			env: {
				...process.env,
				APP_PORT,
				DATA_HOST_DIR: dataDir,
				APP_PASSWORD: "",
				SECRETS_PASSPHRASE: "",
				...env,
			},
			stdio: "pipe",
		},
	);
	const deadline = Date.now() + 90_000;
	while (Date.now() < deadline) {
		try {
			if ((await fetch(`${BASE_URL}/api/health`)).ok) return dataDir;
		} catch {}
		await new Promise((r) => setTimeout(r, 500));
	}
	throw new Error("app did not become healthy");
}

export { api, call, fail, ok };

/** Read-only peek into the app's SQLite file for state the API does not expose (secrets, cursors). */
export function db(sql: string): string {
	return execFileSync(
		"sqlite3",
		["-readonly", `${currentDataDir()}/tax-tracker.db`, sql],
		{ encoding: "utf8" },
	).trim();
}
