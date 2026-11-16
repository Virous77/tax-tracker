import http from "node:http";

// BUGS.md #1: inside Docker the API compares the browser's Origin header with the
// container's bind address (http://0.0.0.0:3000), so every browser mutation gets 403.
// This proxy rewrites only Origin so the rest of the UI can still be exercised.
// Tests that prove the bug talk to the app port directly.
export const CONTAINER_ORIGIN = "http://0.0.0.0:3000";

export function startOriginProxy(
	listenPort: number,
	targetPort: number,
): Promise<http.Server> {
	const server = http.createServer((req, res) => {
		const headers = { ...req.headers };
		if (headers.origin) headers.origin = CONTAINER_ORIGIN;
		const upstream = http.request(
			{
				host: "127.0.0.1",
				port: targetPort,
				method: req.method,
				path: req.url,
				headers,
			},
			(up) => {
				res.writeHead(up.statusCode ?? 502, up.headers);
				up.pipe(res);
			},
		);
		upstream.on("error", () => {
			if (!res.headersSent) res.writeHead(502);
			res.end();
		});
		req.pipe(upstream);
	});
	return new Promise((resolve) =>
		server.listen(listenPort, "127.0.0.1", () => resolve(server)),
	);
}
