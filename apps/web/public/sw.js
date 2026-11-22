const VERSION = "v1";
const STATIC_CACHE = `tax-tracker-static-${VERSION}`;
const PAGES_CACHE = `tax-tracker-pages-${VERSION}`;
const OFFLINE = "/offline";
const PUBLIC_ASSETS = [
	"/manifest.webmanifest",
	"/icon.svg",
	"/icons/icon-192.png",
	"/icons/icon-512.png",
	"/icons/icon-512-maskable.png",
	"/icons/apple-touch-icon.png",
];

function isCacheable(response) {
	return (
		response.status === 200 &&
		!response.redirected &&
		!/(?:^|,)\s*(?:no-store|private)\b/i.test(
			response.headers.get("Cache-Control") ?? "",
		)
	);
}

function isHtml(response) {
	return response.headers.get("Content-Type")?.includes("text/html");
}

async function precache() {
	const options = { cache: "reload", credentials: "omit", redirect: "error" };
	const page = await fetch(OFFLINE, options);
	if (!isCacheable(page) || !isHtml(page)) {
		throw new Error("The public offline page is unavailable");
	}
	const html = await page.clone().text();
	// Preload the assets referenced by the fallback, even on the first offline visit.
	const assets = new Set(PUBLIC_ASSETS);
	for (const [, path] of html.matchAll(
		/(?:href|src)="(\/_next\/static\/[^"<>]+)"/g,
	)) {
		assets.add(path.replaceAll("&amp;", "&"));
	}
	const cache = await caches.open(STATIC_CACHE);
	await Promise.all(
		[...assets].map(async (path) => {
			const response = await fetch(path, options);
			if (!isCacheable(response) || isHtml(response)) {
				throw new Error(`Could not precache ${path}`);
			}
			await cache.put(path, response);
		}),
	);
	await cache.put(OFFLINE, page);
}

async function clearOldCaches() {
	const names = await caches.keys();
	await Promise.all(
		names
			.filter(
				(name) =>
					(name.startsWith("tax-tracker-static-") ||
						name.startsWith("tax-tracker-pages-")) &&
					name !== STATIC_CACHE &&
					name !== PAGES_CACHE,
			)
			.map((name) => caches.delete(name)),
	);
}

self.addEventListener("install", (event) => {
	event.waitUntil(precache());
});

self.addEventListener("activate", (event) => {
	event.waitUntil(clearOldCaches().then(() => self.clients.claim()));
});

async function readCache(name, key) {
	return caches.match(key, { cacheName: name }).catch(() => undefined);
}

function staleWhileRevalidate(event, publicAsset) {
	const request = event.request;
	const network = fetch(request, { cache: "no-cache" });
	event.waitUntil(
		network
			.then(async (response) => {
				const cacheControl = response.headers.get("Cache-Control") ?? "";
				if (
					!isCacheable(response) ||
					isHtml(response) ||
					(!publicAsset && !/(?:^|,)\s*public\b/i.test(cacheControl))
				)
					return;
				const copy = response.clone();
				const cache = await caches.open(STATIC_CACHE);
				await cache.put(request, copy);
			})
			.catch(() => {}),
	);
	return readCache(STATIC_CACHE, request).then((cached) => cached ?? network);
}

async function timedNavigation(request) {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 4_000);
	try {
		return await fetch(request, {
			cache: "no-store",
			signal: controller.signal,
		});
	} finally {
		clearTimeout(timeout);
	}
}

function networkFirst(event, isOfflinePage) {
	const network = timedNavigation(event.request);
	if (isOfflinePage) {
		event.waitUntil(
			network
				.then(async (response) => {
					if (!isCacheable(response) || !isHtml(response)) return;
					const copy = response.clone();
					const cache = await caches.open(PAGES_CACHE);
					await cache.put(OFFLINE, copy);
				})
				.catch(() => {}),
		);
	}
	return network.catch(
		async () =>
			(await readCache(PAGES_CACHE, OFFLINE)) ??
			(await readCache(STATIC_CACHE, OFFLINE)) ??
			new Response("Tax Tracker is offline. Reconnect and try again.", {
				status: 503,
				headers: { "Content-Type": "text/plain; charset=utf-8" },
			}),
	);
}

self.addEventListener("fetch", (event) => {
	const request = event.request;
	if (request.method !== "GET") return;
	const { origin, pathname } = new URL(request.url);
	if (
		origin !== self.location.origin ||
		pathname === "/api" ||
		pathname.startsWith("/api/") ||
		pathname === "/login" ||
		pathname.startsWith("/login/")
	)
		return;

	if (request.mode === "navigate") {
		event.respondWith(networkFirst(event, pathname === OFFLINE));
		return;
	}

	const publicAsset =
		pathname.startsWith("/_next/static/") ||
		pathname.startsWith("/icons/") ||
		PUBLIC_ASSETS.includes(pathname);
	if (
		publicAsset ||
		request.destination === "image" ||
		request.destination === "font"
	) {
		event.respondWith(staleWhileRevalidate(event, publicAsset));
	}
});

self.addEventListener("message", (event) => {
	if (event.data?.type === "SKIP_WAITING") event.waitUntil(self.skipWaiting());
	if (event.data?.type === "CLEAR_CACHES")
		event.waitUntil(caches.delete(PAGES_CACHE));
});
