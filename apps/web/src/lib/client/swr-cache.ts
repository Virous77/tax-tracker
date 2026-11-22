type SwrOptions = {
	ttlMs?: number;
	staleMs?: number;
	force?: boolean;
};

type CachedValue = {
	value: unknown;
	fetchedAt: number;
	expiresAt: number;
};

const DEFAULT_TTL_MS = 3_000;
const DEFAULT_STALE_MS = 30_000;
const MAX_ENTRIES = 64;
const entries = new Map<string, CachedValue>();
const inFlight = new Map<string, Promise<unknown>>();
const listeners = new Set<() => void>();
let status: Readonly<{ isRevalidating: boolean; lastSyncedAt: number | null }> =
	{
		isRevalidating: false,
		lastSyncedAt: null,
	};

function publish(lastSyncedAt = status.lastSyncedAt) {
	const isRevalidating = inFlight.size > 0;
	if (
		status.isRevalidating !== isRevalidating ||
		status.lastSyncedAt !== lastSyncedAt
	) {
		status = { isRevalidating, lastSyncedAt };
	}
	for (const listener of listeners) listener();
}

function entryFor(key: string, now: number) {
	const entry = entries.get(key);
	if (entry && now < entry.expiresAt) return entry;
	entries.delete(key);
}

export function peekSwr<T>(key: string): T | undefined {
	return entryFor(key, Date.now())?.value as T | undefined;
}

export function getSwrStatus() {
	return status;
}

export function subscribeSwr(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

export function swrFetch<T>(
	key: string,
	fetcher: () => Promise<T>,
	{
		ttlMs = DEFAULT_TTL_MS,
		staleMs = DEFAULT_STALE_MS,
		force = false,
	}: SwrOptions = {},
): Promise<T> {
	const now = Date.now();
	const entry = entryFor(key, now);
	if (!force && entry && now - entry.fetchedAt < ttlMs) {
		return Promise.resolve(entry.value as T);
	}
	const pending = inFlight.get(key);
	if (pending) return pending as Promise<T>;

	const promise = Promise.resolve()
		.then(fetcher)
		.then(
			(value) => {
				// Invalidation detaches earlier requests so pre-mutation data cannot refill the cache.
				if (inFlight.get(key) === promise) {
					const fetchedAt = Date.now();
					for (const [cachedKey, cached] of entries) {
						if (cached.expiresAt <= fetchedAt) entries.delete(cachedKey);
					}
					entries.delete(key);
					const oldest = entries.keys().next().value;
					if (entries.size >= MAX_ENTRIES && oldest !== undefined)
						entries.delete(oldest);
					entries.set(key, {
						value,
						fetchedAt,
						expiresAt: fetchedAt + Math.max(ttlMs, staleMs),
					});
					inFlight.delete(key);
					publish(fetchedAt);
				}
				return value;
			},
			(error: unknown) => {
				if (inFlight.get(key) === promise) {
					inFlight.delete(key);
					publish();
				}
				throw error;
			},
		);
	inFlight.set(key, promise);
	publish();
	return promise;
}

export function revalidateSwr<T>(
	key: string,
	fetcher: () => Promise<T>,
	options?: Omit<SwrOptions, "force">,
): Promise<T> {
	return swrFetch(key, fetcher, { ...options, force: true });
}

export function invalidateSwr(prefix?: string) {
	if (prefix === undefined) {
		clearSwrCache();
		return;
	}
	for (const key of entries.keys()) {
		if (key.startsWith(prefix)) entries.delete(key);
	}
	for (const key of inFlight.keys()) {
		if (key.startsWith(prefix)) inFlight.delete(key);
	}
	publish();
}

export function clearSwrCache() {
	entries.clear();
	inFlight.clear();
	publish(null);
}
