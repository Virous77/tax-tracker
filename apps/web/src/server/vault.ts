import type { TaxDatabase } from "@tax/db";
import { Vault } from "@tax/vault";

const sessions = new Map<TaxDatabase, Promise<Vault>>();
export function vaultSession(db: TaxDatabase): Promise<Vault> {
	let session = sessions.get(db);
	if (!session) {
		session = (async () => {
			const vault = new Vault(db.vault);
			const passphrase = process.env.SECRETS_PASSPHRASE;
			if (passphrase) {
				try {
					if (vault.status().initialized) await vault.unlock(passphrase);
					else await vault.setup(passphrase);
				} catch {
					vault.lock();
				}
			}
			return vault;
		})();
		sessions.set(db, session);
	}
	return session;
}
export function closeVaultSessions(): void {
	for (const session of sessions.values())
		void session.then((vault) => vault.lock());
	sessions.clear();
}
export function vaultStatus(vault: Vault) {
	return {
		...vault.status(),
		autoUnlock: Boolean(process.env.SECRETS_PASSPHRASE),
	};
}
export function providers(db: TaxDatabase) {
	return {
		etherscan: {
			keySet: Boolean(db.vault.get("provider:etherscan")),
			tier: etherscanTier(db),
		},
		alchemy: { keySet: Boolean(db.vault.get("provider:alchemy")) },
		nodereal: { keySet: Boolean(db.vault.get("provider:nodereal")) },
		blockscout: { keySet: Boolean(db.vault.get("provider:blockscout")) },
		coingecko: { keySet: Boolean(db.vault.get("provider:coingecko")) },
		polygon: { keySet: Boolean(db.vault.get("provider:polygon")) },
		finnhub: { keySet: Boolean(db.vault.get("provider:finnhub")) },
	};
}

export function etherscanTier(db: TaxDatabase): "free" | "paid" {
	return db.settings.get("providers.etherscan.tier") === "paid"
		? "paid"
		: "free";
}
