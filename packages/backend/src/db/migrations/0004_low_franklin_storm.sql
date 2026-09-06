-- oxy:deploy-phase=pre
-- Two nullable columns and four constraints, all of which the RUNNING image
-- already satisfies: it writes faircoin intents only, and leaves both new
-- columns NULL, which is exactly what `..._faircoin_has_no_provider_check`
-- demands. `..._card_requires_provider_check` binds on no existing row because
-- no card intent exists anywhere yet. Verified by applying this over a database
-- holding pre-existing rows in the old shape and re-running the old insert.
ALTER TABLE "payment_intents" ADD COLUMN "provider" text;--> statement-breakpoint
ALTER TABLE "payment_intents" ADD COLUMN "provider_object_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_intents_provider_object_key" ON "payment_intents" USING btree ("provider","provider_object_id") WHERE "payment_intents"."provider_object_id" is not null;--> statement-breakpoint
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_provider_check" CHECK (provider is null or provider in ('stripe'));--> statement-breakpoint
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_card_requires_provider_check" CHECK ("payment_intents"."rail" <> 'card' or "payment_intents"."provider" is not null);--> statement-breakpoint
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_faircoin_has_no_provider_check" CHECK ("payment_intents"."rail" <> 'faircoin' or ("payment_intents"."provider" is null and "payment_intents"."provider_object_id" is null));--> statement-breakpoint
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_provider_object_needs_provider_check" CHECK ("payment_intents"."provider_object_id" is null or "payment_intents"."provider" is not null);