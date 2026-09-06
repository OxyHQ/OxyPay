-- oxy:deploy-phase=pre
ALTER TABLE "webhook_deliveries" DROP CONSTRAINT "webhook_deliveries_last_status_check";--> statement-breakpoint
ALTER TABLE "webhook_deliveries" DROP CONSTRAINT "webhook_deliveries_attempts_check";--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ALTER COLUMN "attempts" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ALTER COLUMN "delivered" SET DEFAULT false;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ALTER COLUMN "last_status" SET DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD COLUMN "payload" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD COLUMN "next_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD COLUMN "lease_owner" text;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD COLUMN "lease_expires_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "webhook_deliveries_due_idx" ON "webhook_deliveries" USING btree ("next_attempt_at") WHERE "webhook_deliveries"."next_attempt_at" is not null;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_schedule_agrees_check" CHECK (("webhook_deliveries"."last_status" = 'pending') = ("webhook_deliveries"."next_attempt_at" is not null));--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_lease_agrees_check" CHECK (("webhook_deliveries"."lease_owner" is null) = ("webhook_deliveries"."lease_expires_at" is null));--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_terminal_has_no_lease_check" CHECK ("webhook_deliveries"."last_status" = 'pending' or "webhook_deliveries"."lease_owner" is null);--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_payload_object_check" CHECK (jsonb_typeof("webhook_deliveries"."payload") = 'object');--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_pending_has_envelope_check" CHECK ("webhook_deliveries"."last_status" <> 'pending' or "webhook_deliveries"."payload" <> '{}'::jsonb);--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_last_status_check" CHECK (last_status in ('pending', 'delivered', 'failed', 'dead'));--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_attempts_check" CHECK ("webhook_deliveries"."attempts" >= 0);