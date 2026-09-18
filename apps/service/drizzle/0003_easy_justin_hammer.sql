CREATE TABLE `repositories` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`path` text NOT NULL,
	`default_base_branch` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "repositories_path_absolute_check" CHECK("repositories"."path" like '/%')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `repositories_path_unique` ON `repositories` (`path`);--> statement-breakpoint
ALTER TABLE `jobs` ADD `repository_id` text REFERENCES repositories(id) ON DELETE SET NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_claimed_canonical_branch_unique` ON `jobs` (`repository_id`,`canonical_branch`) WHERE "jobs"."repository_id" is not null and "jobs"."canonical_branch" is not null and "jobs"."state" not in ('intake', 'archived', 'cancelled', 'merged');