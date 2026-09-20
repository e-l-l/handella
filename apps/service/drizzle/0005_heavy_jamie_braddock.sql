CREATE TABLE `implementation_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`round` integer NOT NULL,
	`attempt` integer NOT NULL,
	`codex_session_id` text NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`outcome` text,
	`report` text,
	`failure_reason` text,
	`log_path` text NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "implementation_attempts_attempt_check" CHECK("implementation_attempts"."attempt" >= 1),
	CONSTRAINT "implementation_attempts_round_check" CHECK("implementation_attempts"."round" >= 1),
	CONSTRAINT "implementation_attempts_outcome_check" CHECK("implementation_attempts"."outcome" is null or "implementation_attempts"."outcome" in ('reportedDone', 'reportedBlocked', 'failed', 'timedOut', 'stopped', 'interrupted'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `implementation_attempts_job_id_round_attempt_unique` ON `implementation_attempts` (`job_id`,`round`,`attempt`);--> statement-breakpoint
CREATE TABLE `milestones` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`attempt_id` text NOT NULL,
	`seq` integer NOT NULL,
	`kind` text NOT NULL,
	`summary` text NOT NULL,
	`detail` text,
	`exit_code` integer,
	`occurred_at` integer NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`attempt_id`) REFERENCES `implementation_attempts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "milestones_kind_check" CHECK("milestones"."kind" in ('command', 'fileChange', 'narration', 'todoList')),
	CONSTRAINT "milestones_seq_check" CHECK("milestones"."seq" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `milestones_attempt_id_seq_unique` ON `milestones` (`attempt_id`,`seq`);--> statement-breakpoint
CREATE INDEX `milestones_job_id_occurred_at_idx` ON `milestones` (`job_id`,`occurred_at`);