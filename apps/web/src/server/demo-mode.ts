export function isDemoModeEnabled(): boolean {
	const mode = process.env.DEMO_MODE?.trim().toLowerCase();
	return mode === "true" || mode === "1";
}

export function demoPassword(): string {
	if (!isDemoModeEnabled()) return "";
	return (
		process.env.DEMO_PASSWORD?.trim() || process.env.APP_PASSWORD?.trim() || ""
	);
}
