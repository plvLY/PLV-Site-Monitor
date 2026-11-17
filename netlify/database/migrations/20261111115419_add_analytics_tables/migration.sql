CREATE TABLE "analytics_daily_devices" (
	"id" bigserial PRIMARY KEY,
	"site_id" uuid NOT NULL,
	"stat_date" date NOT NULL,
	"timezone" varchar(64) NOT NULL,
	"dimension" varchar(32) NOT NULL,
	"dimension_key" varchar(64) NOT NULL,
	"dimension_value" varchar(100),
	"page_views" bigint DEFAULT 0 NOT NULL,
	"unique_visitors" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "analytics_daily_devices_dimension_check" CHECK ("dimension" IN ('browser', 'os', 'device_type'))
);
--> statement-breakpoint
CREATE TABLE "analytics_daily_locations" (
	"id" bigserial PRIMARY KEY,
	"site_id" uuid NOT NULL,
	"stat_date" date NOT NULL,
	"timezone" varchar(64) NOT NULL,
	"country_code" varchar(10),
	"region" varchar(120),
	"city" varchar(120),
	"dimension_key" varchar(64) NOT NULL,
	"page_views" bigint DEFAULT 0 NOT NULL,
	"unique_visitors" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analytics_daily_memberships" (
	"id" bigserial PRIMARY KEY,
	"site_id" uuid NOT NULL,
	"stat_date" date NOT NULL,
	"timezone" varchar(64) NOT NULL,
	"dimension" varchar(32) NOT NULL,
	"dimension_key" varchar(64) NOT NULL,
	"subject_type" varchar(16) NOT NULL,
	"subject_key" varchar(64) NOT NULL,
	"subject_key_version" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "analytics_daily_memberships_subject_type_check" CHECK ("subject_type" IN ('visitor', 'session')),
	CONSTRAINT "analytics_daily_memberships_subject_version_check" CHECK ("subject_key_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "analytics_daily_overview" (
	"id" bigserial PRIMARY KEY,
	"site_id" uuid NOT NULL,
	"stat_date" date NOT NULL,
	"timezone" varchar(64) NOT NULL,
	"page_views" bigint DEFAULT 0 NOT NULL,
	"visitors" bigint DEFAULT 0 NOT NULL,
	"sessions" bigint DEFAULT 0 NOT NULL,
	"completed_sessions" bigint DEFAULT 0 NOT NULL,
	"bounce_sessions" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analytics_daily_pages" (
	"id" bigserial PRIMARY KEY,
	"site_id" uuid NOT NULL,
	"stat_date" date NOT NULL,
	"timezone" varchar(64) NOT NULL,
	"page_path" varchar(1024) NOT NULL,
	"page_views" bigint DEFAULT 0 NOT NULL,
	"unique_visitors" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analytics_daily_sources" (
	"id" bigserial PRIMARY KEY,
	"site_id" uuid NOT NULL,
	"stat_date" date NOT NULL,
	"timezone" varchar(64) NOT NULL,
	"dimension" varchar(32) NOT NULL,
	"dimension_key" varchar(64) NOT NULL,
	"dimension_value" varchar(255),
	"page_views" bigint DEFAULT 0 NOT NULL,
	"unique_visitors" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "analytics_daily_sources_dimension_check" CHECK ("dimension" IN (
        'referrer_host',
        'utm_source',
        'utm_medium',
        'utm_campaign'
      ))
);
--> statement-breakpoint
CREATE TABLE "analytics_event_facts" (
	"id" bigserial PRIMARY KEY,
	"site_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"stat_date" date NOT NULL,
	"timezone" varchar(64) NOT NULL,
	"visitor_key" varchar(64) NOT NULL,
	"visitor_key_version" smallint NOT NULL,
	"session_key" varchar(64) NOT NULL,
	"session_key_version" smallint NOT NULL,
	"page_path" varchar(1024) NOT NULL,
	"page_title" varchar(500),
	"referrer_host" varchar(255),
	"utm_source" varchar(255),
	"utm_medium" varchar(255),
	"utm_campaign" varchar(255),
	"utm_term" varchar(255),
	"utm_content" varchar(255),
	"browser" varchar(100),
	"os" varchar(100),
	"device_type" varchar(32),
	"country_code" varchar(10),
	"region" varchar(120),
	"city" varchar(120),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "analytics_event_facts_visitor_key_version_check" CHECK ("visitor_key_version" > 0),
	CONSTRAINT "analytics_event_facts_session_key_version_check" CHECK ("session_key_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "analytics_session_facts" (
	"id" bigserial PRIMARY KEY,
	"site_id" uuid NOT NULL,
	"session_key" varchar(64) NOT NULL,
	"session_key_version" smallint NOT NULL,
	"visitor_key" varchar(64) NOT NULL,
	"visitor_key_version" smallint NOT NULL,
	"session_model_version" smallint NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"last_activity_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"timezone" varchar(64) NOT NULL,
	"stat_date" date NOT NULL,
	"entry_page" varchar(1024) NOT NULL,
	"exit_page" varchar(1024),
	"page_view_count" integer DEFAULT 1 NOT NULL,
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "analytics_session_status_check" CHECK ("status" IN ('active', 'completed')),
	CONSTRAINT "analytics_session_page_view_count_check" CHECK ("page_view_count" > 0),
	CONSTRAINT "analytics_session_status_ended_check" CHECK ((
        ("status" = 'active' AND "ended_at" IS NULL)
        OR
        ("status" = 'completed' AND "ended_at" IS NOT NULL)
      )),
	CONSTRAINT "analytics_session_model_version_check" CHECK ("session_model_version" IN (1, 2))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "analytics_daily_devices_unique_idx" ON "analytics_daily_devices" ("site_id","stat_date","timezone","dimension","dimension_key");--> statement-breakpoint
CREATE INDEX "analytics_daily_devices_site_date_idx" ON "analytics_daily_devices" ("site_id","stat_date");--> statement-breakpoint
CREATE UNIQUE INDEX "analytics_daily_locations_unique_idx" ON "analytics_daily_locations" ("site_id","stat_date","timezone","dimension_key");--> statement-breakpoint
CREATE INDEX "analytics_daily_locations_site_date_idx" ON "analytics_daily_locations" ("site_id","stat_date");--> statement-breakpoint
CREATE UNIQUE INDEX "analytics_daily_memberships_unique_idx" ON "analytics_daily_memberships" ("site_id","stat_date","timezone","dimension","dimension_key","subject_type","subject_key_version","subject_key");--> statement-breakpoint
CREATE INDEX "analytics_daily_memberships_site_date_idx" ON "analytics_daily_memberships" ("site_id","stat_date");--> statement-breakpoint
CREATE UNIQUE INDEX "analytics_daily_overview_unique_idx" ON "analytics_daily_overview" ("site_id","stat_date","timezone");--> statement-breakpoint
CREATE INDEX "analytics_daily_overview_site_date_idx" ON "analytics_daily_overview" ("site_id","stat_date");--> statement-breakpoint
CREATE UNIQUE INDEX "analytics_daily_pages_unique_idx" ON "analytics_daily_pages" ("site_id","stat_date","timezone","page_path");--> statement-breakpoint
CREATE INDEX "analytics_daily_pages_site_date_idx" ON "analytics_daily_pages" ("site_id","stat_date");--> statement-breakpoint
CREATE UNIQUE INDEX "analytics_daily_sources_unique_idx" ON "analytics_daily_sources" ("site_id","stat_date","timezone","dimension","dimension_key");--> statement-breakpoint
CREATE INDEX "analytics_daily_sources_site_date_idx" ON "analytics_daily_sources" ("site_id","stat_date");--> statement-breakpoint
CREATE UNIQUE INDEX "analytics_event_facts_site_event_uidx" ON "analytics_event_facts" ("site_id","event_id");--> statement-breakpoint
CREATE INDEX "analytics_event_facts_site_date_idx" ON "analytics_event_facts" ("site_id","stat_date");--> statement-breakpoint
CREATE INDEX "analytics_event_facts_site_received_idx" ON "analytics_event_facts" ("site_id","received_at");--> statement-breakpoint
CREATE INDEX "analytics_event_facts_site_visitor_idx" ON "analytics_event_facts" ("site_id","visitor_key","visitor_key_version","received_at");--> statement-breakpoint
CREATE INDEX "analytics_event_facts_site_session_idx" ON "analytics_event_facts" ("site_id","session_key","session_key_version","received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "analytics_session_facts_site_session_uidx" ON "analytics_session_facts" ("site_id","session_key","session_key_version");--> statement-breakpoint
CREATE UNIQUE INDEX "analytics_session_one_active_uidx" ON "analytics_session_facts" ("site_id","visitor_key","visitor_key_version") WHERE "status" = 'active';--> statement-breakpoint
CREATE INDEX "analytics_session_facts_site_date_idx" ON "analytics_session_facts" ("site_id","stat_date");--> statement-breakpoint
CREATE INDEX "analytics_session_facts_site_visitor_idx" ON "analytics_session_facts" ("site_id","visitor_key","visitor_key_version");--> statement-breakpoint
ALTER TABLE "analytics_daily_devices" ADD CONSTRAINT "analytics_daily_devices_site_id_sites_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id");--> statement-breakpoint
ALTER TABLE "analytics_daily_locations" ADD CONSTRAINT "analytics_daily_locations_site_id_sites_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id");--> statement-breakpoint
ALTER TABLE "analytics_daily_memberships" ADD CONSTRAINT "analytics_daily_memberships_site_id_sites_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id");--> statement-breakpoint
ALTER TABLE "analytics_daily_overview" ADD CONSTRAINT "analytics_daily_overview_site_id_sites_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id");--> statement-breakpoint
ALTER TABLE "analytics_daily_pages" ADD CONSTRAINT "analytics_daily_pages_site_id_sites_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id");--> statement-breakpoint
ALTER TABLE "analytics_daily_sources" ADD CONSTRAINT "analytics_daily_sources_site_id_sites_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id");--> statement-breakpoint
ALTER TABLE "analytics_event_facts" ADD CONSTRAINT "analytics_event_facts_site_id_sites_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id");--> statement-breakpoint
ALTER TABLE "analytics_session_facts" ADD CONSTRAINT "analytics_session_facts_site_id_sites_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id");