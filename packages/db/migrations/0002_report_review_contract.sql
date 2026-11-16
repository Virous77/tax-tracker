ALTER TABLE `imports` ADD `rows_skipped` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `imports` ADD `skipped_rows` text DEFAULT '[]' NOT NULL;
--> statement-breakpoint
CREATE TABLE `report_invalidations` (
 `tax_year` text PRIMARY KEY NOT NULL,
 `invalidated_at` text NOT NULL,
 `cause` text NOT NULL
);
