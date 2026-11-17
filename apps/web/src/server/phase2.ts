import * as api from "@tax/core/api";
import type { TaxDatabase } from "@tax/db";
import {
	checkConnection,
	createConnection,
	deleteConnection,
	listConnections,
	patchConnection,
} from "./connections";
import { ApiError, required } from "./errors";
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
		case "putProvider": {
			const name = api.ProviderNameSchema.parse(params.name);
			const body = api.PutProviderRequestSchema.parse(input);
			if (body.tier && name !== "etherscan")
				throw new ApiError(
					400,
					"validation_error",
					"Only Etherscan accepts a tier.",
				);
			db.atomic(() => {
				vault.put(`provider:${name}`, "provider_key", body.apiKey);
				if (name === "etherscan" && body.tier)
					db.settings.set("providers.etherscan.tier", body.tier);
			});
			return providers(db);
		}
		case "deleteProvider": {
			const name = api.ProviderNameSchema.parse(params.name);
			vault.delete(`provider:${name}`);
			if (name === "etherscan")
				db.settings.set("providers.etherscan.tier", "free");
			return providers(db);
		}
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
