CREATE TYPE "public"."gender" AS ENUM('woman', 'man', 'nonbinary');--> statement-breakpoint
CREATE TYPE "public"."intent" AS ENUM('date', 'friends', 'either');--> statement-breakpoint
CREATE TYPE "public"."photo_status" AS ENUM('awaiting_upload', 'processing', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."verification_status" AS ENUM('awaiting_upload', 'processing', 'verified', 'failed');--> statement-breakpoint
CREATE TABLE "photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"status" "photo_status" DEFAULT 'awaiting_upload' NOT NULL,
	"upload_key" text NOT NULL,
	"public_prefix" text,
	"width" integer,
	"height" integer,
	"rejection_reason" text,
	"moderation_labels" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"birth_date" date NOT NULL,
	"gender" "gender" NOT NULL,
	"intent" "intent" DEFAULT 'either' NOT NULL,
	"bio" text DEFAULT '' NOT NULL,
	"job_title" text,
	"education" text,
	"neighbourhood" text,
	"height_cm" smallint,
	"interests" text[] DEFAULT '{}'::text[] NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "selfie_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"status" "verification_status" DEFAULT 'awaiting_upload' NOT NULL,
	"upload_key" text NOT NULL,
	"similarity" real,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "photos" ADD CONSTRAINT "photos_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "selfie_verifications" ADD CONSTRAINT "selfie_verifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "photos_user_position_idx" ON "photos" USING btree ("user_id","position");--> statement-breakpoint
CREATE INDEX "profiles_gender_idx" ON "profiles" USING btree ("gender");--> statement-breakpoint
CREATE INDEX "selfie_verifications_user_created_idx" ON "selfie_verifications" USING btree ("user_id","created_at");