import { STACKS } from "./env";
import { compose } from "./global-setup";

// E2E_KEEP_STACK=1 or E2E_REUSE_STACK=1 leaves the containers running after the run.
export default async function globalTeardown() {
	if (process.env.E2E_KEEP_STACK === "1" || process.env.E2E_REUSE_STACK === "1")
		return;
	for (const stack of STACKS) compose(stack.project, ["down"], {});
}
