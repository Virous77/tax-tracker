import { randomUUID } from "node:crypto";
import type { ConnectorProgress, EvmProviderConfig } from "@tax/core";
import {
	type Connection,
	CreateConnectionRequestSchema,
	PatchConnectionRequestSchema,
} from "@tax/core/api";
import type { TaxDatabase } from "@tax/db";
import { baseUrls, connectorFor, type SyncOptions } from "./connectors";
import { ApiError, required } from "./errors";
import { vaultSession } from "./vault";

export function connectionView(db: TaxDatabase, id: string): Connection {
	const row = required(db.connections.get(id));
	const keySet =
		row.kind === "evm"
			? (row.options.providers ?? ["etherscan", "blockscout"]).some(
					(provider) => Boolean(db.vault.get(`provider:${provider}`)),
				)
			: Boolean(
					db.vault.get(`conn:${id}:key`) && db.vault.get(`conn:${id}:secret`),
				);
	return { ...row, keySet, running: db.jobs.running(id) };
}
export const listConnections = (db: TaxDatabase): Connection[] =>
	db.connections.list().map((row) => connectionView(db, row.id));
export async function createConnection(
	db: TaxDatabase,
	input: unknown,
): Promise<Connection> {
	const body = CreateConnectionRequestSchema.parse(input);
	const vault = await vaultSession(db);
	if (body.kind !== "evm") vault.requireUnlocked();
	const duplicate = db.connections
		.list()
		.some(
			(row) =>
				row.kind === body.kind &&
				(body.kind === "evm"
					? row.chainId === (body.chainId ?? 1) && row.address === body.address
					: vault.get(`conn:${row.id}:key`) === body.apiKey),
		);
	if (duplicate)
		throw new ApiError(409, "conflict", "This connection already exists.");
	const id = randomUUID();
	db.atomic(() => {
		db.connections.save({
			id,
			kind: body.kind,
			label: body.label,
			...(body.kind === "evm"
				? { chainId: body.chainId ?? 1, address: body.address }
				: {}),
			options: body.options ?? {},
			createdAt: new Date().toISOString(),
			lastSyncAt: null,
			lastSyncStatus: null,
			lastSyncError: null,
		});
		if (body.kind !== "evm") {
			vault.put(`conn:${id}:key`, "exchange_key", body.apiKey ?? "");
			vault.put(`conn:${id}:secret`, "exchange_secret", body.apiSecret ?? "");
		}
	});
	return connectionView(db, id);
}
export async function patchConnection(
	db: TaxDatabase,
	id: string,
	input: unknown,
): Promise<Connection> {
	const row = required(db.connections.get(id));
	const body = PatchConnectionRequestSchema.parse(input);
	if (db.jobs.running(id))
		throw new ApiError(
			409,
			"sync_running",
			"Wait for this connection's sync to finish.",
		);
	const vault = await vaultSession(db);
	if (body.apiKey || body.apiSecret) {
		if (row.kind === "evm")
			throw new ApiError(
				400,
				"validation_error",
				"Use provider keys for Ethereum connections.",
			);
		vault.requireUnlocked();
	}
	if (
		body.apiKey &&
		db.connections
			.list()
			.some(
				(other) =>
					other.id !== id &&
					other.kind === row.kind &&
					vault.get(`conn:${other.id}:key`) === body.apiKey,
			)
	)
		throw new ApiError(409, "conflict", "This connection already exists.");
	db.atomic(() => {
		db.connections.save({
			...row,
			label: body.label ?? row.label,
			options: body.options ?? row.options,
		});
		if (body.apiKey) vault.put(`conn:${id}:key`, "exchange_key", body.apiKey);
		if (body.apiSecret)
			vault.put(`conn:${id}:secret`, "exchange_secret", body.apiSecret);
	});
	return connectionView(db, id);
}
export function deleteConnection(db: TaxDatabase, id: string): void {
	required(db.connections.get(id));
	if (db.jobs.running(id))
		throw new ApiError(
			409,
			"sync_running",
			"Wait for this connection's sync to finish.",
		);
	db.connections.delete(id);
}
export async function connectionOptions(
	db: TaxDatabase,
	id: string,
	signal?: AbortSignal,
	onProgress?: (p: ConnectorProgress) => void,
): Promise<SyncOptions> {
	const row = required(db.connections.get(id));
	const vault = await vaultSession(db);
	vault.requireUnlocked();
	const common = {
		baseUrls: baseUrls(),
		cursors: db.cursors.get(id),
		signal,
		onProgress,
	};
	if (row.kind === "evm") {
		const providers: EvmProviderConfig[] = [];
		for (const kind of row.options.providers ??
			(["etherscan", "blockscout"] as const)) {
			const apiKey = vault.get(`provider:${kind}`);
			if (apiKey) providers.push({ kind, apiKey });
		}
		if (!providers.length)
			throw new ApiError(
				409,
				"provider_key_required",
				"Configure an Etherscan or Blockscout provider key first.",
			);
		return {
			...common,
			chainId: row.chainId ?? 1,
			address: row.address ?? "",
			ownAddresses: db.connections
				.list()
				.filter(
					(other) => other.kind === "evm" && other.chainId === row.chainId,
				)
				.flatMap((other) => (other.address ? [other.address] : [])),
			providers,
		};
	}
	const apiKey = vault.get(`conn:${id}:key`),
		apiSecret = vault.get(`conn:${id}:secret`);
	if (!apiKey || !apiSecret)
		throw new ApiError(
			409,
			"connection_key_required",
			"Enter this connection's API key and secret.",
		);
	return {
		...common,
		credentials: { apiKey, apiSecret },
		knownAssets: [
			...new Set(
				db.transactions
					.all()
					.flatMap((tx) =>
						[tx.assetIn, tx.assetOut, tx.feeAsset].filter(
							(asset): asset is string => Boolean(asset),
						),
					),
			),
		],
		extraSymbols: row.options.extraSymbols ?? [],
	};
}
export async function checkConnection(db: TaxDatabase, id: string) {
	const row = required(db.connections.get(id));
	return connectorFor(row.kind).checkKey(await connectionOptions(db, id));
}
