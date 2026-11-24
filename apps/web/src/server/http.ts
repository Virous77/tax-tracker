import { ApiContract, ErrorEnvelopeSchema } from "@tax/core/api";
import { z } from "zod";
import { isPasswordProtected, SESSION_COOKIE, validSession } from "./auth";
import { ApiError } from "./errors";
import { isPdf } from "./pdf-errors";
import { execute } from "./service";
import { publicError } from "./upstream-errors";
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
	const bytes = await readBody(
		request,
		fileLimit + 65536,
		"File exceeds 25 MB.",
	);
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
	const fileBytes = new Uint8Array(await file.arrayBuffer());
	const pdf = isPdf(fileBytes);
	if (file.size > fileLimit)
		throw new ApiError(
			413,
			pdf ? "pdf_too_large" : "file_too_large",
			pdf ? "PDF exceeds the 25 MB upload limit." : "File exceeds 25 MB.",
		);
	const mime = file.type.toLowerCase();
	if (
		!pdf &&
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
			"Only CSV, XLSX and text-based PDF exports are supported.",
		);
	const fileName = file.name.split(/[\\/]/).at(-1) ?? "";
	if (!pdf && !/\.(csv|xlsx)$/i.test(fileName))
		throw new ApiError(
			422,
			"unsupported_file",
			"Only .csv and .xlsx files are supported.",
		);
	return {
		file: fileBytes,
		pdfPassword: form.get("pdfPassword") ?? undefined,
		fileName,
		source: form.get("source") ?? "auto",
		timezone: form.get("timezone"),
	};
}
async function readBody(
	request: Request,
	limit: number,
	message = "Request exceeds the upload limit.",
): Promise<Uint8Array<ArrayBuffer>> {
	const length = request.headers.get("content-length");
	if (length && Number(length) > limit)
		throw new ApiError(413, "file_too_large", message);
	const reader = request.body?.getReader();
	if (!reader) return new Uint8Array();
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		for (;;) {
			const item = await reader.read();
			if (item.done) break;
			size += item.value.length;
			if (size > limit) throw new ApiError(413, "file_too_large", message);
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
			isPasswordProtected() &&
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
			const url = new URL(request.url);
			const host = request.headers.get("host") ?? url.host;
			if (origin && origin !== `${url.protocol}//${host}`)
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
		if (name === "downloadBackup") {
			const { stream, size, fileName } =
				ApiContract.downloadBackup.response.parse(output);
			return new Response(stream as unknown as ReadableStream<Uint8Array>, {
				headers: {
					"Content-Type": "application/vnd.sqlite3",
					"Content-Disposition": `attachment; filename="${fileName}"`,
					"Content-Length": String(size),
					// Next's Node response bridge strips Content-Length from route handler responses.
					"X-Backup-Size": String(size),
					"Cache-Control": "no-store",
				},
			});
		}
		if (name === "exportReport" || name === "exportUsEquityReport") {
			const file = ApiContract[name].response.parse(output);
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
			status: ["syncConnection", "fillPrices", "fillEquityPrices"].includes(
				name,
			)
				? 202
				: [
							"createTransaction",
							"createImport",
							"createConnection",
							"loadDemo",
						].includes(name)
					? 201
					: 200,
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
					: publicError(error);
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
