import * as api from "@tax/core/api";
import type { TaxDatabase } from "@tax/db";
import {
	checkConnection,
	createConnection,
	deleteConnection,
	listConnections,
	patchConnection,
} from "./connections";
import { required } from "./errors";
import { pricesStatus, startPriceFill } from "./price-jobs";
import { connectionBalances, startSync } from "./sync";
import { providers, vaultSession, vaultStatus } from "./vault";
export async function executePhase2(
	name: keyof typeof api.Phase2ApiContract,
	input: unknown,
	params: Record<string, string>,
	db: TaxDatabase,
): Promise<unknown> {
	const vault = await vaultSession(db);
	const id = params.id ?? "";
	switch (name) {
		case "getVault":
			return vaultStatus(vault);
		case "setupVault":
			await vault.setup(api.SetupVaultRequestSchema.parse(input).passphrase);
			return vaultStatus(vault);
		case "unlockVault":
			await vault.unlock(api.UnlockVaultRequestSchema.parse(input).passphrase);
			return vaultStatus(vault);
		case "lockVault":
			vault.lock();
			return vaultStatus(vault);
		case "changePassphrase": {
			const body = api.ChangePassphraseRequestSchema.parse(input);
			await vault.changePassphrase(body.current, body.next);
			return vaultStatus(vault);
		}
		case "resetVault":
			vault.reset(api.ResetVaultRequestSchema.parse(input));
			return vaultStatus(vault);
		case "getProviders":
			return providers(db);
		case "putProvider":
			vault.put(
				`provider:${api.ProviderNameSchema.parse(params.name)}`,
				"provider_key",
				api.PutProviderRequestSchema.parse(input).apiKey,
			);
			return providers(db);
		case "deleteProvider":
			vault.delete(`provider:${api.ProviderNameSchema.parse(params.name)}`);
			return providers(db);
		case "listConnections":
			return listConnections(db);
		case "createConnection":
			return createConnection(db, input);
		case "patchConnection":
			return patchConnection(db, id, input);
		case "deleteConnection":
			deleteConnection(db, id);
			return undefined;
		case "checkConnection":
			return checkConnection(db, id);
		case "syncConnection":
			return startSync(db, id);
		case "connectionBalances":
			return connectionBalances(db, id);
		case "getJob": {
			const row = required(db.jobs.get(id));
			return api.JobSchema.parse(row);
		}
		case "pricesStatus":
			return pricesStatus(db, api.PricesQuerySchema.parse(input).taxYear);
		case "fillPrices":
			return startPriceFill(db, api.PricesQuerySchema.parse(input).taxYear);
	}
}
