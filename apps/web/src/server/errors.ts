export class ApiError extends Error {
	constructor(
		public status: number,
		public code: string,
		message: string,
		public details?: unknown,
	) {
		super(message);
	}
}
export function required<T>(
	value: T | undefined,
	message = "Resource not found",
): T {
	if (value === undefined) throw new ApiError(404, "not_found", message);
	return value;
}
