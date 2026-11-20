import path from "node:path";

export const REPO_ROOT = path.resolve(__dirname, "../../..");
export const FIXTURES = path.join(
	REPO_ROOT,
	"packages/importers/test/fixtures",
);
export const GENERATED = path.join(REPO_ROOT, "tests/data/out");
export const SCREENSHOTS = path.join(REPO_ROOT, "tests/e2e/screenshots");

export const MAIN_PORT = Number(process.env.E2E_PORT_BASE ?? 3102);
export const PASSWORD_PORT = MAIN_PORT + 1;
export const FRESH_PORT = MAIN_PORT + 2;
export const MOCK_LLM_PORT = 11502;

export const PHASE4_PORT = MAIN_PORT + 3;
export const PHASE4_PASSWORD_PORT = MAIN_PORT + 4;
export const PHASE4_URL = `http://localhost:${PHASE4_PORT}`;
export const PHASE4_PASSWORD_URL = `http://localhost:${PHASE4_PASSWORD_PORT}`;
export const SOURCE_URL = "https://example.org/tax-tracker";

export const MAIN_URL = `http://localhost:${MAIN_PORT}`;
export const PASSWORD_URL = `http://localhost:${PASSWORD_PORT}`;
export const FRESH_URL = `http://localhost:${FRESH_PORT}`;
export const APP_PASSWORD = "e2e-correct-horse";

export const MOCK_LLM_IN_CONTAINER = `http://host.docker.internal:${MOCK_LLM_PORT}/v1`;

export const STACKS = [
	{
		project: `${process.env.E2E_PROJECT_PREFIX ?? "taxe2e"}`,
		port: MAIN_PORT,
		password: "",
	},
	{
		project: `${process.env.E2E_PROJECT_PREFIX ?? "taxe2e"}pw`,
		port: PASSWORD_PORT,
		password: APP_PASSWORD,
	},
	{
		project: `${process.env.E2E_PROJECT_PREFIX ?? "taxe2e"}fresh`,
		port: FRESH_PORT,
		password: "",
	},
] as const;

// Phase 4 first-run stacks: the disclaimer is left unaccepted, and only the first sets SOURCE_URL.
export const PHASE4_STACKS = [
	{
		project: `${process.env.E2E_PROJECT_PREFIX ?? "taxe2e"}4`,
		port: PHASE4_PORT,
		password: "",
		sourceUrl: SOURCE_URL,
	},
	{
		project: `${process.env.E2E_PROJECT_PREFIX ?? "taxe2e"}4pw`,
		port: PHASE4_PASSWORD_PORT,
		password: APP_PASSWORD,
		sourceUrl: "",
	},
] as const;

export const DISCLAIMER_TEXT =
	"Not tax advice. Have a Chartered Accountant review before filing.";
