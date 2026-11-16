import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { buildRecipe, readUserPayload } from "./recipe.mjs";

const MODES = new Set(["recipe", "invalid", "500", "slow", "garbage"]);
const SLOW_MS = 120_000;
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const ROW_LIMIT = 20;
const DEFAULT_MODEL = "mock-recipe";

export const MODELS = [
	"mock-recipe",
	"mock-invalid",
	"mock-500",
	"mock-slow",
	"mock-garbage",
];

const INVALID_RECIPE = {
	id: "mock-invalid",
	name: "",
	version: 2,
	columns: { timestamp: "when", amount: "how much" },
	dateFormat: "",
	signStyle: "signed",
};

const GARBAGE_REPLY =
	"I could not build a recipe for this file. Please inspect the headers and try again.";

const USAGE = `Usage: node tools/mock-llm/server.mjs [--port <port>]

  --port   port to listen on (default: 11500, or PORT)
  MOCK_MODE=recipe|invalid|500|slow|garbage  force a failure mode
`;

function errorBody(code, message) {
	return { error: { code, message } };
}

function sendJson(response, status, body, headers = {}) {
	const payload = JSON.stringify(body);
	response.writeHead(status, {
		"Content-Type": "application/json; charset=utf-8",
		"Content-Length": Buffer.byteLength(payload),
		"Cache-Control": "no-store",
		...headers,
	});
	response.end(payload);
}

async function readJson(request) {
	const chunks = [];
	let size = 0;
	for await (const chunk of request) {
		size += chunk.length;
		if (size > MAX_BODY_BYTES) {
			throw Object.assign(new Error("Request body is too large."), {
				status: 413,
			});
		}
		chunks.push(chunk);
	}
	if (!chunks.length) return {};
	try {
		return JSON.parse(Buffer.concat(chunks).toString("utf8"));
	} catch {
		throw Object.assign(new Error("Request body is not valid JSON."), {
			status: 400,
		});
	}
}

function modeFromName(value, { allowDefault = false } = {}) {
	const name = Array.isArray(value) ? value[0] : value;
	if (typeof name !== "string") return null;
	const key = name
		.trim()
		.toLowerCase()
		.replace(/^mock-/, "");
	if (key === "recipe" || key === "ok" || key === "default")
		return allowDefault ? "recipe" : null;
	return MODES.has(key) ? key : null;
}

// Header wins over the model name, which wins over the process default. A
// model called "mock-recipe" is the normal model, so MOCK_MODE still applies.
function resolveMode(header, model) {
	return (
		modeFromName(header, { allowDefault: true }) ??
		modeFromName(model) ??
		modeFromName(process.env.MOCK_MODE) ??
		"recipe"
	);
}

// The app sends at most 20 sample rows; the stored copy never exceeds that.
function previewRequest(body) {
	if (!body || typeof body !== "object") return body;
	const copy = structuredClone(body);
	for (const message of copy.messages ?? []) {
		if (message?.role !== "user" || typeof message.content !== "string")
			continue;
		let payload;
		try {
			payload = JSON.parse(message.content);
		} catch {
			continue;
		}
		if (!Array.isArray(payload?.rows) || payload.rows.length <= ROW_LIMIT)
			continue;
		payload.rows = payload.rows.slice(0, ROW_LIMIT);
		message.content = JSON.stringify(payload);
	}
	return copy;
}

function waitForClient(ms, response) {
	return new Promise((resolve) => {
		let timer;
		const settle = (open) => {
			clearTimeout(timer);
			response.off("close", onClose);
			response.off("error", onClose);
			resolve(open);
		};
		const onClose = () => settle(false);
		timer = setTimeout(() => settle(true), ms);
		response.on("close", onClose);
		response.on("error", onClose);
	});
}

export function createMockServer({ logger = console.log } = {}) {
	const state = { lastRequest: null, replies: 0 };

	function completion(model, content) {
		state.replies++;
		return {
			id: `chatcmpl-mock-${state.replies}`,
			object: "chat.completion",
			created: Math.floor(Date.now() / 1000),
			model,
			choices: [
				{
					index: 0,
					message: { role: "assistant", content },
					finish_reason: "stop",
				},
			],
			usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
		};
	}

	async function chat(request, response) {
		let body;
		try {
			body = await readJson(request);
		} catch (error) {
			logger("POST /v1/chat/completions model=- mode=-");
			return sendJson(
				response,
				error.status ?? 400,
				errorBody("invalid_request", error.message),
			);
		}
		const model = typeof body?.model === "string" ? body.model : "";
		const mode = resolveMode(request.headers["x-mock-mode"], model);
		state.lastRequest = previewRequest(body);
		logger(`POST /v1/chat/completions model=${model || "-"} mode=${mode}`);
		const headers = { "x-mock-mode": mode };
		if (mode === "500")
			return sendJson(
				response,
				500,
				errorBody("mock_server_error", "Injected HTTP 500 (MOCK_MODE=500)."),
				headers,
			);
		if (mode === "slow") {
			const open = await waitForClient(SLOW_MS, response);
			if (!open) return;
		}
		const content =
			mode === "garbage"
				? GARBAGE_REPLY
				: mode === "invalid"
					? JSON.stringify(INVALID_RECIPE)
					: JSON.stringify(buildRecipe(readUserPayload(body)));
		sendJson(
			response,
			200,
			completion(model || DEFAULT_MODEL, content),
			headers,
		);
	}

	async function handle(request, response) {
		const method = request.method ?? "GET";
		const url = new URL(request.url ?? "/", "http://mock.local");
		if (url.pathname === "/v1/chat/completions") {
			if (method !== "POST") {
				logger(`${method} /v1/chat/completions model=-`);
				return sendJson(
					response,
					405,
					errorBody("method_not_allowed", "Use POST for chat completions."),
					{ Allow: "POST" },
				);
			}
			return chat(request, response);
		}
		if (url.pathname === "/v1/models") {
			if (method !== "GET") {
				logger(`${method} /v1/models model=-`);
				return sendJson(
					response,
					405,
					errorBody("method_not_allowed", "Use GET for the model list."),
					{ Allow: "GET" },
				);
			}
			logger("GET /v1/models model=-");
			return sendJson(response, 200, {
				object: "list",
				data: MODELS.map((id) => ({
					id,
					object: "model",
					created: 0,
					owned_by: "mock-llm",
				})),
			});
		}
		if (url.pathname === "/__last-request") {
			if (method !== "GET") {
				logger(`${method} /__last-request model=-`);
				return sendJson(
					response,
					405,
					errorBody("method_not_allowed", "Use GET for the last request."),
					{ Allow: "GET" },
				);
			}
			logger("GET /__last-request model=-");
			return sendJson(response, 200, state.lastRequest);
		}
		logger(`${method} ${url.pathname} model=-`);
		return sendJson(
			response,
			404,
			errorBody("not_found", `No mock route for ${method} ${url.pathname}.`),
		);
	}

	const server = createServer((request, response) => {
		handle(request, response).catch((error) => {
			logger(
				`${request.method ?? "GET"} ${request.url ?? "/"} model=- error=${error?.name ?? "Error"}`,
			);
			if (!response.headersSent)
				sendJson(
					response,
					500,
					errorBody("mock_error", "The mock failed to answer this request."),
				);
			else response.destroy();
		});
	});

	return { server, lastRequest: () => state.lastRequest };
}

export function startServer({
	port = Number(process.env.PORT ?? 11500),
	host = "0.0.0.0",
	logger = console.log,
} = {}) {
	const { server, lastRequest } = createMockServer({ logger });
	return new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(port, host, () => {
			server.off("error", reject);
			const address = server.address();
			const actual =
				typeof address === "object" && address ? address.port : port;
			resolve({
				server,
				port: actual,
				url: `http://127.0.0.1:${actual}`,
				lastRequest,
				close: () =>
					new Promise((done, fail) => {
						server.closeAllConnections();
						server.close((error) => (error ? fail(error) : done()));
					}),
			});
		});
	});
}

function parseArgs(argv) {
	let port = Number(process.env.PORT ?? 11500);
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--help" || arg === "-h") return { help: true };
		if (arg === "--port") port = Number(argv[++i]);
		else if (arg.startsWith("--port="))
			port = Number(arg.slice("--port=".length));
		else throw new Error(`Unknown argument: ${arg}`);
	}
	if (!Number.isInteger(port) || port < 0 || port > 65535)
		throw new Error(`Invalid port: ${argv.join(" ")}`);
	return { port };
}

async function main() {
	let options;
	try {
		options = parseArgs(process.argv.slice(2));
	} catch (error) {
		console.error(`mock-llm: ${error.message}\n\n${USAGE}`);
		process.exit(1);
	}
	if (options.help) {
		console.log(USAGE);
		return;
	}
	const running = await startServer({ port: options.port });
	console.log(`mock-llm listening on http://0.0.0.0:${running.port}/v1`);
	console.log(`  models        ${MODELS.join(", ")}`);
	console.log(
		`  docker URL    AI_BASE_URL=http://host.docker.internal:${running.port}/v1`,
	);
	console.log(
		`  failure mode  MOCK_MODE=${process.env.MOCK_MODE ?? "(none)"} | header x-mock-mode | model name`,
	);
	const stop = () => running.close().then(() => process.exit(0));
	process.once("SIGINT", stop);
	process.once("SIGTERM", stop);
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	main().catch((error) => {
		console.error(`mock-llm: ${error.message}`);
		process.exit(1);
	});
}
