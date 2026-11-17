// Test-only pass-through to the sync mock that adds Binance SAPI weight headers reporting zero use.
// Without it a first Binance sync spends ~80 minutes pacing /fiat/orders (see BUGS.md P2-API-1).
import http from "node:http";

const target = Number(process.env.MOCK_SYNC_PORT ?? 11601);
const port = Number(process.env.WEIGHT_PROXY_PORT ?? 11613);

http
	.createServer((req, res) => {
		const upstream = http.request(
			{
				host: "127.0.0.1",
				port: target,
				path: req.url,
				method: req.method,
				headers: req.headers,
			},
			(up) => {
				const headers = { ...up.headers };
				if (req.url?.startsWith("/binance/sapi/")) {
					headers["x-sapi-used-uid-weight-1m"] = "0";
					headers["x-sapi-used-ip-weight-1m"] = "0";
				}
				res.writeHead(up.statusCode ?? 502, headers);
				up.pipe(res);
			},
		);
		upstream.on("error", () => {
			res.writeHead(502);
			res.end();
		});
		req.pipe(upstream);
	})
	.listen(port, "0.0.0.0", () =>
		console.log(`weight proxy ${port} -> ${target}`),
	);
