CREATE TABLE "site_rate_limit_counters" (
	"id" bigserial PRIMARY KEY,
	"site_id" uuid NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"request_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "site_rate_limit_counters_site_window_uidx" ON "site_rate_limit_counters" ("site_id","window_start");--> statement-breakpoint
CREATE INDEX "site_rate_limit_counters_window_start_idx" ON "site_rate_limit_counters" ("window_start");--> statement-breakpoint
ALTER TABLE "site_rate_limit_counters" ADD CONSTRAINT "site_rate_limit_counters_site_id_sites_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE;