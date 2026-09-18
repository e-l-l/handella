CREATE TABLE `attention_items` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`body` text,
	`created_at` integer NOT NULL,
	`resolved_at` integer,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "attention_items_kind_check" CHECK("attention_items"."kind" in ('planApproval', 'blocker', 'disputedReview', 'conflictProposal', 'readyPr', 'failure'))
);
--> statement-breakpoint
CREATE INDEX `attention_items_resolved_at_idx` ON `attention_items` (`resolved_at`,`created_at`);--> statement-breakpoint
CREATE INDEX `attention_items_job_id_idx` ON `attention_items` (`job_id`);--> statement-breakpoint
CREATE TABLE `job_transitions` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`from_state` text NOT NULL,
	`to_state` text NOT NULL,
	`actor` text NOT NULL,
	`reason` text,
	`occurred_at` integer NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "job_transitions_from_state_check" CHECK("job_transitions"."from_state" in ('intake', 'queued', 'planning', 'planReview', 'approved', 'implementing', 'prOpen', 'reviewing', 'merged', 'archived', 'cancelled')),
	CONSTRAINT "job_transitions_to_state_check" CHECK("job_transitions"."to_state" in ('intake', 'queued', 'planning', 'planReview', 'approved', 'implementing', 'prOpen', 'reviewing', 'merged', 'archived', 'cancelled')),
	CONSTRAINT "job_transitions_actor_check" CHECK("job_transitions"."actor" in ('handler', 'system'))
);
--> statement-breakpoint
CREATE INDEX `job_transitions_job_id_occurred_at_idx` ON `job_transitions` (`job_id`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`title` text NOT NULL,
	`work_class` text NOT NULL,
	`state` text NOT NULL,
	`suspension` text,
	`linear_issue_key` text,
	`canonical_branch` text,
	`base_branch` text NOT NULL,
	`queue_priority` integer,
	`worktree_path` text,
	`codex_session_id` text,
	`original_pr_url` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "jobs_source_check" CHECK("jobs"."source" in ('linear', 'slack', 'adhoc')),
	CONSTRAINT "jobs_work_class_check" CHECK("jobs"."work_class" in ('feature', 'routine')),
	CONSTRAINT "jobs_state_check" CHECK("jobs"."state" in ('intake', 'queued', 'planning', 'planReview', 'approved', 'implementing', 'prOpen', 'reviewing', 'merged', 'archived', 'cancelled')),
	CONSTRAINT "jobs_suspension_check" CHECK("jobs"."suspension" is null or "jobs"."suspension" in ('stoppedByHandler', 'stoppedBySystem', 'interrupted'))
);
--> statement-breakpoint
CREATE INDEX `jobs_state_suspension_idx` ON `jobs` (`state`,`suspension`);--> statement-breakpoint
CREATE INDEX `jobs_created_at_idx` ON `jobs` (`created_at`);--> statement-breakpoint
CREATE TABLE `plan_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`revision` integer NOT NULL,
	`content` text NOT NULL,
	`feedback` text,
	`approval_state` text NOT NULL,
	`approved_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "plan_versions_approval_state_check" CHECK("plan_versions"."approval_state" in ('pending', 'approved', 'changesRequested')),
	CONSTRAINT "plan_versions_revision_check" CHECK("plan_versions"."revision" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `plan_versions_job_id_revision_unique` ON `plan_versions` (`job_id`,`revision`);--> statement-breakpoint
CREATE TABLE `review_rounds` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`round_number` integer NOT NULL,
	`comments` text NOT NULL,
	`verdicts` text,
	`child_branch` text,
	`child_pr_url` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "review_rounds_round_number_check" CHECK("review_rounds"."round_number" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `review_rounds_job_id_round_number_unique` ON `review_rounds` (`job_id`,`round_number`);--> statement-breakpoint
CREATE TABLE `runbook_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`content` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `runbook_snapshots_job_id_idx` ON `runbook_snapshots` (`job_id`);