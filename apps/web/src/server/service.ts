import * as api from "@tax/core/api";
import { listTaxYears } from "@tax/rules";
import { previewPayload, suggestRecipe } from "./ai/index";
import { invalidateSessions, login, sessionCookie } from "./auth";
import {
	applyBalanceSnapshot,
	listBalanceSnapshots,
} from "./balance-snapshots";
import { database } from "./context";
import { ApiError, required } from "./errors";
import { exportReport } from "./exports";
import type { Endpoint } from "./http";
import { confirmImport, createImport, previewRecipe } from "./imports";
import { executePhase2 } from "./phase2";
import { computeReport, getReport, putBalances } from "./reports";
import { getSettings, putSettings } from "./settings";
import {
	createTransaction,
	deleteTransaction,
	listTransactions,
	patchTransaction,
	review,
} from "./transactions";
import { vaultSession } from "./vault";
export async function execute(
	name: Endpoint,
	input: unknown,
	params: Record<string, string>,
	query: Record<string, unknown>,
	request: Request,
): Promise<{ value: unknown; headers?: Record<string, string> }> {
	const db = database();
	await vaultSession(db);
	if (name in api.Phase2ApiContract)
		return {
			value: await executePhase2(
				name as keyof typeof api.Phase2ApiContract,
				input,
				params,
				db,
			),
		};
	const id = params.id ?? "";
	const year = params.taxYear ?? "";
	let value: unknown;
	switch (name) {
		case "health":
			value = { ok: true, version: "0.1.0", dbOk: db.health() };
			break;
		case "getSettings":
			value = getSettings(db);
			break;
		case "putSettings":
			value = putSettings(db, api.PutSettingsRequestSchema.parse(input));
			break;
		case "taxYears":
			value = listTaxYears();
			break;
		case "createImport":
			value = await createImport(
				db,
				api.CreateImportRequestSchema.parse(input),
			);
			break;
		case "listImports":
			value = db.imports.list();
			break;
		case "getImport":
			value = required(db.imports.get(id));
			break;
		case "confirmImport":
			value = await confirmImport(
				db,
				id,
				api.ConfirmImportRequestSchema.parse(input),
			);
			break;
		case "deleteImport":
			if (
				db.imports
					.syncConnections(id)
					.some((connectionId) => db.jobs.running(connectionId))
			)
				throw new ApiError(
					409,
					"sync_running",
					"Wait for the linked connection's sync to finish before deleting this import.",
				);
			if (!db.imports.delete(id))
				throw new ApiError(404, "not_found", "Import not found.");
			break;
		case "previewPayload":
			value = previewPayload(db, api.PreviewPayloadRequestSchema.parse(input));
			break;
		case "suggestRecipe":
			value = await suggestRecipe(
				db,
				api.SuggestRecipeRequestSchema.parse(input),
			);
			break;
		case "previewRecipe":
			value = previewRecipe(db, api.PreviewRecipeRequestSchema.parse(input));
			break;
		case "listRecipes":
			value = db.recipes.list();
			break;
		case "deleteRecipe":
			if (!db.recipes.delete(id))
				throw new ApiError(404, "not_found", "Recipe not found.");
			break;
		case "listTransactions":
			value = listTransactions(db, api.TransactionsQuerySchema.parse(input));
			break;
		case "createTransaction":
			value = createTransaction(db, input);
			break;
		case "patchTransaction":
			value = patchTransaction(db, id, input);
			break;
		case "deleteTransaction":
			deleteTransaction(db, id);
			break;
		case "review":
			value = review(db, api.ReviewRequestSchema.parse(input).taxYear);
			break;
		case "listBalanceSnapshots":
			value = listBalanceSnapshots(db);
			break;
		case "applyBalanceSnapshot":
			value = applyBalanceSnapshot(
				db,
				id,
				api.ApplyBalanceSnapshotRequestSchema.parse(input).taxYear,
			);
			break;
		case "getActualBalances":
			value = db.actualBalances.get(
				api.ActualBalancesQuerySchema.parse(input).taxYear,
			);
			break;
		case "putActualBalances":
			value = putBalances(
				db,
				api.ActualBalancesQuerySchema.parse(query).taxYear,
				api.PutActualBalancesRequestSchema.parse(input),
			);
			break;
		case "computeReport":
			value = await computeReport(db, year);
			break;
		case "getReport":
			value = getReport(db, year);
			break;
		case "exportReport":
			value = await exportReport(
				getReport(db, year),
				api.ExportReportRequestSchema.parse(input),
			);
			break;
		case "login": {
			const token = login(api.LoginRequestSchema.parse(input).password);
			return {
				value: { ok: true },
				headers: {
					"Set-Cookie": sessionCookie(
						token,
						new URL(request.url).protocol === "https:",
					),
				},
			};
		}
		case "logout":
			invalidateSessions();
			(await vaultSession(db)).lock();
			return {
				value: undefined,
				headers: {
					"Set-Cookie": sessionCookie(
						"",
						new URL(request.url).protocol === "https:",
					),
				},
			};
	}
	return { value };
}
