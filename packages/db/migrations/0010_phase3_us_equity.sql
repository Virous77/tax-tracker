CREATE TABLE `equity_cy_prices` (
	`calendar_year` integer NOT NULL,
	`symbol` text NOT NULL,
	`peak_price_usd` text,
	`peak_date` text,
	`closing_price_usd` text,
	`source` text,
	PRIMARY KEY(`calendar_year`, `symbol`)
);
--> statement-breakpoint
CREATE TABLE `equity_metadata` (
	`symbol` text PRIMARY KEY NOT NULL,
	`entity_name` text NOT NULL,
	`entity_address` text,
	`zip_code` text,
	`nature_of_entity` text,
	`country_name` text,
	`country_code` text
);
--> statement-breakpoint
CREATE TABLE `us_equity_actual_balances` (
	`tax_year` text NOT NULL,
	`asset` text NOT NULL,
	`source` text DEFAULT '' NOT NULL,
	`amount` text NOT NULL,
	PRIMARY KEY(`tax_year`, `asset`, `source`)
);
--> statement-breakpoint
CREATE TABLE `us_equity_report_invalidations` (
	`tax_year` text PRIMARY KEY NOT NULL,
	`invalidated_at` text NOT NULL,
	`cause` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `us_equity_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`tax_year` text NOT NULL,
	`computed_at` text NOT NULL,
	`settings_json` text NOT NULL,
	`report_json` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `imports` ADD `asset_class` text;
--> statement-breakpoint
ALTER TABLE `transactions` ADD `asset_class` text DEFAULT 'vda' NOT NULL;
--> statement-breakpoint
ALTER TABLE `transactions` ADD `dividend_asset` text;
--> statement-breakpoint
ALTER TABLE `transactions` ADD `withholding_tax_amount` text;
--> statement-breakpoint
ALTER TABLE `transactions` ADD `withholding_tax_asset` text;
--> statement-breakpoint
ALTER TABLE `transactions` ADD `entity_name` text;
--> statement-breakpoint
CREATE INDEX `transactions_asset_class` ON `transactions` (`asset_class`);
