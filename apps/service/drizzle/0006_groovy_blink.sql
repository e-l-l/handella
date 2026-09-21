CREATE TABLE `codex_processes` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`kind` text NOT NULL,
	`pid` integer NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "codex_processes_kind_check" CHECK("codex_processes"."kind" in ('plan', 'implement')),
	CONSTRAINT "codex_processes_pid_check" CHECK("codex_processes"."pid" > 0)
);
--> statement-breakpoint
CREATE INDEX `codex_processes_job_id_idx` ON `codex_processes` (`job_id`);--> statement-breakpoint
CREATE INDEX `codex_processes_live_idx` ON `codex_processes` (`started_at`) WHERE "codex_processes"."ended_at" is null;--> statement-breakpoint
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
	CONSTRAINT "attention_items_kind_check" CHECK("__new_attention_items"."kind" in ('planApproval', 'blocker', 'disputedReview', 'conflictProposal', 'readyPr', 'failure', 'orphanWorktree', 'overlapWarning'))
);
--> statement-breakpoint
INSERT INTO `__new_attention_items`("id", "job_id", "kind", "title", "body", "created_at", "resolved_at") SELECT "id", "job_id", "kind", "title", "body", "created_at", "resolved_at" FROM `attention_items`;--> statement-breakpoint
DROP TABLE `attention_items`;--> statement-breakpoint
ALTER TABLE `__new_attention_items` RENAME TO `attention_items`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `attention_items_resolved_at_idx` ON `attention_items` (`resolved_at`,`created_at`);--> statement-breakpoint
CREATE INDEX `attention_items_job_id_idx` ON `attention_items` (`job_id`);