import path from "node:path";

export const REPO_ROOT = path.resolve(__dirname, "../../..");
export const FIXTURES = path.join(
	REPO_ROOT,
	"packages/importers/test/fixtures",
);
export const GENERATED = path.join(REPO_ROOT, "tests/data/out");
export const SCREENSHOTS = path.join(REPO_ROOT, "tests/e2e/screenshots");

export const MAIN_PORT = 3102;
export const PASSWORD_PORT = 3103;
export const FRESH_PORT = 3104;
export const MOCK_LLM_PORT = 11502;

/** Direct app URLs (no Origin rewrite). */
export const MAIN_APP_URL = `http://localhost:${MAIN_PORT}`;
export const PASSWORD_APP_URL = `http://localhost:${PASSWORD_PORT}`;
export const FRESH_URL = `http://localhost:${FRESH_PORT}`;

// E2E_NO_ORIGIN_WORKAROUND=1 points the browser straight at the apps (see origin-proxy.ts).
export const ORIGIN_WORKAROUND = process.env.E2E_NO_ORIGIN_WORKAROUND !== "1";
export const PROXY_PORTS = {
	[MAIN_PORT]: 3112,
	[PASSWORD_PORT]: 3113,
} as const;
export const MAIN_URL = ORIGIN_WORKAROUND
	? `http://localhost:${PROXY_PORTS[MAIN_PORT]}`
	: MAIN_APP_URL;
export const PASSWORD_URL = ORIGIN_WORKAROUND
	? `http://localhost:${PROXY_PORTS[PASSWORD_PORT]}`
	: PASSWORD_APP_URL;
export const APP_PASSWORD = "e2e-correct-horse";

export const MOCK_LLM_IN_CONTAINER = `http://host.docker.internal:${MOCK_LLM_PORT}/v1`;

export const STACKS = [
	{ project: "taxe2e", port: MAIN_PORT, password: "" },
	{ project: "taxe2epw", port: PASSWORD_PORT, password: APP_PASSWORD },
	{ project: "taxe2efresh", port: FRESH_PORT, password: "" },
] as const;

export const DISCLAIMER_TEXT =
	"Not tax advice. Have a Chartered Accountant review before filing.";
