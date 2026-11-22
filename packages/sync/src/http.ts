import { setTimeout as delay } from "node:timers/promises";

export class UpstreamError extends Error {
	constructor(
		message: string,
		public status = 0,
		public code?: string,
	) {
		super(message);
		this.name = new.target.name;
	}
}
export class UpstreamAuthError extends UpstreamError {}
export class UpstreamClockError extends UpstreamError {}
export class UpstreamRateLimitError extends UpstreamError {
	constructor(
		message: string,
		status = 429,
		public retryAfterMs = 0,
		public hardStop = false,
	) {
		super(message, status);
	}
}

export function parseJsonWithSource(text: string): unknown {
	return JSON.parse(
		text,
		(_key, value: unknown, context?: { source?: string }) => {
			if (typeof value !== "number") return value;
			if (context?.source === undefined)
				throw new UpstreamError("JSON source text requires Node 24");
			return context.source;
		},
	);
}

export interface HttpOptions {
	fetch?: typeof fetch;
	now?: () => number;
	sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
	random?: () => number;
	timeoutMs?: number;
	maxRetries?: number;
	minIntervalMs?: number;
	log?: (line: string) => void;
	vendor?: string;
	redact?: string[];
}
export interface HttpRequest extends RequestInit {
	notBeforeMs?: number | (() => number);
	onRateLimitWait?: (waitingUntil?: number) => void;
	prepare?: (url: URL, request: RequestInit) => void;
	minIntervalMs?: number;
	onResponse?: (response: Response) => void;
}
const hostSlots = new Map<string, number>();

function vendorError(value: unknown): { code?: string; text: string } {
	if (!value || typeof value !== "object" || Array.isArray(value))
		return { text: "" };
	const row = value as Record<string, unknown>;
	return {
		code: typeof row.code === "string" ? row.code : undefined,
		text: [
			...new Set(
				[
					row.msg,
					row.message,
					typeof row.error === "string" ? row.error : "",
					typeof row.result === "string" ? row.result : "",
				].filter((v): v is string => typeof v === "string" && v.length > 0),
			),
		].join(" "),
	};
}

function authError(
	vendor: ReturnType<typeof vendorError>,
	status: number,
	target: URL,
	request: RequestInit,
	options: HttpOptions,
): UpstreamAuthError {
	const headers = new Headers(request.headers);
	const secrets = [
		...(options.redact ?? []),
		...(typeof request.body === "string" ? [request.body] : []),
		...Array.from(headers)
			.filter(([key]) => /key|signature|authorization|cookie|token/i.test(key))
			.flatMap(([, value]) => [value, value.replace(/^Bearer /i, "")]),
		...Array.from(target.searchParams)
			.filter(([key]) => /key|signature|secret|token/i.test(key))
			.map(([, value]) => value),
	];
	let message = vendor.text
		.replace(/https?:\/\/[^\s"'<>]+/gi, "[URL removed]")
		.replace(/(?:\?|%3F)?[\w.-]+(?:=|%3D)[^\s"'<>]+/gi, "[parameter removed]")
		.replace(/\p{Cc}/gu, " ");
	for (const secret of secrets
		.filter(Boolean)
		.sort((a, b) => b.length - a.length))
		for (const spelling of new Set([secret, encodeURIComponent(secret)]))
			message = message.replaceAll(spelling, "[redacted]");
	const code =
		vendor.code &&
		/^-?\d{1,12}$/.test(vendor.code) &&
		!secrets.includes(vendor.code)
			? vendor.code
			: undefined;
	const label = [options.vendor, code].filter(Boolean).join(" ");
	const detail =
		message.trim().slice(0, 500) ||
		"Upstream rejected credentials or permissions";
	return new UpstreamAuthError(
		label ? `${label}: ${detail}` : detail,
		status,
		code,
	);
}

export class HttpClient {
	private interval: number;
	constructor(private options: HttpOptions = {}) {
		this.interval = options.minIntervalMs ?? 0;
	}
	private async sleep(ms: number, signal?: AbortSignal) {
		if (ms <= 0) {
			signal?.throwIfAborted();
			return;
		}
		if (this.options.sleep) await this.options.sleep(ms, signal);
		else await delay(ms, undefined, { signal });
	}
	async request(url: string | URL, init: HttpRequest = {}): Promise<unknown> {
		const target = new URL(url);
		if (target.username || target.password)
			throw new UpstreamError("URL credentials are not supported");
		const {
			minIntervalMs,
			notBeforeMs,
			onRateLimitWait,
			prepare,
			onResponse,
			...request
		} = init;
		const now = this.options.now ?? Date.now;
		const retries = this.options.maxRetries ?? 4;
		const waitForLimit = async (until: number) => {
			const remaining = until - now();
			if (remaining <= 0) return;
			onRateLimitWait?.(until);
			try {
				await this.sleep(remaining, request.signal ?? undefined);
			} finally {
				onRateLimitWait?.();
			}
		};
		for (let attempt = 0; ; attempt++) {
			request.signal?.throwIfAborted();
			const interval = Math.max(this.interval, minIntervalMs ?? 0);
			if (interval > 0 || notBeforeMs !== undefined) {
				const notBefore =
					typeof notBeforeMs === "function"
						? notBeforeMs()
						: (notBeforeMs ?? 0);
				const start = Math.max(
					now(),
					hostSlots.get(target.host) ?? 0,
					notBefore,
				);
				hostSlots.set(target.host, start + interval);
				if (notBefore > now()) await waitForLimit(start);
				else await this.sleep(start - now(), request.signal ?? undefined);
			}
			const started = now();
			let status = 0;
			let failure: UpstreamError | undefined;
			let retryAfterMs = 0;
			try {
				const signal = AbortSignal.any([
					AbortSignal.timeout(this.options.timeoutMs ?? 30_000),
					...(request.signal ? [request.signal] : []),
				]);
				prepare?.(target, request);
				const response = await (this.options.fetch ?? fetch)(target, {
					...request,
					signal,
				});
				status = response.status;
				onResponse?.(response);
				const retryAfter = response.headers.get("retry-after");
				if (retryAfter)
					retryAfterMs = /^\d+(?:\.\d+)?$/.test(retryAfter)
						? Number(retryAfter) * 1000
						: Math.max(0, Date.parse(retryAfter) - now());
				if (!Number.isFinite(retryAfterMs)) retryAfterMs = 0;
				if (status === 418)
					throw new UpstreamRateLimitError(
						"Upstream IP ban; stop sync until the ban expires",
						418,
						retryAfterMs,
						true,
					);
				const body = await response.text();
				let data: unknown;
				try {
					data = parseJsonWithSource(body);
				} catch {
					if (response.ok)
						throw new UpstreamError("Upstream returned invalid JSON", status);
				}
				const vendor = vendorError(data);
				if (vendor.code === "-1021")
					throw new UpstreamClockError(
						"Upstream clock rejected the timestamp",
						status,
						vendor.code,
					);
				if (
					[401, 403].includes(status) ||
					["-1022", "-2014", "-2015"].includes(vendor.code ?? "") ||
					/invalid api.?key|invalid credentials|invalid signature|invalid api key attempts/i.test(
						vendor.text,
					)
				)
					throw authError(vendor, status, target, request, this.options);
				if (
					status === 429 ||
					/rate limit|free api limit|credits.*exhaust/i.test(vendor.text)
				) {
					this.interval = Math.max(1, this.interval * 2);
					throw new UpstreamRateLimitError(
						"Upstream rate limit reached",
						status === 200 ? 429 : status,
						retryAfterMs || 1000,
					);
				}
				if (!response.ok || (vendor.code?.startsWith("-") ?? false))
					throw new UpstreamError(
						"Upstream request failed",
						status,
						vendor.code,
					);
				return data;
			} catch (error) {
				request.signal?.throwIfAborted();
				failure =
					error instanceof UpstreamError
						? error
						: new UpstreamError("Upstream connection failed or timed out");
			} finally {
				this.options.log?.(
					`${request.method ?? "GET"} ${target.origin}${target.pathname} ${status} ${Math.max(0, now() - started)}ms`,
				);
			}
			const retryable =
				failure instanceof UpstreamRateLimitError
					? !failure.hardStop
					: failure.status === 0 || failure.status >= 500;
			if (!retryable || attempt >= retries) throw failure;
			const backoff =
				Math.min(30_000, 500 * 2 ** attempt) *
				(0.5 + (this.options.random ?? Math.random)());
			if (failure instanceof UpstreamRateLimitError)
				await waitForLimit(now() + Math.max(backoff, failure.retryAfterMs));
			else
				await this.sleep(
					Math.max(backoff, retryAfterMs),
					request.signal ?? undefined,
				);
		}
	}
}
export function createHttpClient(options: HttpOptions = {}) {
	return new HttpClient(options);
}
