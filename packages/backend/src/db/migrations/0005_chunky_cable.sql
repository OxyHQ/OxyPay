-- oxy:deploy-phase=pre
-- Two new tables, their constraints and their foreign keys. Nothing existing is
-- touched, and no running instance reads or writes either, so this is safe ahead
-- of the image that uses them. The foreign keys land AFTER both tables and after
-- the unique constraints they reference, which is the ordering `0001` had to be
-- hand-fixed for (42830) — verified here rather than assumed.
CREATE TABLE "connected_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"public_id" text NOT NULL,
	"merchant_id" text NOT NULL,
	"external_ref" text NOT NULL,
	"provider" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"country" text NOT NULL,
	"default_currency" text,
	"payouts_enabled" boolean DEFAULT false NOT NULL,
	"charges_enabled" boolean DEFAULT false NOT NULL,
	"transfers_capability" text,
	"card_payments_capability" text,
	"requirements_currently_due" integer DEFAULT 0 NOT NULL,
	"requirements_eventually_due" integer DEFAULT 0 NOT NULL,
	"requirements_past_due" integer DEFAULT 0 NOT NULL,
	"requirements_pending_verification" integer DEFAULT 0 NOT NULL,
	"disabled_reason_codes" text[] DEFAULT '{}' NOT NULL,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	CONSTRAINT "connected_accounts_public_id_key" UNIQUE("public_id"),
	CONSTRAINT "connected_accounts_merchant_external_ref_key" UNIQUE("merchant_id","external_ref"),
	CONSTRAINT "connected_accounts_provider_account_id_key" UNIQUE("provider","provider_account_id"),
	CONSTRAINT "connected_accounts_provider_check" CHECK (provider in ('stripe')),
	CONSTRAINT "connected_accounts_external_ref_check" CHECK (length("connected_accounts"."external_ref") > 0),
	CONSTRAINT "connected_accounts_provider_account_id_check" CHECK (length("connected_accounts"."provider_account_id") > 0),
	CONSTRAINT "connected_accounts_country_check" CHECK ("connected_accounts"."country" = upper("connected_accounts"."country") and length("connected_accounts"."country") = 2),
	CONSTRAINT "connected_accounts_transfers_capability_check" CHECK (transfers_capability is null or transfers_capability in ('active', 'pending', 'inactive')),
	CONSTRAINT "connected_accounts_card_payments_capability_check" CHECK (card_payments_capability is null or card_payments_capability in ('active', 'pending', 'inactive')),
	CONSTRAINT "connected_accounts_requirements_check" CHECK ("connected_accounts"."requirements_currently_due" >= 0 and "connected_accounts"."requirements_eventually_due" >= 0
          and "connected_accounts"."requirements_past_due" >= 0 and "connected_accounts"."requirements_pending_verification" >= 0),
	CONSTRAINT "connected_accounts_disabled_reason_codes_check" CHECK (not ('' = any("connected_accounts"."disabled_reason_codes")))
);
--> statement-breakpoint
CREATE TABLE "transfers" (
	"id" text PRIMARY KEY NOT NULL,
	"public_id" text NOT NULL,
	"merchant_id" text NOT NULL,
	"payment_intent_id" text NOT NULL,
	"connected_account_id" text NOT NULL,
	"external_ref" text NOT NULL,
	"amount" text NOT NULL,
	"currency" text NOT NULL,
	"amount_reversed" text DEFAULT '0' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"provider" text NOT NULL,
	"provider_object_id" text,
	"source_payment_object_id" text,
	"failure_message" text,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	CONSTRAINT "transfers_public_id_key" UNIQUE("public_id"),
	CONSTRAINT "transfers_merchant_external_ref_key" UNIQUE("merchant_id","external_ref"),
	CONSTRAINT "transfers_provider_object_key" UNIQUE("provider","provider_object_id"),
	CONSTRAINT "transfers_provider_check" CHECK (provider in ('stripe')),
	CONSTRAINT "transfers_status_check" CHECK (status in ('pending', 'paid', 'partially_reversed', 'reversed', 'failed')),
	CONSTRAINT "transfers_currency_check" CHECK (currency in ('FAIR', 'EUR', 'USD')),
	CONSTRAINT "transfers_external_ref_check" CHECK (length("transfers"."external_ref") > 0),
	CONSTRAINT "transfers_amount_check" CHECK (amount ~ '^(0|[1-9][0-9]*)$'),
	CONSTRAINT "transfers_amount_reversed_check" CHECK (amount_reversed ~ '^(0|[1-9][0-9]*)$'),
	CONSTRAINT "transfers_reversed_within_amount_check" CHECK ("transfers"."amount_reversed"::numeric <= "transfers"."amount"::numeric),
	CONSTRAINT "transfers_reversal_status_agrees_check" CHECK (("transfers"."status" <> 'reversed' or "transfers"."amount_reversed"::numeric = "transfers"."amount"::numeric)
          and ("transfers"."status" <> 'partially_reversed'
               or ("transfers"."amount_reversed"::numeric > 0
                   and "transfers"."amount_reversed"::numeric < "transfers"."amount"::numeric))),
	CONSTRAINT "transfers_settled_has_provider_object_check" CHECK ("transfers"."status" = 'pending' or "transfers"."status" = 'failed'
          or "transfers"."provider_object_id" is not null)
);
--> statement-breakpoint
ALTER TABLE "connected_accounts" ADD CONSTRAINT "connected_accounts_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_payment_intent_id_fkey" FOREIGN KEY ("payment_intent_id") REFERENCES "public"."payment_intents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_connected_account_id_fkey" FOREIGN KEY ("connected_account_id") REFERENCES "public"."connected_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "connected_accounts_sync_idx" ON "connected_accounts" USING btree ("provider","last_synced_at");--> statement-breakpoint
CREATE INDEX "transfers_payment_intent_idx" ON "transfers" USING btree ("payment_intent_id");--> statement-breakpoint
CREATE INDEX "transfers_connected_account_idx" ON "transfers" USING btree ("connected_account_id");