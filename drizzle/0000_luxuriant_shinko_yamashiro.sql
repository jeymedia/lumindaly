CREATE TABLE `admin_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`admin_user_id` text NOT NULL,
	`note` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`case_id`) REFERENCES `cases`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`admin_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_adminnotes_case` ON `admin_notes` (`case_id`);--> statement-breakpoint
CREATE TABLE `affiliates` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`code` text NOT NULL,
	`slug` text NOT NULL,
	`boost_started_at` integer NOT NULL,
	`boost_ends_at` integer NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_affiliate_user` ON `affiliates` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_affiliate_code` ON `affiliates` (`code`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_affiliate_slug` ON `affiliates` (`slug`);--> statement-breakpoint
CREATE TABLE `ai_analyses` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text,
	`scan_id` text,
	`type` text NOT NULL,
	`model` text NOT NULL,
	`input_hash` text NOT NULL,
	`result_json` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`case_id`) REFERENCES `cases`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`scan_id`) REFERENCES `scans`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_analyses_case` ON `ai_analyses` (`case_id`);--> statement-breakpoint
CREATE TABLE `anonymous_visitors` (
	`id` text PRIMARY KEY NOT NULL,
	`affiliate_id` text,
	`referral_at` integer,
	`expires_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`affiliate_id`) REFERENCES `affiliates`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `attributions` (
	`id` text PRIMARY KEY NOT NULL,
	`affiliate_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`source` text NOT NULL,
	`created_at` integer NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	FOREIGN KEY (`affiliate_id`) REFERENCES `affiliates`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`customer_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_attribution_customer` ON `attributions` (`customer_id`);--> statement-breakpoint
CREATE INDEX `idx_attribution_affiliate` ON `attributions` (`affiliate_id`);--> statement-breakpoint
CREATE TABLE `cases` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`tiktok_account_id` text NOT NULL,
	`scan_id` text NOT NULL,
	`violation_category` text,
	`enforcement_type` text,
	`market` text NOT NULL,
	`product_tier` text NOT NULL,
	`payment_status` text DEFAULT 'unpaid' NOT NULL,
	`status` text DEFAULT 'payment_required' NOT NULL,
	`readiness_score` integer DEFAULT 0 NOT NULL,
	`human_review_status` text DEFAULT 'not_requested' NOT NULL,
	`answers_json` text DEFAULT '{}' NOT NULL,
	`appeal_json` text,
	`rule_id` text,
	`rule_snapshot_json` text,
	`consistency_checked` integer DEFAULT 0 NOT NULL,
	`procedure_confirmed` integer DEFAULT 0 NOT NULL,
	`review_note` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tiktok_account_id`) REFERENCES `tiktok_accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`scan_id`) REFERENCES `scans`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_cases_owner` ON `cases` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_cases_review` ON `cases` (`human_review_status`,`status`);--> statement-breakpoint
CREATE TABLE `commissions` (
	`id` text PRIMARY KEY NOT NULL,
	`affiliate_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`case_id` text NOT NULL,
	`payment_id` text NOT NULL,
	`gross_amount` integer NOT NULL,
	`commission_rate` integer NOT NULL,
	`commission_amount` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`eligible_at` integer NOT NULL,
	`paid_at` integer,
	`payout_reference` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`affiliate_id`) REFERENCES `affiliates`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`customer_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`case_id`) REFERENCES `cases`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_commission_payment` ON `commissions` (`payment_id`);--> statement-breakpoint
CREATE INDEX `idx_commission_affiliate_status` ON `commissions` (`affiliate_id`,`status`);--> statement-breakpoint
CREATE TABLE `evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`file_key` text NOT NULL,
	`filename` text NOT NULL,
	`mime` text NOT NULL,
	`size` integer NOT NULL,
	`sha256` text NOT NULL,
	`status` text DEFAULT 'needs_review' NOT NULL,
	`analysis_json` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`case_id`) REFERENCES `cases`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_evidence_case_owner` ON `evidence` (`case_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `outcomes` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`user_id` text NOT NULL,
	`status` text NOT NULL,
	`restored_items_json` text NOT NULL,
	`notes` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`case_id`) REFERENCES `cases`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_outcomes_case` ON `outcomes` (`case_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `payments` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`case_id` text NOT NULL,
	`stripe_session_id` text,
	`stripe_payment_intent_id` text,
	`amount` integer NOT NULL,
	`currency` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`affiliate_id` text,
	`commission_rate` integer,
	`paid_at` integer,
	`refunded_amount` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`case_id`) REFERENCES `cases`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_payment_session` ON `payments` (`stripe_session_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_payment_case` ON `payments` (`case_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_payment_intent` ON `payments` (`stripe_payment_intent_id`);--> statement-breakpoint
CREATE INDEX `idx_payments_owner` ON `payments` (`user_id`);--> statement-breakpoint
CREATE TABLE `rate_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `referral_events` (
	`id` text PRIMARY KEY NOT NULL,
	`affiliate_id` text NOT NULL,
	`event_type` text NOT NULL,
	`anonymous_id` text NOT NULL,
	`user_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`affiliate_id`) REFERENCES `affiliates`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_referrals_affiliate_type` ON `referral_events` (`affiliate_id`,`event_type`);--> statement-breakpoint
CREATE TABLE `rules` (
	`id` text PRIMARY KEY NOT NULL,
	`market` text NOT NULL,
	`account_type` text NOT NULL,
	`violation_category` text NOT NULL,
	`enforcement_type` text NOT NULL,
	`appeal_allowed` integer,
	`appeal_count` integer,
	`appeal_window` text,
	`requirements_json` text NOT NULL,
	`questions_json` text NOT NULL,
	`common_errors_json` text NOT NULL,
	`submission_notes_json` text DEFAULT '[]' NOT NULL,
	`official_source` text NOT NULL,
	`last_verified_at` integer NOT NULL,
	`manual_review_required` integer DEFAULT 1 NOT NULL,
	`active` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_rules_matching` ON `rules` (`market`,`account_type`,`violation_category`,`enforcement_type`,`active`);--> statement-breakpoint
CREATE TABLE `scans` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`anonymous_id` text,
	`tiktok_account_id` text,
	`notice_text` text NOT NULL,
	`notice_file_key` text,
	`notice_filename` text,
	`notice_mime` text,
	`market` text,
	`account_type` text,
	`violation_category` text,
	`enforcement_type` text,
	`severity` text,
	`confidence` integer DEFAULT 0 NOT NULL,
	`readiness_score` integer DEFAULT 0 NOT NULL,
	`manual_review_required` integer DEFAULT 1 NOT NULL,
	`result_json` text NOT NULL,
	`intake_json` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tiktok_account_id`) REFERENCES `tiktok_accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_scans_owner` ON `scans` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_scans_anon` ON `scans` (`anonymous_id`);--> statement-breakpoint
CREATE TABLE `stripe_events` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tiktok_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`username` text NOT NULL,
	`account_type` text NOT NULL,
	`market` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_accounts_owner` ON `tiktok_accounts` (`user_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`country` text,
	`role` text DEFAULT 'customer' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
