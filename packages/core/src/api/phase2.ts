import { z } from "zod";
import { AssetSchema, DecimalStringSchema, TaxYearSchema } from "../ledger.js";

const empty = z.object({}).strict();
const id = z.object({ id: z.string().min(1) });
const count = z.number().int().nonnegative();
export const PricesSettingsSchema = z.object({
	enabled: z.boolean().default(false),
	coingeckoFallback: z.boolean().default(true),
});
export const PricesSettingsPatchSchema = z
	.object({
		enabled: z.boolean().optional(),
		coingeckoFallback: z.boolean().optional(),
	})
	.strict();
export const VaultStatusSchema = z.object({
	initialized: z.boolean(),
	unlocked: z.boolean(),
	autoUnlock: z.boolean(),
	idleLockMinutes: z.number(),
});
export const SetupVaultRequestSchema = z
	.object({ passphrase: z.string().min(12) })
	.strict();
export const UnlockVaultRequestSchema = z
	.object({ passphrase: z.string() })
	.strict();
export const ChangePassphraseRequestSchema = z
	.object({ current: z.string(), next: z.string().min(12) })
	.strict();
export const ResetVaultRequestSchema = z
	.object({ confirm: z.literal("RESET") })
	.strict();
export const ProviderNameSchema = z.enum([
	"etherscan",
	"blockscout",
	"coingecko",
]);
export const ProvidersResponseSchema = z.object({
	etherscan: z.object({ keySet: z.boolean() }),
	blockscout: z.object({ keySet: z.boolean() }),
	coingecko: z.object({ keySet: z.boolean() }),
});
export const PutProviderRequestSchema = z
	.object({ apiKey: z.string().trim().min(1) })
	.strict();
export const ConnectionOptionsSchema = z
	.object({
		extraSymbols: z.array(z.string().regex(/^[A-Z0-9]+$/)).optional(),
		providers: z
			.array(z.enum(["etherscan", "blockscout"]))
			.min(1)
			.optional(),
	})
	.strict();
export const ConnectionKindSchema = z.enum(["binance", "coindcx", "evm"]);
export const ConnectionSchema = z.object({
	id: z.string(),
	kind: ConnectionKindSchema,
	label: z.string(),
	chainId: z.number().int().optional(),
	address: z.string().optional(),
	options: ConnectionOptionsSchema,
	keySet: z.boolean(),
	lastSyncAt: z.iso.datetime().nullable(),
	lastSyncStatus: z.string().nullable(),
	lastSyncError: z.string().nullable(),
	running: z.boolean(),
});
export const CreateConnectionRequestSchema = z
	.object({
		kind: ConnectionKindSchema,
		label: z.string().trim().min(1),
		apiKey: z.string().min(1).optional(),
		apiSecret: z.string().min(1).optional(),
		address: z
			.string()
			.regex(/^0x[0-9a-fA-F]{40}$/)
			.transform((v) => v.toLowerCase())
			.optional(),
		chainId: z.literal(1).optional(),
		options: ConnectionOptionsSchema.optional(),
	})
	.strict()
	.superRefine((v, ctx) => {
		for (const field of (v.kind === "evm"
			? ["address"]
			: ["apiKey", "apiSecret"]) as ("address" | "apiKey" | "apiSecret")[])
			if (!v[field])
				ctx.addIssue({
					code: "custom",
					path: [field],
					message: "Required for this connection kind",
				});
	});
export const PatchConnectionRequestSchema = z
	.object({
		label: z.string().trim().min(1).optional(),
		options: ConnectionOptionsSchema.optional(),
		apiKey: z.string().min(1).optional(),
		apiSecret: z.string().min(1).optional(),
	})
	.strict();
export const KeyCheckSchema = z.object({
	ok: z.boolean(),
	readOnly: z.boolean().nullable(),
	permissions: z.array(z.string()),
	message: z.string(),
});
export const FetchedBalanceSchema = z.object({
	asset: AssetSchema,
	amount: DecimalStringSchema,
	wallet: z.string().optional(),
});
export const BalanceCheckRowSchema = z.object({
	asset: AssetSchema,
	fetched: DecimalStringSchema,
	computed: DecimalStringSchema,
	difference: DecimalStringSchema,
});
export const ConnectionBalancesSchema = z.object({
	fetchedAt: z.iso.datetime().nullable(),
	rows: z.array(BalanceCheckRowSchema.extend({ flagged: z.boolean() })),
});
export const SyncSummarySchema = z.object({
	importId: z.string(),
	streams: z.array(
		z.object({
			stream: z.string(),
			rowsFetched: count,
			rowsInserted: count,
			rowsDuplicate: count,
			rowsFlagged: count,
			incomplete: z.string().optional(),
		}),
	),
	balanceCheck: z.array(BalanceCheckRowSchema),
	notices: z.array(z.string()),
});
export const MissingPriceSchema = z.object({
	asset: AssetSchema,
	date: z.iso.date(),
});
export const PriceFillSummarySchema = z.object({
	requested: count,
	fetched: count,
	fromCache: count,
	missing: z.array(MissingPriceSchema),
});
export const JobStartedSchema = z.object({ jobId: z.string() });
export const JobProgressSchema = z.object({
	stream: z.string(),
	streamsDone: count,
	streamsTotal: count.nullable(),
	rowsFetched: count,
});
export const JobSchema = z.object({
	id: z.string(),
	kind: z.enum(["sync", "price_fill"]),
	status: z.enum(["pending", "running", "completed", "failed"]),
	progress: JobProgressSchema.nullable().optional(),
	result: z
		.union([SyncSummarySchema, PriceFillSummarySchema])
		.nullable()
		.optional(),
	error: z.string().nullable().optional(),
});
export const PricesQuerySchema = z.object({ taxYear: TaxYearSchema });
export const PricesStatusSchema = z.object({
	enabled: z.boolean(),
	needed: count,
	cached: count,
	missing: z.array(MissingPriceSchema),
	sources: z.object({
		binanceKlines: z.literal(true),
		coingecko: z.object({ keySet: z.boolean() }),
	}),
});
export type Connection = z.infer<typeof ConnectionSchema>;
export type ConnectionOptions = z.infer<typeof ConnectionOptionsSchema>;
export type SyncSummary = z.infer<typeof SyncSummarySchema>;
export type PriceFillSummary = z.infer<typeof PriceFillSummarySchema>;
export type BalanceCheckRow = z.infer<typeof BalanceCheckRowSchema>;
export const Phase2ApiContract = {
	getVault: {
		method: "GET",
		path: "/api/vault",
		request: empty,
		response: VaultStatusSchema,
	},
	setupVault: {
		method: "POST",
		path: "/api/vault/setup",
		request: SetupVaultRequestSchema,
		response: VaultStatusSchema,
	},
	unlockVault: {
		method: "POST",
		path: "/api/vault/unlock",
		request: UnlockVaultRequestSchema,
		response: VaultStatusSchema,
	},
	lockVault: {
		method: "POST",
		path: "/api/vault/lock",
		request: empty,
		response: VaultStatusSchema,
	},
	changePassphrase: {
		method: "POST",
		path: "/api/vault/change-passphrase",
		request: ChangePassphraseRequestSchema,
		response: VaultStatusSchema,
	},
	resetVault: {
		method: "POST",
		path: "/api/vault/reset",
		request: ResetVaultRequestSchema,
		response: VaultStatusSchema,
	},
	getProviders: {
		method: "GET",
		path: "/api/providers",
		request: empty,
		response: ProvidersResponseSchema,
	},
	putProvider: {
		method: "PUT",
		path: "/api/providers/:name",
		params: z.object({ name: ProviderNameSchema }),
		request: PutProviderRequestSchema,
		response: ProvidersResponseSchema,
	},
	deleteProvider: {
		method: "DELETE",
		path: "/api/providers/:name",
		params: z.object({ name: ProviderNameSchema }),
		request: empty,
		response: ProvidersResponseSchema,
	},
	listConnections: {
		method: "GET",
		path: "/api/connections",
		request: empty,
		response: z.array(ConnectionSchema),
	},
	createConnection: {
		method: "POST",
		path: "/api/connections",
		request: CreateConnectionRequestSchema,
		response: ConnectionSchema,
	},
	patchConnection: {
		method: "PATCH",
		path: "/api/connections/:id",
		params: id,
		request: PatchConnectionRequestSchema,
		response: ConnectionSchema,
	},
	deleteConnection: {
		method: "DELETE",
		path: "/api/connections/:id",
		params: id,
		request: empty,
		response: z.undefined(),
	},
	checkConnection: {
		method: "POST",
		path: "/api/connections/:id/check",
		params: id,
		request: empty,
		response: KeyCheckSchema,
	},
	syncConnection: {
		method: "POST",
		path: "/api/connections/:id/sync",
		params: id,
		request: empty,
		response: JobStartedSchema,
	},
	connectionBalances: {
		method: "GET",
		path: "/api/connections/:id/balances",
		params: id,
		request: empty,
		response: ConnectionBalancesSchema,
	},
	getJob: {
		method: "GET",
		path: "/api/jobs/:id",
		params: id,
		request: empty,
		response: JobSchema,
	},
	pricesStatus: {
		method: "GET",
		path: "/api/prices/status",
		request: PricesQuerySchema,
		response: PricesStatusSchema,
	},
	fillPrices: {
		method: "POST",
		path: "/api/prices/fill",
		request: PricesQuerySchema,
		response: JobStartedSchema,
	},
} as const;
