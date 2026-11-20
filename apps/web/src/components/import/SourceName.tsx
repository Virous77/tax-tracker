"use client";

import { useSourceLabel } from "@/lib/client/useSourceLabel";

/** Mounts after the recipe wizard saved its recipe, so the name it loads is current. */
export function SourceName({ source }: { source: string }) {
	const sourceLabel = useSourceLabel();
	return <>{sourceLabel(source)}</>;
}
