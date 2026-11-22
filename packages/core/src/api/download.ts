import { z } from "zod";

export const DownloadResponseSchema = z.object({
	fileName: z.string(),
	contentType: z.enum([
		"text/csv; charset=utf-8",
		"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	]),
	bytes: z.instanceof(Uint8Array),
});
