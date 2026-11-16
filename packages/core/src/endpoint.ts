const LOCAL_HOSTNAMES = new Set([
	"localhost",
	"127.0.0.1",
	"::1",
	"0.0.0.0",
	"ollama",
	"host.docker.internal",
]);

function isPrivateIpv4(host: string): boolean {
	const parts = host.split(".").map(Number);
	if (
		parts.length !== 4 ||
		parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)
	)
		return false;
	const [a, b] = parts as [number, number, number, number];
	return (
		a === 10 ||
		a === 127 ||
		(a === 172 && b >= 16 && b <= 31) ||
		(a === 192 && b === 168) ||
		(a === 169 && b === 254)
	);
}

/**
 * True when an AI endpoint stays on the user's own machine or private network,
 * so sending sample rows to it does not need the cloud-privacy acknowledgement.
 */
export function isLocalAiEndpoint(baseUrl: string): boolean {
	let host: string;
	try {
		host = new URL(baseUrl).hostname.toLowerCase().replace(/^\[|\]$/g, "");
	} catch {
		return false;
	}
	return (
		LOCAL_HOSTNAMES.has(host) || host.endsWith(".local") || isPrivateIpv4(host)
	);
}
