"use client";

import { RefreshCw, WifiOff, X } from "lucide-react";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useRef,
	useState,
} from "react";
import { clearSwrCache } from "@/lib/client/swr-cache";

type InstallPromptEvent = Event & {
	prompt: () => Promise<unknown>;
};

type PwaState = {
	canInstall: boolean;
	promptInstall: () => Promise<void>;
	isOffline: boolean;
	updateAvailable: boolean;
	applyUpdate: () => void;
};

export const REVALIDATE_EVENT = "tax-tracker:revalidate";
const PwaContext = createContext<PwaState | null>(null);

export function PwaProvider({ children }: { children: ReactNode }) {
	const [isOffline, setOffline] = useState(false);
	const [isInstalled, setInstalled] = useState(false);
	const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(
		null,
	);
	const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(
		null,
	);
	const [applyingUpdate, setApplyingUpdate] = useState(false);
	const requestedWorker = useRef<ServiceWorker | null>(null);

	useEffect(() => {
		const offline = () => setOffline(true);
		const online = () => {
			setOffline(false);
			clearSwrCache();
			window.dispatchEvent(new CustomEvent(REVALIDATE_EVENT));
		};
		setOffline(!navigator.onLine);
		window.addEventListener("offline", offline);
		window.addEventListener("online", online);
		return () => {
			window.removeEventListener("offline", offline);
			window.removeEventListener("online", online);
		};
	}, []);

	useEffect(() => {
		const standalone = window.matchMedia("(display-mode: standalone)");
		const overlay = window.matchMedia(
			"(display-mode: window-controls-overlay)",
		);
		const checkInstalled = () => {
			const iosStandalone = (navigator as Navigator & { standalone?: boolean })
				.standalone;
			setInstalled(
				standalone.matches || overlay.matches || iosStandalone === true,
			);
		};
		const capturePrompt = (event: Event) => {
			event.preventDefault();
			setInstallPrompt(event as InstallPromptEvent);
		};
		const installed = () => {
			setInstalled(true);
			setInstallPrompt(null);
		};
		checkInstalled();
		standalone.addEventListener("change", checkInstalled);
		overlay.addEventListener("change", checkInstalled);
		window.addEventListener("beforeinstallprompt", capturePrompt);
		window.addEventListener("appinstalled", installed);
		return () => {
			standalone.removeEventListener("change", checkInstalled);
			overlay.removeEventListener("change", checkInstalled);
			window.removeEventListener("beforeinstallprompt", capturePrompt);
			window.removeEventListener("appinstalled", installed);
		};
	}, []);

	useEffect(() => {
		if (
			process.env.NODE_ENV !== "production" ||
			!("serviceWorker" in navigator)
		)
			return;
		const serviceWorker = navigator.serviceWorker;
		let disposed = false;
		let stopWatching: (() => void) | undefined;
		const handleControllerChange = () => {
			const requested = requestedWorker.current;
			requestedWorker.current = null;
			if (requested && serviceWorker.controller === requested) {
				window.location.reload();
				return;
			}
			setApplyingUpdate(false);
			setWaitingWorker(null);
		};
		serviceWorker.addEventListener("controllerchange", handleControllerChange);
		void serviceWorker
			.register("/sw.js", { updateViaCache: "none" })
			.then((registration) => {
				if (disposed) return;
				let installing: ServiceWorker | null = null;
				const showWaiting = () => {
					const waiting = registration.waiting;
					if (waiting) setWaitingWorker(waiting);
				};
				const watchInstalling = () => {
					installing?.removeEventListener("statechange", showWaiting);
					installing = registration.installing;
					installing?.addEventListener("statechange", showWaiting);
				};
				showWaiting();
				watchInstalling();
				registration.addEventListener("updatefound", watchInstalling);
				stopWatching = () => {
					registration.removeEventListener("updatefound", watchInstalling);
					installing?.removeEventListener("statechange", showWaiting);
				};
			})
			.catch(() => {});
		return () => {
			disposed = true;
			stopWatching?.();
			serviceWorker.removeEventListener(
				"controllerchange",
				handleControllerChange,
			);
		};
	}, []);

	const promptInstall = useCallback(async () => {
		if (!installPrompt || isInstalled) return;
		setInstallPrompt(null);
		await installPrompt.prompt().catch(() => {});
	}, [installPrompt, isInstalled]);

	const applyUpdate = useCallback(() => {
		if (!waitingWorker || requestedWorker.current) return;
		requestedWorker.current = waitingWorker;
		setApplyingUpdate(true);
		try {
			waitingWorker.postMessage({ type: "SKIP_WAITING" });
		} catch {
			requestedWorker.current = null;
			setApplyingUpdate(false);
		}
	}, [waitingWorker]);

	return (
		<PwaContext.Provider
			value={{
				canInstall: installPrompt !== null && !isInstalled,
				promptInstall,
				isOffline,
				updateAvailable: waitingWorker !== null,
				applyUpdate,
			}}
		>
			{children}
			{isOffline || waitingWorker ? (
				<div className="pointer-events-none fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-30 flex flex-col items-end gap-2 sm:inset-x-5">
					{isOffline ? (
						<div
							role="status"
							className="pointer-events-auto flex items-center gap-2 rounded-md border border-[var(--warning)]/40 bg-[var(--warning-soft)] px-3 py-2 text-sm text-[var(--warning)] shadow-sm"
						>
							<WifiOff className="h-4 w-4 shrink-0" aria-hidden="true" />
							<span>You're offline — reconnect to load or save tax data</span>
						</div>
					) : null}
					{waitingWorker ? (
						<div className="pointer-events-auto flex items-center gap-3 rounded-md border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)] shadow-sm">
							<span role="status">App update ready</span>
							<button
								type="button"
								onClick={applyUpdate}
								disabled={applyingUpdate}
								className="inline-flex items-center gap-1.5 rounded bg-[var(--accent)] px-2.5 py-1.5 text-xs font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-60"
							>
								<RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
								{applyingUpdate ? "Refreshing…" : "Refresh"}
							</button>
							<button
								type="button"
								aria-label="Dismiss update"
								onClick={() => setWaitingWorker(null)}
								disabled={applyingUpdate}
								className="rounded p-1.5 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-60"
							>
								<X className="h-4 w-4" aria-hidden="true" />
							</button>
						</div>
					) : null}
				</div>
			) : null}
		</PwaContext.Provider>
	);
}

export function usePwa(): PwaState {
	const context = useContext(PwaContext);
	if (!context) throw new Error("usePwa must be used inside PwaProvider");
	return context;
}

export function OfflineRetry() {
	return (
		<form
			action="/"
			onSubmit={(event) => {
				if (window.location.pathname === "/offline") return;
				event.preventDefault();
				window.location.reload();
			}}
		>
			<button
				type="submit"
				className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)]"
			>
				Try again
			</button>
		</form>
	);
}
