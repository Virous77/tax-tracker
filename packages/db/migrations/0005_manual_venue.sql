ALTER TABLE `transactions` ADD `venue` text;
--> statement-breakpoint
UPDATE `transactions` SET `venue` = 'manual' WHERE `source` = 'manual';
