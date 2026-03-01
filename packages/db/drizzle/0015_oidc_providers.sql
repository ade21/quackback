CREATE TABLE IF NOT EXISTS "oidc_providers" (
	"id" text PRIMARY KEY NOT NULL,
	"provider_id" varchar(50) NOT NULL,
	"display_name" varchar(100) NOT NULL,
	"discovery_url" text NOT NULL,
	"issuer" text,
	"scopes" text DEFAULT 'openid profile email' NOT NULL,
	"authorization_url" text,
	"token_url" text,
	"user_info_url" text,
	"icon_bg" varchar(30) DEFAULT 'bg-blue-600',
	"pkce_enabled" boolean DEFAULT true NOT NULL,
	"require_issuer_validation" boolean DEFAULT true NOT NULL,
	"profile_mapping" jsonb,
	"enabled" boolean DEFAULT true NOT NULL,
	"configured_by_principal_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "oidc_providers_provider_id_unique" UNIQUE("provider_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "oidc_providers" ADD CONSTRAINT "oidc_providers_configured_by_principal_id_principal_id_fk" FOREIGN KEY ("configured_by_principal_id") REFERENCES "public"."principal"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "oidc_provider_enabled_idx" ON "oidc_providers" USING btree ("enabled");
