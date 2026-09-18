ALTER TABLE `jobs` ADD `linear_issue_id` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `linear_issue_url` text;--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_live_linear_issue_id_unique` ON `jobs` (`linear_issue_id`) WHERE "jobs"."linear_issue_id" is not null and "jobs"."state" not in ('archived', 'cancelled', 'merged');--> statement-breakpoint
CREATE INDEX `jobs_linear_issue_key_idx` ON `jobs` (`linear_issue_key`);