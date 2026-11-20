import { z } from "zod";

export const DemoStatusSchema = z.object({
	loaded: z.boolean(),
	importIds: z.array(z.string()),
});
export const DemoLoadResponseSchema = z.object({
	importIds: z.array(z.string()),
});
export type DemoStatus = z.infer<typeof DemoStatusSchema>;

export const Phase4ApiContract = {
	getDemo: { method: "GET", path: "/api/demo", response: DemoStatusSchema },
	loadDemo: {
		method: "POST",
		path: "/api/demo",
		response: DemoLoadResponseSchema,
	},
	removeDemo: { method: "DELETE", path: "/api/demo" },
	downloadBackup: { method: "GET", path: "/api/backup" },
} as const;
