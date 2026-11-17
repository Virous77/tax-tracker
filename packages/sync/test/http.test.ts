import { describe, expect, it, vi } from "vitest";
import {
	HttpClient,
	parseJsonWithSource,
	UpstreamAuthError,
	UpstreamClockError,
	UpstreamError,
	UpstreamRateLimitError,
} from "../src/http.js";

let host = 0;
const url = () =>
	`https://test-${host++}.invalid/api?apikey=secret&signature=hidden`;
const response = (
	body: unknown,
	status = 200,
	headers: Record<string, string> = {},
) => new Response(JSON.stringify(body), { status, headers });
describe("HTTP transport", () => {
	it("retains every JSON number's exact source text", () => {
		expect(
			parseJsonWithSource(
				'{"amount":0.1234567890123456789012345,"id":99999999999999999999,"exp":1.234567890123456789e-25}',
			),
		).toEqual({
			amount: "0.1234567890123456789012345",
			id: "99999999999999999999",
			exp: "1.234567890123456789e-25",
		});
	});
	it.each([429, 500, 502, 503])(
		"retries %s with jitter and exponential backoff",
		async (status) => {
			const fetcher = vi
				.fn()
				.mockResolvedValueOnce(response({}, status))
				.mockResolvedValueOnce(response({}, status))
				.mockResolvedValueOnce(response({ ok: true }));
			let clock = 0;
			const sleep = vi.fn(async (ms: number) => {
				clock += ms;
			});
			const client = new HttpClient({
				fetch: fetcher,
				sleep,
				random: () => 0.5,
				now: () => clock,
			});
			expect(await client.request(url())).toEqual({ ok: true });
			expect(fetcher).toHaveBeenCalledTimes(3);
			expect(sleep.mock.calls.map((call) => call[0])).toEqual(
				status === 429 ? [1000, 1000] : [500, 1000],
			);
		},
	);
	it.each(["2", "Thu, 01 Jan 1970 00:00:03 GMT"])(
		"honours Retry-After %s",
		async (header) => {
			const sleep = vi.fn(async (_ms: number) => {});
			const fetcher = vi
				.fn()
				.mockResolvedValueOnce(response({}, 429, { "retry-after": header }))
				.mockResolvedValueOnce(response({}));
			await new HttpClient({
				fetch: fetcher,
				sleep,
				now: () => 0,
				random: () => 0,
			}).request(url());
			expect(sleep.mock.calls[0]?.[0]).toBe(header === "2" ? 2000 : 3000);
		},
	);
	it("never retries a Binance 418", async () => {
		const fetcher = vi.fn(async () =>
			response({}, 418, { "retry-after": "120" }),
		);
		await expect(
			new HttpClient({ fetch: fetcher }).request(url()),
		).rejects.toMatchObject({ hardStop: true, retryAfterMs: 120000 });
		expect(fetcher).toHaveBeenCalledTimes(1);
	});
	it("retries an HTTP-200 explorer limit", async () => {
		const fetcher = vi
			.fn()
			.mockResolvedValueOnce(
				response({ status: "0", result: "Max rate limit reached" }),
			)
			.mockResolvedValueOnce(response({ status: "1", result: [] }));
		await new HttpClient({ fetch: fetcher, sleep: async () => {} }).request(
			url(),
		);
		expect(fetcher).toHaveBeenCalledTimes(2);
	});
	it("throws a typed limit when retries run out", async () => {
		await expect(
			new HttpClient({
				fetch: async () => response({}, 429),
				maxRetries: 0,
			}).request(url()),
		).rejects.toBeInstanceOf(UpstreamRateLimitError);
	});
	it.each([
		[401, {}, UpstreamAuthError],
		[400, { code: -1022 }, UpstreamAuthError],
		[400, { code: -1021 }, UpstreamClockError],
		[400, { code: -1121 }, UpstreamError],
	])("classifies %s errors without retry", async (status, body, kind) => {
		const fetcher = vi.fn(async () => response(body, status));
		await expect(
			new HttpClient({ fetch: fetcher }).request(url()),
		).rejects.toBeInstanceOf(kind);
		expect(fetcher).toHaveBeenCalledTimes(1);
	});
	it("logs only method, origin/path, status and elapsed time", async () => {
		const log = vi.fn();
		const client = new HttpClient({
			fetch: async () => response({ secret: "body-key" }),
			log,
		});
		await client.request(
			"https://example.invalid/api?apikey=secret&signature=hidden",
			{
				method: "POST",
				headers: { authorization: "header-key" },
				body: "secret-body",
			},
		);
		expect(log.mock.calls[0]?.[0]).toMatch(
			/^POST https:\/\/example.invalid\/api 200 \d+ms$/,
		);
		expect(JSON.stringify(log.mock.calls)).not.toMatch(
			/secret|hidden|header-key|body-key|authorization/,
		);
	});
	it("applies a per-host interval across clients and concurrent requests", async () => {
		let now = 0;
		const sleep = vi.fn(async (ms: number) => {
			now += ms;
		});
		const fetcher = vi.fn(async () => response({}));
		const options = {
			fetch: fetcher,
			now: () => now,
			sleep,
			minIntervalMs: 334,
		};
		const target = url();
		await new HttpClient(options).request(target);
		await new HttpClient(options).request(target);
		expect(sleep).toHaveBeenCalledWith(334, undefined);
	});
	it("applies a timeout and redacts network exception details", async () => {
		const fetcher: typeof fetch = async (_url, init) =>
			new Promise((_resolve, reject) =>
				init?.signal?.addEventListener("abort", () =>
					reject(new Error("secret URL")),
				),
			);
		await expect(
			new HttpClient({ fetch: fetcher, timeoutMs: 5, maxRetries: 0 }).request(
				url(),
			),
		).rejects.toMatchObject({
			message: "Upstream connection failed or timed out",
		});
	});
	it("honours caller cancellation", async () => {
		const controller = new AbortController();
		controller.abort();
		const fetcher = vi.fn();
		await expect(
			new HttpClient({ fetch: fetcher }).request(url(), {
				signal: controller.signal,
			}),
		).rejects.toThrow();
		expect(fetcher).not.toHaveBeenCalled();
	});
});
it("prepares a fresh signed request after host waits and on each retry", async () => {
	let now = 0;
	const fetcher = vi.fn(async (target: Parameters<typeof fetch>[0]) => {
		const timestamp = new URL(String(target)).searchParams.get("timestamp");
		expect(timestamp).toBe(String(now));
		return response({}, fetcher.mock.calls.length === 1 ? 503 : 200);
	});
	const prepare = vi.fn((url: URL) => {
		url.searchParams.set("timestamp", String(now));
	});
	await new HttpClient({
		fetch: fetcher,
		now: () => now,
		sleep: async (ms) => {
			now += ms;
		},
		random: () => 0.5,
	}).request(url(), { notBeforeMs: 10_000, prepare });
	expect(prepare).toHaveBeenCalledTimes(2);
	expect(now).toBe(10_500);
});
