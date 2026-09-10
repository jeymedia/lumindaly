ALTER TABLE `cases` ADD `notice_text` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `cases` ADD `intake_json` text DEFAULT '{}' NOT NULL;