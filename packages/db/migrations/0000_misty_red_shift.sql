CREATE TABLE `actual_balances` (
	`tax_year` text NOT NULL,
	`asset` text NOT NULL,
	`source` text DEFAULT '' NOT NULL,
	`amount` text NOT NULL,
	PRIMARY KEY(`tax_year`, `asset`, `source`)
);
--> statement-breakpoint
CREATE TABLE `fx_rates` (
	`currency` text NOT NULL,
	`date` text NOT NULL,
	`rate` text NOT NULL,
	`source` text NOT NULL,
	PRIMARY KEY(`currency`, `date`)
);
--> statement-breakpoint
CREATE TABLE `imports` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`file_name` text NOT NULL,
	`file_sha256` text NOT NULL,
	`timezone` text NOT NULL,
	`status` text NOT NULL,
	`rows_read` integer NOT NULL,
	`rows_inserted` integer NOT NULL,
	`rows_duplicate` integer NOT NULL,
	`rows_error` integer NOT NULL,
	`recipe_id` text,
	`created_at` text NOT NULL,
	`error` text,
	`warnings` text NOT NULL,
	`sheets` text,
	`row_errors` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`payload` text NOT NULL,
	`result` text,
	`error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `price_cache` (
	`asset` text NOT NULL,
	`date` text NOT NULL,
	`quote` text NOT NULL,
	`price` text NOT NULL,
	`source` text NOT NULL,
	PRIMARY KEY(`asset`, `date`, `quote`)
);
--> statement-breakpoint
CREATE TABLE `raw_rows` (
	`id` text PRIMARY KEY NOT NULL,
	`import_id` text NOT NULL,
	`sheet` text NOT NULL,
	`row_index` integer NOT NULL,
	`data` text NOT NULL,
	FOREIGN KEY (`import_id`) REFERENCES `imports`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `raw_rows_position` ON `raw_rows` (`import_id`,`sheet`,`row_index`);--> statement-breakpoint
CREATE TABLE `recipes` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`fingerprint` text NOT NULL,
	`sheet` text,
	`json` text NOT NULL,
	`origin` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recipes_fingerprint_unique` ON `recipes` (`fingerprint`);--> statement-breakpoint
CREATE TABLE `reports` (
	`id` text PRIMARY KEY NOT NULL,
	`tax_year` text NOT NULL,
	`computed_at` text NOT NULL,
	`settings_json` text NOT NULL,
	`report_json` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`source_ref` text NOT NULL,
	`import_id` text,
	`raw_row_id` text,
	`timestamp` text NOT NULL,
	`type` text NOT NULL,
	`income_kind` text,
	`asset_in` text,
	`amount_in` text,
	`asset_out` text,
	`amount_out` text,
	`fee_asset` text,
	`fee_amount` text,
	`gst_inr` text,
	`inr_value` text,
	`inr_rate_source` text,
	`price_quote` text,
	`tds_inr` text,
	`tx_hash` text,
	`chain` text,
	`raw` text NOT NULL,
	`flags` text NOT NULL,
	`user_note` text,
	`user_edited` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`import_id`) REFERENCES `imports`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`raw_row_id`) REFERENCES `raw_rows`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `transactions_source_ref` ON `transactions` (`source`,`source_ref`);