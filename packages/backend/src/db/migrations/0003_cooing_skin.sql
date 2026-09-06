-- oxy:deploy-phase=pre
-- One new table and its two constraints. Nothing existing is dropped, renamed or
-- narrowed, and no running instance reads or writes it yet, so it is safe ahead
-- of the image that uses it.
CREATE TABLE "provider_events" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"provider_event_id" text NOT NULL,
	"provider_account_id" text,
	"type" text NOT NULL,
	"livemode" boolean NOT NULL,
	"api_version" text,
	"object_ids" jsonb NOT NULL,
	"payload" jsonb NOT NULL,
	"processed_at" timestamp with time zone,
	"processing_error" text,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	CONSTRAINT "provider_events_identity_key" UNIQUE NULLS NOT DISTINCT("provider","provider_account_id","provider_event_id"),
	CONSTRAINT "provider_events_provider_check" CHECK (provider in ('stripe')),
	CONSTRAINT "provider_events_payload_object_check" CHECK (jsonb_typeof("provider_events"."payload") = 'object'),
	CONSTRAINT "provider_events_object_ids_object_check" CHECK (jsonb_typeof("provider_events"."object_ids") = 'object')
);
--> statement-breakpoint
CREATE INDEX "provider_events_unprocessed_idx" ON "provider_events" USING btree ("created_at") WHERE "provider_events"."processed_at" is null;