CREATE TABLE `session_watches` (
	`job_id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`rollout_path` text,
	`byte_offset` integer DEFAULT 0 NOT NULL,
	`last_turn_id` text,
	`missing_since` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "session_watches_status_check" CHECK("session_watches"."status" in ('discovering', 'following', 'lost'))
);
