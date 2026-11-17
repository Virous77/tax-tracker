CREATE TABLE `balance_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`import_id` text NOT NULL,
	`venue` text NOT NULL,
	`as_of` text NOT NULL,
	`timezone` text NOT NULL,
	`rows_json` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`import_id`) REFERENCES `imports`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `balance_snapshots_import_id_unique` ON `balance_snapshots` (`import_id`);--> statement-breakpoint
ALTER TABLE `imports` ADD `report_kind` text;--> statement-breakpoint
ALTER TABLE `imports` ADD `report_kind_label` text;--> statement-breakpoint
ALTER TABLE `imports` ADD `detected_timezone` text;--> statement-breakpoint
ALTER TABLE `imports` ADD `timezone_source` text DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE `imports` ADD `coverage_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `imports` ADD `tds_summary_json` text;--> statement-breakpoint
ALTER TABLE `transactions` ADD `superseded_by` text REFERENCES imports(id) ON DELETE SET NULL;--> statement-breakpoint
CREATE INDEX `transactions_superseded_by` ON `transactions` (`superseded_by`);