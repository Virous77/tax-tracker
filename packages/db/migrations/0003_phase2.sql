CREATE TABLE `asset_price_ids` (
	`asset` text NOT NULL,
	`chain` text DEFAULT '' NOT NULL,
	`source` text NOT NULL,
	`source_id` text NOT NULL,
	PRIMARY KEY(`asset`, `chain`, `source`)
);
--> statement-breakpoint
CREATE TABLE `connections` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`label` text NOT NULL,
	`chain_id` integer,
	`address` text,
	`options_json` text NOT NULL,
	`created_at` text NOT NULL,
	`last_sync_at` text,
	`last_sync_status` text,
	`last_sync_error` text
);
--> statement-breakpoint
CREATE TABLE `fetched_balances` (
	`connection_id` text NOT NULL,
	`asset` text NOT NULL,
	`wallet` text DEFAULT '' NOT NULL,
	`amount` text NOT NULL,
	`fetched_at` text NOT NULL,
	PRIMARY KEY(`connection_id`, `asset`, `wallet`),
	FOREIGN KEY (`connection_id`) REFERENCES `connections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `secrets` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`iv` text NOT NULL,
	`ct` text NOT NULL,
	`tag` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sync_cursors` (
	`connection_id` text NOT NULL,
	`stream` text NOT NULL,
	`cursor_json` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`connection_id`, `stream`),
	FOREIGN KEY (`connection_id`) REFERENCES `connections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `vault_meta` (
	`id` integer PRIMARY KEY NOT NULL,
	`json` text NOT NULL
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_price_cache` (
	`source` text NOT NULL,
	`source_id` text NOT NULL,
	`quote` text NOT NULL,
	`day_basis` text NOT NULL,
	`date` text NOT NULL,
	`kind` text NOT NULL,
	`price` text NOT NULL,
	`final` integer NOT NULL,
	`fetched_at` text NOT NULL,
	PRIMARY KEY(`source`, `source_id`, `quote`, `day_basis`, `date`, `kind`)
);
--> statement-breakpoint
-- Legacy rows lack provider identity and day basis; preserve them without guessing.
CREATE TABLE `price_cache_legacy` AS SELECT * FROM `price_cache`;--> statement-breakpoint
DROP TABLE `price_cache`;--> statement-breakpoint
ALTER TABLE `__new_price_cache` RENAME TO `price_cache`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
ALTER TABLE `imports` ADD `kind` text DEFAULT 'file' NOT NULL;--> statement-breakpoint
ALTER TABLE `imports` ADD `connection_id` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `progress` text;--> statement-breakpoint
ALTER TABLE `raw_rows` ADD `tx_id` text;--> statement-breakpoint
ALTER TABLE `raw_rows` ADD `source` text;--> statement-breakpoint
ALTER TABLE `raw_rows` ADD `source_ref` text;--> statement-breakpoint
ALTER TABLE `transactions` ADD `fingerprint` text;--> statement-breakpoint
CREATE INDEX `transactions_fingerprint` ON `transactions` (`fingerprint`);
--> statement-breakpoint
UPDATE raw_rows SET tx_id=(SELECT id FROM transactions WHERE transactions.raw_row_id=raw_rows.id), source=(SELECT source FROM transactions WHERE transactions.raw_row_id=raw_rows.id), source_ref=(SELECT source_ref FROM transactions WHERE transactions.raw_row_id=raw_rows.id);
