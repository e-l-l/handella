CREATE TABLE `app_installation` (
	`singleton_key` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`installation_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_started_at` integer NOT NULL,
	CONSTRAINT "app_installation_singleton_key_check" CHECK("app_installation"."singleton_key" = 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `app_installation_installation_id_unique` ON `app_installation` (`installation_id`);