import { z } from "zod";

export const DemoStatusSchema = z.object({
	loaded: z.boolean(),
	importIds: z.array(z.string()),
	/** Tax years the sample rows fall in, newest first; the UI opens the first. */
	taxYears: z.array(z.string()).default([]),
});
export const DemoLoadResponseSchema = z.object({
	importIds: z.array(z.string()),
	taxYears: z.array(z.string()).default([]),
});
export type DemoStatus = z.infer<typeof DemoStatusSchema>;

const emptyRequest = z.strictObject({});

export const BackupDownloadSchema = z.object({
	fileName: z.string(),
	size: z.number().int().nonnegative(),
	stream: z.instanceof(ReadableStream),
});

export const Phase4ApiContract = {
	getDemo: {
		method: "GET",
		path: "/api/demo",
		request: emptyRequest,
		response: DemoStatusSchema,
	},
	loadDemo: {
		method: "POST",
		path: "/api/demo",
		request: emptyRequest,
		response: DemoLoadResponseSchema,
	},
	removeDemo: {
		method: "DELETE",
		path: "/api/demo",
		request: emptyRequest,
		response: z.undefined(),
	},
	downloadBackup: {
		method: "GET",
		path: "/api/backup",
		request: emptyRequest,
		response: BackupDownloadSchema,
	},
} as const;
