"use client";

import { useEffect, useRef } from "react";

/** The browser scrolls to `#id` before client data renders the target; scroll once it exists. */
export function useScrollToHash(ready: boolean): void {
	const done = useRef(false);
	useEffect(() => {
		if (!ready || done.current) return;
		const id = decodeURIComponent(window.location.hash.slice(1));
		if (!id) return;
		const target = document.getElementById(id);
		if (!target) return;
		done.current = true;
		target.scrollIntoView({ block: "start" });
	}, [ready]);
}
