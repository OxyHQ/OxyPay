-- oxy:deploy-phase=pre
-- One new table, and a WIDENING of `webhook_deliveries_event_type_check`.
--
-- The drop-and-re-add reads like a destructive step and is not one: the
-- replacement accepts every value the original did plus two more, so every
-- existing row passes and the RUNNING image — which writes only the five
-- original types — keeps working unchanged. A rollback to that image is also
-- safe, because it would run against a constraint wider than the one it knows.
-- Verified against a real server by re-running the running image's own insert
-- shape after applying this.
--
-- Were this NARROWING instead, it would be `post` and would need a backfill
-- first: the old image would be writing values the new constraint refuses.
CREATE TABLE "refunds" (
	"id" text PRIMARY KEY NOT NULL,
	"public_id" text NOT NULL,
	"merchant_id" text NOT NULL,
	"payment_intent_id" text NOT NULL,
	"external_ref" text NOT NULL,
	"amount" text NOT NULL,
	"currency" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"provider" text NOT NULL,
	"provider_object_id" text,
	"failure_code" text,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	CONSTRAINT "refunds_public_id_key" UNIQUE("public_id"),
	CONSTRAINT "refunds_merchant_external_ref_key" UNIQUE("merchant_id","external_ref"),
	CONSTRAINT "refunds_provider_object_key" UNIQUE("provider","provider_object_id"),
	CONSTRAINT "refunds_provider_check" CHECK (provider in ('stripe')),
	CONSTRAINT "refunds_status_check" CHECK (status in ('pending', 'succeeded', 'failed')),
	CONSTRAINT "refunds_currency_check" CHECK (currency in ('FAIR', 'EUR', 'USD')),
	CONSTRAINT "refunds_external_ref_check" CHECK (length("refunds"."external_ref") > 0),
	CONSTRAINT "refunds_amount_check" CHECK (amount ~ '^(0|[1-9][0-9]*)$'),
	CONSTRAINT "refunds_amount_positive_check" CHECK ("refunds"."amount"::numeric > 0),
	CONSTRAINT "refunds_succeeded_has_provider_object_check" CHECK ("refunds"."status" <> 'succeeded' or "refunds"."provider_object_id" is not null)
);
--> statement-breakpoint
ALTER TABLE "webhook_deliveries" DROP CONSTRAINT "webhook_deliveries_event_type_check";--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_intent_id_fkey" FOREIGN KEY ("payment_intent_id") REFERENCES "public"."payment_intents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "refunds_payment_intent_idx" ON "refunds" USING btree ("payment_intent_id");--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_event_type_check" CHECK (event_type in ('payment_intent.confirming', 'payment_intent.settled', 'payment_intent.failed', 'payment_intent.rejected', 'payment_intent.expired', 'payment_intent.refunded', 'payment_intent.partially_refunded'));