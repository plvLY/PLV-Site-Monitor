CREATE TABLE "system_settings" (
  "id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
  "event_retention_days" integer DEFAULT 90 NOT NULL,
  "ip_retention_days" integer DEFAULT 30 NOT NULL,
  "user_agent_retention_days" integer DEFAULT 30 NOT NULL,
  "store_raw_ip" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "system_settings_singleton_id_check" CHECK ("id" = 1),
  CONSTRAINT "system_settings_event_retention_check" CHECK ("event_retention_days" BETWEEN 1 AND 90),
  CONSTRAINT "system_settings_ip_retention_check" CHECK ("ip_retention_days" BETWEEN 1 AND 30),
  CONSTRAINT "system_settings_user_agent_retention_check" CHECK ("user_agent_retention_days" BETWEEN 1 AND 30)
);
--> statement-breakpoint
INSERT INTO "system_settings" (
  "id",
  "event_retention_days",
  "ip_retention_days",
  "user_agent_retention_days",
  "store_raw_ip"
)
VALUES (1, 90, 30, 30, true)
ON CONFLICT ("id") DO NOTHING;
