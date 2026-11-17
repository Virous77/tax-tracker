import { UpstreamAuthError, UpstreamError } from "@tax/sync/http";
import { VaultError } from "@tax/vault";
import { ApiError } from "./errors";
export function publicError(error: unknown): ApiError {
	if (error instanceof ApiError) return error;
	if (error instanceof VaultError) {
		const status = {
			vault_locked: 423,
			vault_not_initialized: 409,
			wrong_passphrase: 401,
			vault_initialized: 409,
			invalid_passphrase: 400,
			invalid_confirmation: 400,
		}[error.code];
		return new ApiError(status, error.code, error.code.replaceAll("_", " "));
	}
	if (error instanceof UpstreamAuthError)
		return new ApiError(502, "upstream_auth", error.message);
	if (error instanceof UpstreamError)
		return new ApiError(502, "upstream_unavailable", error.message);
	return new ApiError(
		500,
		"internal_error",
		"The operation could not be completed.",
	);
}
