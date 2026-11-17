CREATE TABLE "page_events" (
	"id" bigserial PRIMARY KEY,
	"site_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"event_type" varchar(32) DEFAULT 'page_view' NOT NULL,
	"visitor_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"page_url" varchar(2048) NOT NULL,
	"page_path" varchar(1024) NOT NULL,
	"page_title" varchar(500),
	"referrer" varchar(2048),
	"referrer_host" varchar(255),
	"utm_source" varchar(255),
	"utm_medium" varchar(255),
	"utm_campaign" varchar(255),
	"utm_term" varchar(255),
	"utm_content" varchar(255),
	"occurred_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_agent" varchar(1000),
	"device_type" varchar(32),
	"browser" varchar(100),
	"os" varchar(100),
	"ip_address" inet,
	"ip_hash" varchar(128),
	"country_code" varchar(10),
	"region" varchar(120),
	"city" varchar(120)
);
--> statement-breakpoint
CREATE TABLE "site_domains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"site_id" uuid NOT NULL,
	"domain" varchar(255) NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"name" varchar(100) NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"timezone" varchar(64) DEFAULT 'UTC' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "page_events_site_event_uidx" ON "page_events" ("site_id","event_id");--> statement-breakpoint
CREATE INDEX "page_events_site_received_idx" ON "page_events" ("site_id","received_at");--> statement-breakpoint
CREATE INDEX "page_events_site_visitor_received_idx" ON "page_events" ("site_id","visitor_id","received_at");--> statement-breakpoint
CREATE INDEX "page_events_site_session_received_idx" ON "page_events" ("site_id","session_id","received_at");--> statement-breakpoint
CREATE INDEX "page_events_site_path_idx" ON "page_events" ("site_id","page_path");--> statement-breakpoint
CREATE UNIQUE INDEX "site_domains_domain_uidx" ON "site_domains" ("domain");--> statement-breakpoint
CREATE INDEX "site_domains_site_id_idx" ON "site_domains" ("site_id");--> statement-breakpoint
ALTER TABLE "page_events" ADD CONSTRAINT "page_events_site_id_sites_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id");--> statement-breakpoint
ALTER TABLE "site_domains" ADD CONSTRAINT "site_domains_site_id_sites_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id");

--> statement-breakpoint
CREATE UNIQUE INDEX "site_domains_one_primary_uidx"
ON "site_domains" ("site_id")
WHERE "is_primary" = true;