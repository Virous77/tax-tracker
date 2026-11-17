import {
	type AssetPriceId,
	type CachedPrice,
	type ConnectorKind,
	D,
	type FetchedBalance,
} from "@tax/core";
import { type ConnectionOptions, ConnectionOptionsSchema } from "@tax/core/api";
import type { Database } from "better-sqlite3";

export interface ConnectionRecord {
	id: string;
	kind: ConnectorKind;
	label: string;
	chainId?: number;
	address?: string;
	options: ConnectionOptions;
	createdAt: string;
	lastSyncAt: string | null;
	lastSyncStatus: string | null;
	lastSyncError: string | null;
}
interface StoredConnection {
	id: string;
	kind: ConnectorKind;
	label: string;
	chain_id: number | null;
	address: string | null;
	options_json: string;
	created_at: string;
	last_sync_at: string | null;
	last_sync_status: string | null;
	last_sync_error: string | null;
}
export interface Secret {
	id: string;
	kind: string;
	iv: string;
	ct: string;
	tag: string;
	createdAt: string;
}
export interface Blob {
	iv: string;
	ct: string;
	tag: string;
}
export interface Meta {
	v: 1;
	kdf: "scrypt";
	N: number;
	r: number;
	p: number;
	salt: string;
	check: Blob;
}
function connection(row: StoredConnection): ConnectionRecord {
	return {
		id: row.id,
		kind: row.kind,
		label: row.label,
		...(row.chain_id === null ? {} : { chainId: row.chain_id }),
		...(row.address === null ? {} : { address: row.address }),
		options: ConnectionOptionsSchema.parse(JSON.parse(row.options_json)),
		createdAt: row.created_at,
		lastSyncAt: row.last_sync_at,
		lastSyncStatus: row.last_sync_status,
		lastSyncError: row.last_sync_error,
	};
}
export function phase2Repositories(sqlite: Database, invalidate: () => void) {
	return {
		vault: {
			getMeta: (): Meta | undefined => {
				const row = sqlite
					.prepare("SELECT json FROM vault_meta WHERE id=1")
					.get() as { json: string } | undefined;
				return row ? (JSON.parse(row.json) as Meta) : undefined;
			},
			setMeta: (meta: Meta) => {
				sqlite
					.prepare(
						"INSERT INTO vault_meta(id,json) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json",
					)
					.run(JSON.stringify(meta));
			},
			list: (): Secret[] =>
				sqlite
					.prepare(
						"SELECT id,kind,iv,ct,tag,created_at AS createdAt FROM secrets",
					)
					.all() as Secret[],
			get: (id: string): Secret | undefined =>
				sqlite
					.prepare(
						"SELECT id,kind,iv,ct,tag,created_at AS createdAt FROM secrets WHERE id=?",
					)
					.get(id) as Secret | undefined,
			put: (row: Secret) => {
				sqlite
					.prepare(
						"INSERT INTO secrets(id,kind,iv,ct,tag,created_at) VALUES(@id,@kind,@iv,@ct,@tag,@createdAt) ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,iv=excluded.iv,ct=excluded.ct,tag=excluded.tag",
					)
					.run(row);
			},
			delete: (id: string) => {
				sqlite.prepare("DELETE FROM secrets WHERE id=?").run(id);
			},
			clear: () => {
				sqlite.prepare("DELETE FROM secrets").run();
				sqlite.prepare("DELETE FROM vault_meta").run();
			},
			transaction: <T>(fn: () => T): T => sqlite.transaction(fn)(),
		},
		connections: {
			list: (): ConnectionRecord[] =>
				(
					sqlite
						.prepare("SELECT * FROM connections ORDER BY created_at,id")
						.all() as StoredConnection[]
				).map(connection),
			get: (id: string): ConnectionRecord | undefined => {
				const row = sqlite
					.prepare("SELECT * FROM connections WHERE id=?")
					.get(id) as StoredConnection | undefined;
				return row ? connection(row) : undefined;
			},
			save: (row: ConnectionRecord) => {
				sqlite
					.prepare(
						"INSERT INTO connections(id,kind,label,chain_id,address,options_json,created_at,last_sync_at,last_sync_status,last_sync_error) VALUES(@id,@kind,@label,@chainId,@address,@options,@createdAt,@lastSyncAt,@lastSyncStatus,@lastSyncError) ON CONFLICT(id) DO UPDATE SET label=excluded.label,options_json=excluded.options_json,last_sync_at=excluded.last_sync_at,last_sync_status=excluded.last_sync_status,last_sync_error=excluded.last_sync_error",
					)
					.run({
						...row,
						chainId: row.chainId ?? null,
						address: row.address ?? null,
						options: JSON.stringify(row.options),
					});
				return row;
			},
			delete: (id: string) =>
				sqlite.transaction(() => {
					sqlite
						.prepare("DELETE FROM secrets WHERE id IN (?,?)")
						.run(`conn:${id}:key`, `conn:${id}:secret`);
					return (
						sqlite.prepare("DELETE FROM connections WHERE id=?").run(id)
							.changes > 0
					);
				})(),
		},
		cursors: {
			get: (id: string): Record<string, unknown> =>
				Object.fromEntries(
					(
						sqlite
							.prepare(
								"SELECT stream,cursor_json FROM sync_cursors WHERE connection_id=?",
							)
							.all(id) as { stream: string; cursor_json: string }[]
					).map((row) => [row.stream, JSON.parse(row.cursor_json)]),
				),
			save: (id: string, stream: string, cursor: unknown) => {
				sqlite
					.prepare(
						"INSERT INTO sync_cursors(connection_id,stream,cursor_json,updated_at) VALUES(?,?,?,?) ON CONFLICT(connection_id,stream) DO UPDATE SET cursor_json=excluded.cursor_json,updated_at=excluded.updated_at",
					)
					.run(
						id,
						stream,
						JSON.stringify(cursor ?? null),
						new Date().toISOString(),
					);
			},
			reset: (id: string) => {
				sqlite
					.prepare("DELETE FROM sync_cursors WHERE connection_id=?")
					.run(id);
			},
		},
		fetchedBalances: {
			list: (id: string) =>
				sqlite
					.prepare(
						"SELECT asset,wallet,amount,fetched_at AS fetchedAt FROM fetched_balances WHERE connection_id=? ORDER BY asset,wallet",
					)
					.all(id) as (FetchedBalance & { fetchedAt: string })[],
			replace: (id: string, rows: FetchedBalance[], fetchedAt: string) =>
				sqlite.transaction(() => {
					sqlite
						.prepare("DELETE FROM fetched_balances WHERE connection_id=?")
						.run(id);
					const totals = new Map<string, FetchedBalance>();
					for (const row of rows) {
						const key = JSON.stringify([row.asset, row.wallet ?? ""]);
						const previous = totals.get(key);
						totals.set(key, {
							...row,
							amount: D(previous?.amount ?? "0")
								.plus(row.amount)
								.toFixed(),
						});
					}
					for (const row of totals.values())
						sqlite
							.prepare(
								"INSERT INTO fetched_balances(connection_id,asset,wallet,amount,fetched_at) VALUES(?,?,?,?,?)",
							)
							.run(id, row.asset, row.wallet ?? "", row.amount, fetchedAt);
				})(),
		},
		prices: {
			all: (): CachedPrice[] =>
				sqlite
					.prepare(
						"SELECT source,source_id AS sourceId,quote,day_basis AS dayBasis,date,kind,price,final,fetched_at AS fetchedAt FROM price_cache",
					)
					.all()
					.map((value) => {
						const row = value as Omit<CachedPrice, "final"> & { final: number };
						return { ...row, final: row.final === 1 };
					}),
			mappings: (): AssetPriceId[] =>
				sqlite
					.prepare(
						"SELECT asset,chain,source,source_id AS sourceId FROM asset_price_ids",
					)
					.all() as AssetPriceId[],
			map: (row: AssetPriceId) => {
				sqlite
					.prepare(
						"INSERT INTO asset_price_ids(asset,chain,source,source_id) VALUES(?,?,?,?) ON CONFLICT(asset,chain,source) DO UPDATE SET source_id=excluded.source_id",
					)
					.run(row.asset, row.chain ?? "", row.source, row.sourceId);
			},
			save: (rows: CachedPrice[]) =>
				sqlite.transaction(() => {
					let changed = 0;
					for (const row of rows)
						changed += sqlite
							.prepare(
								"INSERT INTO price_cache(source,source_id,quote,day_basis,date,kind,price,final,fetched_at) VALUES(@source,@sourceId,@quote,@dayBasis,@date,@kind,@price,@final,@fetchedAt) ON CONFLICT(source,source_id,quote,day_basis,date,kind) DO UPDATE SET price=excluded.price,final=excluded.final,fetched_at=excluded.fetched_at WHERE price_cache.final=0",
							)
							.run({ ...row, final: row.final ? 1 : 0 }).changes;
					if (changed) invalidate();
				})(),
		},
	};
}
