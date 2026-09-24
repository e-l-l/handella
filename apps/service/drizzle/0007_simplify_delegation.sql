-- Hand-written before the first apply, on top of what drizzle-kit generated
-- (docs/adr/0015). Three things the generator cannot see:
--   1. `overlapWarning` leaves the kinds, so the items have to go before the
--      table is recreated under a CHECK that no longer permits them.
--   2. `reportedDone` and `reportedBlocked` become `finished`. Remapped in the
--      SELECT that fills the new table rather than by an UPDATE first: the old
--      CHECK does not permit `finished` either, so an UPDATE would be refused.
--   3. The migrator runs every pending migration inside one transaction, so
--      the `PRAGMA foreign_keys=OFF` it emits is a no-op and the DROP behind
--      the recreate cascades through `milestones`. The rows are parked in a
--      temp table and put back.
DELETE FROM `attention_items` WHERE `kind` = 'overlapWarning';--> statement-breakpoint
DROP TABLE `plan_versions`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_attention_items` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`body` text,
	`created_at` integer NOT NULL,
	`resolved_at` integer,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "attention_items_kind_check" CHECK("__new_attention_items"."kind" in ('planApproval', 'blocker', 'disputedReview', 'conflictProposal', 'readyPr', 'failure', 'orphanWorktree', 'handlerInput'))
);
--> statement-breakpoint
INSERT INTO `__new_attention_items`("id", "job_id", "kind", "title", "body", "created_at", "resolved_at") SELECT "id", "job_id", "kind", "title", "body", "created_at", "resolved_at" FROM `attention_items`;--> statement-breakpoint
DROP TABLE `attention_items`;--> statement-breakpoint
ALTER TABLE `__new_attention_items` RENAME TO `attention_items`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `attention_items_resolved_at_idx` ON `attention_items` (`resolved_at`,`created_at`);--> statement-breakpoint
CREATE INDEX `attention_items_job_id_idx` ON `attention_items` (`job_id`);--> statement-breakpoint
CREATE TEMP TABLE `milestones_keep` AS SELECT * FROM `milestones`;--> statement-breakpoint
CREATE TABLE `__new_implementation_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`codex_session_id` text NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`outcome` text,
	`failure_reason` text,
	`log_path` text NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "implementation_attempts_outcome_check" CHECK("__new_implementation_attempts"."outcome" is null or "__new_implementation_attempts"."outcome" in ('finished', 'failed', 'timedOut', 'stopped', 'interrupted'))
);
--> statement-breakpoint
INSERT INTO `__new_implementation_attempts`("id", "job_id", "codex_session_id", "started_at", "ended_at", "outcome", "failure_reason", "log_path") SELECT "id", "job_id", "codex_session_id", "started_at", "ended_at", CASE "outcome" WHEN 'reportedDone' THEN 'finished' WHEN 'reportedBlocked' THEN 'finished' ELSE "outcome" END, "failure_reason", "log_path" FROM `implementation_attempts`;--> statement-breakpoint
DROP TABLE `implementation_attempts`;--> statement-breakpoint
ALTER TABLE `__new_implementation_attempts` RENAME TO `implementation_attempts`;--> statement-breakpoint
CREATE INDEX `implementation_attempts_job_id_started_at_idx` ON `implementation_attempts` (`job_id`,`started_at`);--> statement-breakpoint
INSERT OR IGNORE INTO `milestones` SELECT * FROM `milestones_keep`;--> statement-breakpoint
DROP TABLE `milestones_keep`;--> statement-breakpoint
ALTER TABLE `jobs` ADD `hold` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `codex_pass` text;