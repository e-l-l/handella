-- Phase 4 stored `plan_versions.content` as whatever the planning stub
-- returned, which was prose. It is structured JSON from here on and is parsed
-- on every read, so a row written before this migration would fail the read
-- rather than the write. The only rows that can exist are the stub's
-- placeholders, which describe no work and are worth nothing to keep.
DELETE FROM `plan_versions`;--> statement-breakpoint
CREATE TABLE `runbook_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`version` integer NOT NULL,
	`content` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT "runbook_versions_version_check" CHECK("runbook_versions"."version" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `runbook_versions_version_unique` ON `runbook_versions` (`version`);--> statement-breakpoint
DROP TABLE `runbook_snapshots`;--> statement-breakpoint
CREATE TABLE `runbook_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`runbook_version_id` text NOT NULL,
	`content` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`runbook_version_id`) REFERENCES `runbook_versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `runbook_snapshots_job_id_idx` ON `runbook_snapshots` (`job_id`);
