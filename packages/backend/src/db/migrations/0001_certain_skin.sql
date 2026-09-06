-- oxy:deploy-phase=pre
ALTER TABLE "checkout_sessions" DROP CONSTRAINT "checkout_sessions_network_check";--> statement-breakpoint
ALTER TABLE "payment_intents" DROP CONSTRAINT "payment_intents_status_check";--> statement-breakpoint
ALTER TABLE "payment_intents" DROP CONSTRAINT "payment_intents_currency_check";--> statement-breakpoint
ALTER TABLE "payment_intents" DROP CONSTRAINT "payment_intents_network_check";--> statement-breakpoint
ALTER TABLE "payment_intents" DROP CONSTRAINT "payment_intents_broadcast_requires_txid_check";--> statement-breakpoint
ALTER TABLE "payment_links" DROP CONSTRAINT "payment_links_network_check";--> statement-breakpoint
ALTER TABLE "checkout_sessions" ALTER COLUMN "network" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_intents" ALTER COLUMN "network" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_intents" ALTER COLUMN "address" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_links" ALTER COLUMN "network" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "checkout_sessions" ADD COLUMN "currency" text DEFAULT 'FAIR' NOT NULL;--> statement-breakpoint
ALTER TABLE "checkout_sessions" ADD COLUMN "rail" text DEFAULT 'faircoin' NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_intents" ADD COLUMN "rail" text DEFAULT 'faircoin' NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_links" ADD COLUMN "currency" text DEFAULT 'FAIR' NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_links" ADD COLUMN "rail" text DEFAULT 'faircoin' NOT NULL;--> statement-breakpoint
-- REORDERED BY HAND, and this is the ONE edit this file carries.
--
-- drizzle-kit emitted this `ADD CONSTRAINT ... UNIQUE` AFTER the three foreign
-- keys that reference it, so applying the file as generated fails with
-- `42830 there is no unique constraint matching given keys for referenced table
-- "merchants"`. MEASURED against PostgreSQL 16.13, twice: as generated it fails
-- on the first of those foreign keys; in this order it applies clean.
--
-- `CONVENTIONS.md` already records the ordering hazard for a `uniqueIndex()`
-- target on a NEW table. This is its second form: on an EXISTING table even a
-- `unique()` table constraint is emitted late, because there is no CREATE TABLE
-- for it to ride inside. `tsc` and `drizzle-kit generate` are both clean.
ALTER TABLE "merchants" ADD CONSTRAINT "merchants_id_oxy_app_id_environment_key" UNIQUE("id","oxy_app_id","environment");
--> statement-breakpoint
ALTER TABLE "checkout_sessions" ADD CONSTRAINT "checkout_sessions_merchant_identity_no_network_fkey" FOREIGN KEY ("merchant_id","oxy_app_id","environment") REFERENCES "public"."merchants"("id","oxy_app_id","environment") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_links" ADD CONSTRAINT "payment_links_merchant_identity_no_network_fkey" FOREIGN KEY ("merchant_id","oxy_app_id","environment") REFERENCES "public"."merchants"("id","oxy_app_id","environment") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkout_sessions" ADD CONSTRAINT "checkout_sessions_rail_check" CHECK (rail in ('faircoin', 'card'));--> statement-breakpoint
ALTER TABLE "checkout_sessions" ADD CONSTRAINT "checkout_sessions_currency_check" CHECK (currency in ('FAIR', 'EUR', 'USD'));--> statement-breakpoint
ALTER TABLE "checkout_sessions" ADD CONSTRAINT "checkout_sessions_rail_network_agrees_check" CHECK (("checkout_sessions"."rail" = 'faircoin') = ("checkout_sessions"."network" is not null));--> statement-breakpoint
ALTER TABLE "checkout_sessions" ADD CONSTRAINT "checkout_sessions_rail_currency_agrees_check" CHECK (("checkout_sessions"."rail" = 'faircoin') = ("checkout_sessions"."currency" = 'FAIR'));--> statement-breakpoint
ALTER TABLE "checkout_sessions" ADD CONSTRAINT "checkout_sessions_network_check" CHECK (network is null or network in ('mainnet', 'testnet'));--> statement-breakpoint
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_rail_check" CHECK (rail in ('faircoin', 'card'));--> statement-breakpoint
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_rail_currency_agrees_check" CHECK (("payment_intents"."rail" = 'faircoin') = ("payment_intents"."currency" = 'FAIR'));--> statement-breakpoint
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_faircoin_requires_chain_fields_check" CHECK ("payment_intents"."rail" <> 'faircoin' or ("payment_intents"."address" is not null and "payment_intents"."network" is not null));--> statement-breakpoint
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_card_has_no_chain_fields_check" CHECK ("payment_intents"."rail" <> 'card' or ("payment_intents"."address" is null and "payment_intents"."network" is null and "payment_intents"."txid" is null and "payment_intents"."confirmations" = 0));--> statement-breakpoint
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_chain_statuses_are_faircoin_check" CHECK (status not in ('awaiting_approval', 'approved', 'broadcast', 'confirming') or rail = 'faircoin');--> statement-breakpoint
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_card_statuses_are_card_check" CHECK (status not in ('requires_action', 'processing', 'refunded', 'partially_refunded') or rail = 'card');--> statement-breakpoint
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_status_check" CHECK (status in ('created', 'awaiting_approval', 'approved', 'broadcast', 'confirming', 'requires_action', 'processing', 'settled', 'refunded', 'partially_refunded', 'expired', 'failed', 'rejected'));--> statement-breakpoint
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_currency_check" CHECK (currency in ('FAIR', 'EUR', 'USD'));--> statement-breakpoint
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_network_check" CHECK (network is null or network in ('mainnet', 'testnet'));--> statement-breakpoint
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_broadcast_requires_txid_check" CHECK ("payment_intents"."rail" <> 'faircoin' or "payment_intents"."status" not in ('broadcast', 'confirming', 'settled') or "payment_intents"."txid" is not null);--> statement-breakpoint
ALTER TABLE "payment_links" ADD CONSTRAINT "payment_links_rail_check" CHECK (rail in ('faircoin', 'card'));--> statement-breakpoint
ALTER TABLE "payment_links" ADD CONSTRAINT "payment_links_currency_check" CHECK (currency in ('FAIR', 'EUR', 'USD'));--> statement-breakpoint
ALTER TABLE "payment_links" ADD CONSTRAINT "payment_links_rail_network_agrees_check" CHECK (("payment_links"."rail" = 'faircoin') = ("payment_links"."network" is not null));--> statement-breakpoint
ALTER TABLE "payment_links" ADD CONSTRAINT "payment_links_rail_currency_agrees_check" CHECK (("payment_links"."rail" = 'faircoin') = ("payment_links"."currency" = 'FAIR'));--> statement-breakpoint
ALTER TABLE "payment_links" ADD CONSTRAINT "payment_links_network_check" CHECK (network is null or network in ('mainnet', 'testnet'));