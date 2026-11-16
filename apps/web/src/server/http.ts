import { ApiContract, ErrorEnvelopeSchema } from "@tax/core/api";
import { z } from "zod";
import { SESSION_COOKIE, validSession } from "./auth";
import { ApiError } from "./errors";
import { execute } from "./service";
export type Endpoint = keyof typeof ApiContract;
const fileLimit = 25 * 1024 * 1024;
async function importBody(request: Request) {
	if (
		!request.headers
			.get("content-type")
			?.toLowerCase()
			.startsWith("multipart/form-data;")
	)
		throw new ApiError(
			400,
			"validation_error",
			"Use multipart/form-data for imports.",
		);
	const bytes = await readBody(request, fileLimit + 65536);
	let form: FormData;
	try {
		form = await new Request(request.url, {
			method: "POST",
			headers: request.headers,
			body: bytes,
		}).formData();
	} catch {
		throw new ApiError(400, "validation_error", "Invalid multipart upload.");
	}
	const file = form.get("file");
	if (!(file instanceof File))
		throw new ApiError(
			400,
			"validation_error",
			"An uploaded file is required.",
		);
	if (file.size > fileLimit)
		throw new ApiError(413, "file_too_large", "File exceeds 25 MB.");
	const mime = file.type.toLowerCase();
	if (
		![
			"",
			"text/csv",
			"application/csv",
			"application/octet-stream",
			"application/vnd.ms-excel",
			"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
		].includes(mime)
	)
		throw new ApiError(
			422,
			"unsupported_file",
			"Only CSV and XLSX exports are supported.",
		);
	const fileName = file.name.split(/[\\/]/).at(-1) ?? "";
	if (!/\.(csv|xlsx)$/i.test(fileName))
		throw new ApiError(
			422,
			"unsupported_file",
			"Only .csv and .xlsx files are supported.",
		);
	return {
		file: new Uint8Array(await file.arrayBuffer()),
		fileName,
		source: form.get("source") ?? "auto",
		timezone: form.get("timezone"),
	};
}
async function readBody(
	request: Request,
	limit: number,
): Promise<Uint8Array<ArrayBuffer>> {
	const length = request.headers.get("content-length");
	if (length && Number(length) > limit)
		throw new ApiError(
			413,
			"file_too_large",
			"Request exceeds the upload limit.",
		);
	const reader = request.body?.getReader();
	if (!reader) return new Uint8Array();
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		for (;;) {
			const item = await reader.read();
			if (item.done) break;
			size += item.value.length;
			if (size > limit)
				throw new ApiError(
					413,
					"file_too_large",
					"Request exceeds the upload limit.",
				);
			chunks.push(item.value);
		}
	} finally {
		await reader.cancel();
	}
	return new Uint8Array(Buffer.concat(chunks));
}
export async function handle(
	name: Endpoint,
	request: Request,
	params: Record<string, string> = {},
): Promise<Response> {
	try {
		const contract = ApiContract[name];
		if (
			process.env.APP_PASSWORD &&
			!["health", "login", "logout"].includes(name)
		) {
			const cookie = request.headers
				.get("cookie")
				?.split(";")
				.map((item) => item.trim())
				.find((item) => item.startsWith(`${SESSION_COOKIE}=`))
				?.slice(SESSION_COOKIE.length + 1);
			if (!validSession(cookie))
				throw new ApiError(401, "unauthorized", "Sign in to continue.");
		}
		if (request.method !== contract.method)
			throw new ApiError(405, "method_not_allowed", "Method not allowed.");
		if (!["GET", "HEAD"].includes(request.method)) {
			const origin = request.headers.get("origin");
			if (origin && origin !== new URL(request.url).origin)
				throw new ApiError(
					403,
					"forbidden",
					"Cross-origin mutations are not allowed.",
				);
		}
		const parsedParams =
			"params" in contract ? contract.params.parse(params) : {};
		const query = Object.fromEntries(new URL(request.url).searchParams);
		let input: unknown = {};
		if (name === "createImport") input = await importBody(request);
		else if (request.method === "GET") input = query;
		else if (request.method !== "DELETE") {
			const bytes = await readBody(request, 1024 * 1024);
			if (bytes.length) {
				if (
					!request.headers
						.get("content-type")
						?.toLowerCase()
						.startsWith("application/json")
				)
					throw new ApiError(400, "validation_error", "Use application/json.");
				try {
					input = JSON.parse(new TextDecoder().decode(bytes));
				} catch {
					throw new ApiError(400, "validation_error", "Invalid JSON body.");
				}
			}
		}
		const parsedInput = contract.request.parse(input);
		const parsedQuery =
			"query" in contract ? contract.query.parse(query) : query;
		const result = await execute(
			name,
			parsedInput,
			parsedParams,
			parsedQuery,
			request,
		);
		let output: unknown;
		try {
			output = contract.response.parse(result.value);
		} catch {
			throw new ApiError(
				500,
				"internal_error",
				"Response failed contract validation.",
			);
		}
		if (name === "exportReport") {
			const file = ApiContract.exportReport.response.parse(output);
			return new Response(new Uint8Array(file.bytes), {
				headers: {
					"Content-Type": file.contentType,
					"Content-Disposition": `attachment; filename="${file.fileName}"`,
					"Cache-Control": "no-store",
				},
			});
		}
		if (output === undefined)
			return new Response(null, { status: 204, headers: result.headers });
		return Response.json(output, {
			status:
				name === "createTransaction" || name === "createImport" ? 201 : 200,
			headers: { "Cache-Control": "no-store", ...result.headers },
		});
	} catch (error) {
		const apiError =
			error instanceof ApiError
				? error
				: error instanceof z.ZodError
					? new ApiError(
							400,
							"validation_error",
							"Request failed validation.",
							error.issues.map((issue) => ({
								path: issue.path,
								message: issue.message,
							})),
						)
					: new ApiError(
							500,
							"internal_error",
							"The operation could not be completed.",
						);
		return Response.json(
			ErrorEnvelopeSchema.parse({
				error: {
					code: apiError.code,
					message: apiError.message,
					...(apiError.details === undefined
						? {}
						: { details: apiError.details }),
				},
			}),
			{ status: apiError.status, headers: { "Cache-Control": "no-store" } },
		);
	}
}
