import { createHmac } from "node:crypto";
export function signCoinDcx(body: string, secret: string): string {
	return createHmac("sha256", secret).update(body).digest("hex");
}
