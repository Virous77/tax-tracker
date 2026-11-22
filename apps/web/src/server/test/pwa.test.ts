import { readFile } from "node:fs/promises";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import manifest from "@/app/manifest";
import { api } from "@/lib/client/api";
import {
	clearSwrCache,
	getSwrStatus,
	invalidateSwr,
	peekSwr,
	revalidateSwr,
	subscribeSwr,
	swrFetch,
} from "@/lib/client/swr-cache";
import { rootMetadata } from "@/lib/seo";
import { proxy } from "@/proxy";

afterEach(() => {
	clearSwrCache();
	vi.useRealTimers();
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
});

describe("PWA metadata and public routes", () => {
	it("declares installable icons and shortcuts", () => {
		expect(manifest()).toMatchObject({
			id: "/",
			scope: "/",
			start_url: "/?source=pwa",
			display: "standalone",
			display_override: ["window-controls-overlay", "standalone"],
			orientation: "any",
			categories: ["finance", "productivity"],
			icons: [
				{ src: "/icon.svg", sizes: "any" },
				{ src: "/icons/icon-192.png", sizes: "192x192", purpose: "any" },
				{ src: "/icons/icon-512.png", sizes: "512x512", purpose: "any" },
				{
					src: "/icons/icon-512-maskable.png",
					sizes: "512x512",
					purpose: "maskable",
				},
			],
			shortcuts: [
				{ name: "Overview", url: "/" },
				{ name: "Import Data", url: "/import" },
				{ name: "Tax Report", url: "/report" },
				{ name: "US Stocks", url: "/us-stocks" },
			],
		});
	});

	it.each([
		["icon-192.png", 192],
		["icon-512.png", 512],
		["icon-512-maskable.png", 512],
		["apple-touch-icon.png", 180],
	])("ships %s as a %i-pixel PNG", async (file, size) => {
		const png = await readFile(
			new URL(`../../../public/icons/${file}`, import.meta.url),
		);
		expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
		expect(png.toString("ascii", 12, 16)).toBe("IHDR");
		expect(png.readUInt32BE(16)).toBe(size);
		expect(png.readUInt32BE(20)).toBe(size);
	});

	it("sets Apple Home Screen and format detection metadata", () => {
		expect(rootMetadata()).toMatchObject({
			appleWebApp: {
				capable: true,
				title: "Tax Tracker",
				statusBarStyle: "default",
			},
			icons: {
				icon: expect.arrayContaining([
					expect.objectContaining({ url: "/icon.svg" }),
				]),
				apple: [
					{
						url: "/icons/apple-touch-icon.png",
						sizes: "180x180",
						type: "image/png",
					},
				],
			},
			formatDetection: { telephone: false },
		});
	});

	it("makes PWA assets public while requiring authentication for tax data", () => {
		vi.stubEnv("APP_PASSWORD", "pwa-test-password");
		const origin = "http://localhost:3000";
		for (const path of [
			"/manifest.webmanifest",
			"/sw.js",
			"/icon.svg",
			"/apple-icon",
			"/icons/icon-192.png",
			"/offline",
		]) {
			const response = proxy(new NextRequest(`${origin}${path}`));
			expect(response.headers.get("x-middleware-next"), path).toBe("1");
		}
		const apiResponse = proxy(new NextRequest(`${origin}/api/settings`));
		expect(apiResponse.status).toBe(401);
		expect(apiResponse.headers.get("Cache-Control")).toBe("no-store");
		const pageResponse = proxy(new NextRequest(`${origin}/report`));
		expect(pageResponse.status).toBe(307);
		expect(pageResponse.headers.get("Location")).toBe(
			`${origin}/login?next=%2Freport`,
		);
	});
});

describe("in-memory SWR cache", () => {
	it("deduplicates requests, exposes stale data during revalidation and expires entries", async () => {
		vi.useFakeTimers();
		const fetcher = vi
			.fn<() => Promise<number>>()
			.mockResolvedValueOnce(1)
			.mockResolvedValueOnce(2);
		const options = { ttlMs: 1_000, staleMs: 5_000 };
		const listener = vi.fn();
		const unsubscribe = subscribeSwr(listener);
		try {
			const pending = swrFetch("settings", fetcher, options);
			expect(swrFetch("settings", fetcher, options)).toBe(pending);
			expect(getSwrStatus().isRevalidating).toBe(true);
			await expect(pending).resolves.toBe(1);
			await expect(swrFetch("settings", fetcher, options)).resolves.toBe(1);
			expect(fetcher).toHaveBeenCalledTimes(1);
			expect(getSwrStatus()).toEqual({
				isRevalidating: false,
				lastSyncedAt: Date.now(),
			});

			vi.advanceTimersByTime(1_001);
			const refresh = revalidateSwr("settings", fetcher, options);
			expect(peekSwr("settings")).toBe(1);
			await expect(refresh).resolves.toBe(2);
			expect(peekSwr("settings")).toBe(2);
			expect(listener).toHaveBeenCalledTimes(4);
			vi.advanceTimersByTime(5_000);
			expect(peekSwr("settings")).toBeUndefined();
		} finally {
			unsubscribe();
		}
	});

	it("detaches in-flight requests on clear and can invalidate a key prefix", async () => {
		let resolveOld: (value: string) => void = () => {};
		const old = new Promise<string>((resolve) => {
			resolveOld = resolve;
		});
		const pending = swrFetch("/api/reports/2026-27", () => old);
		clearSwrCache();
		await swrFetch("/api/reports/2026-27", async () => "new");
		await swrFetch("/api/settings", async () => "keep");
		resolveOld("old");
		await pending;
		expect(peekSwr("/api/reports/2026-27")).toBe("new");

		invalidateSwr("/api/reports/");
		expect(peekSwr("/api/reports/2026-27")).toBeUndefined();
		expect(peekSwr("/api/settings")).toBe("keep");
	});

	it("deduplicates API reads and invalidates them after JSON and multipart mutations", async () => {
		const loaded = { loaded: true, importIds: ["demo"], taxYears: [] };
		const removed = { loaded: false, importIds: [], taxYears: [] };
		const fetcher = vi
			.fn<typeof fetch>()
			.mockImplementationOnce(async () => Response.json(loaded))
			.mockImplementationOnce(async () => new Response(null, { status: 204 }))
			.mockImplementationOnce(async () => Response.json(removed))
			.mockImplementationOnce(async () =>
				Response.json(
					{ error: { code: "bad_import", message: "Invalid file" } },
					{ status: 422 },
				),
			);
		vi.stubGlobal("fetch", fetcher);
		await expect(Promise.all([api.getDemo(), api.getDemo()])).resolves.toEqual([
			loaded,
			loaded,
		]);
		await expect(api.getDemo()).resolves.toEqual(loaded);
		expect(fetcher).toHaveBeenCalledTimes(1);
		await api.removeDemo();
		await expect(api.getDemo()).resolves.toEqual(removed);
		expect(fetcher).toHaveBeenCalledTimes(3);

		const file = new File(["bad csv"], "bad.csv");
		await expect(
			api.createImport({ file, source: "auto", timezone: "UTC" }),
		).rejects.toMatchObject({ status: 422 });
		expect(peekSwr("/api/demo")).toBeUndefined();
	});

	it("uses fresh network reads for health and job polling", async () => {
		const job = { id: "job-1", kind: "sync" };
		const health = { ok: true, version: "test", dbOk: true };
		const fetcher = vi
			.fn<typeof fetch>()
			.mockImplementationOnce(async () =>
				Response.json({ ...job, status: "running" }),
			)
			.mockImplementationOnce(async () =>
				Response.json({ ...job, status: "completed" }),
			)
			.mockImplementation(async () => Response.json(health));
		vi.stubGlobal("fetch", fetcher);
		await expect(api.getJob(job.id)).resolves.toMatchObject({
			status: "running",
		});
		await expect(api.getJob(job.id)).resolves.toMatchObject({
			status: "completed",
		});
		await Promise.all([api.health(), api.health()]);
		expect(fetcher).toHaveBeenCalledTimes(4);
		expect(peekSwr(`/api/jobs/${job.id}`)).toBeUndefined();
		expect(peekSwr("/api/health")).toBeUndefined();
	});

	it("clears session data in memory and notifies the worker on logout", async () => {
		const postMessage = vi.fn();
		vi.stubGlobal("navigator", {
			serviceWorker: { controller: { postMessage } },
		});
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response(null, { status: 204 })),
		);
		await swrFetch("/api/settings", async () => "private");
		await api.logout();
		expect(peekSwr("/api/settings")).toBeUndefined();
		expect(postMessage).toHaveBeenCalledWith({ type: "CLEAR_CACHES" });
	});
});
