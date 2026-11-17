import { createHmac } from "node:crypto";
export function signBinance(query: string, secret: string): string {
	return createHmac("sha256", secret).update(query).digest("hex");
}
