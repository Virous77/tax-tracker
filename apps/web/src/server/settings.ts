import { EngineSettingsSchema, isLocalAiEndpoint } from "@tax/core";
import { SettingsResponseSchema, type SettingsUpdate } from "@tax/core/api";
import type { TaxDatabase } from "@tax/db";
import { listTaxYears } from "@tax/rules";
import { ApiError } from "./errors";
export function aiConfiguration(db: TaxDatabase) {
	const value = db.settings.get("ai") as
		| {
				baseUrl?: string;
				model?: string;
				apiKey?: string;
				cloudAcknowledged?: boolean;
		  }
		| undefined;
	return {
		baseUrl:
			value?.baseUrl ?? process.env.AI_BASE_URL ?? "http://ollama:11434/v1",
		model: value?.model ?? process.env.AI_MODEL ?? "",
		apiKey: value?.apiKey ?? process.env.AI_API_KEY ?? "",
		cloudAcknowledged: value?.cloudAcknowledged ?? false,
	};
}
export function getSettings(db: TaxDatabase) {
	const ai = aiConfiguration(db);
	return SettingsResponseSchema.parse({
		...EngineSettingsSchema.parse(db.settings.get("engine") ?? {}),
		defaultTaxYear: db.settings.get("defaultTaxYear") ?? "2026-27",
		ai: {
			baseUrl: ai.baseUrl,
			model: ai.model,
			apiKeySet: Boolean(ai.apiKey),
			cloudAcknowledged: ai.cloudAcknowledged,
		},
	});
}
export function checkAiEndpoint(
	ai: ReturnType<typeof aiConfiguration>,
	requireModel = false,
): void {
	const url = new URL(ai.baseUrl);
	if (
		!["http:", "https:"].includes(url.protocol) ||
		url.username ||
		url.password ||
		url.search ||
		url.hash
	)
		throw new ApiError(
			400,
			"validation_error",
			"AI endpoint must be an HTTP(S) URL without credentials, query or fragment.",
		);
	if (!isLocalAiEndpoint(ai.baseUrl) && (!ai.cloudAcknowledged || !ai.apiKey))
		throw new ApiError(
			400,
			"cloud_acknowledgement_required",
			"Cloud AI requires an API key and cloudAcknowledged: true.",
		);
	if (requireModel && !ai.model.trim())
		throw new ApiError(
			400,
			"validation_error",
			"Configure an AI model before requesting a suggestion.",
		);
}
export function putSettings(db: TaxDatabase, patch: SettingsUpdate) {
	const { ai, defaultTaxYear, ...engine } = patch;
	if (
		defaultTaxYear !== undefined &&
		!listTaxYears().some((year) => year.id === defaultTaxYear)
	)
		throw new ApiError(
			400,
			"validation_error",
			"Default tax year must have an available rule file.",
		);
	const current = getSettings(db);
	const nextAi = { ...aiConfiguration(db), ...ai };
	if (ai) checkAiEndpoint(nextAi);
	db.atomic(() => {
		db.settings.set(
			"engine",
			EngineSettingsSchema.parse({ ...current, ...engine }),
		);
		if (defaultTaxYear !== undefined)
			db.settings.set("defaultTaxYear", defaultTaxYear);
		if (ai) db.settings.set("ai", nextAi);
	});
	return getSettings(db);
}
