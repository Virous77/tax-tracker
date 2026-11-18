import type { ConnectorProgress } from "@tax/core";
import type { TaxDatabase } from "@tax/db";
import { publicError } from "./upstream-errors";

interface RunningJob {
	controller: AbortController;
	timer: ReturnType<typeof setImmediate>;
	cancelled: boolean;
	done: Promise<void>;
	finish: () => void;
}
const jobs = new Map<TaxDatabase, Set<RunningJob>>();
export function startBackgroundJob<T>(
	db: TaxDatabase,
	kind: "sync" | "price_fill",
	payload: unknown,
	operation: (ctx: {
		signal: AbortSignal;
		progress: (p: ConnectorProgress) => void;
		result: (value: T) => void;
	}) => Promise<T>,
): { jobId: string } {
	const jobId = db.jobs.create(kind, payload);
	db.jobs.update(jobId, "running");
	const active = jobs.get(db) ?? new Set<RunningJob>();
	jobs.set(db, active);
	let finish: () => void = () => {};
	const done = new Promise<void>((resolve) => {
		finish = resolve;
	});
	const controller = new AbortController();
	const job: RunningJob = {
		controller,
		cancelled: false,
		done,
		finish,
		timer: setImmediate(() => {
			void (async () => {
				try {
					const result = await operation({
						signal: controller.signal,
						result: (value) => {
							if (!job.cancelled) db.jobs.update(jobId, "running", value);
						},
						progress: ({ waitingUntil, ...progress }) => {
							if (!job.cancelled)
								db.jobs.progress(jobId, {
									...progress,
									waitingUntil:
										waitingUntil === undefined
											? null
											: new Date(waitingUntil).toISOString(),
								});
						},
					});
					if (!job.cancelled) db.jobs.update(jobId, "completed", result);
				} catch (error) {
					if (!job.cancelled)
						db.jobs.update(
							jobId,
							"failed",
							db.jobs.get(jobId)?.result ?? null,
							publicError(error).message,
						);
				} finally {
					active.delete(job);
					finish();
				}
			})();
		}),
	};
	active.add(job);
	return { jobId };
}
export async function settleBackgroundJobs(db: TaxDatabase): Promise<void> {
	while (jobs.get(db)?.size)
		await Promise.all([...(jobs.get(db) ?? [])].map((job) => job.done));
}
export function cancelBackgroundJobs(db: TaxDatabase): void {
	for (const job of jobs.get(db) ?? []) {
		job.cancelled = true;
		clearImmediate(job.timer);
		job.controller.abort();
		job.finish();
	}
	jobs.delete(db);
}
