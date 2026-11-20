CREATE TABLE `review_resolutions` (
	`tax_year` text NOT NULL,
	`code` text NOT NULL,
	`tx_id` text NOT NULL,
	`item_key` text NOT NULL,
	`note` text,
	PRIMARY KEY(`tax_year`, `code`, `tx_id`, `item_key`)
);

--> statement-breakpoint
DELETE FROM report_invalidations
WHERE EXISTS (SELECT 1 FROM reports WHERE reports.tax_year = report_invalidations.tax_year);
