CREATE TYPE "public"."activity_category" AS ENUM('sport', 'show', 'workshop', 'food', 'outdoors', 'art', 'science', 'games');--> statement-breakpoint
CREATE TYPE "public"."cost_split" AS ENUM('free', 'host_pays', 'split_equally', 'each_pays_own');--> statement-breakpoint
CREATE TYPE "public"."plan_status" AS ENUM('open', 'full', 'cancelled', 'completed');--> statement-breakpoint
CREATE TYPE "public"."skill_level" AS ENUM('any', 'beginner', 'intermediate', 'advanced');--> statement-breakpoint
CREATE TABLE "activities" (
	"slug" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"category" "activity_category" NOT NULL,
	"emoji" text NOT NULL,
	"default_seats" smallint DEFAULT 1 NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"host_id" uuid NOT NULL,
	"activity_slug" text NOT NULL,
	"venue_id" uuid,
	"place_name" text NOT NULL,
	"area" text NOT NULL,
	"location" geography(Point, 4326) NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"duration_minutes" smallint NOT NULL,
	"seats_total" smallint NOT NULL,
	"seats_taken" smallint DEFAULT 0 NOT NULL,
	"wanted_genders" "gender"[] NOT NULL,
	"gender_mix" jsonb,
	"age_min" smallint DEFAULT 18 NOT NULL,
	"age_max" smallint DEFAULT 100 NOT NULL,
	"skill_level" "skill_level" DEFAULT 'any' NOT NULL,
	"intent" "intent" DEFAULT 'either' NOT NULL,
	"cost_split" "cost_split" DEFAULT 'each_pays_own' NOT NULL,
	"cost_per_person_inr" integer,
	"verified_only" boolean DEFAULT false NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"status" "plan_status" DEFAULT 'open' NOT NULL,
	"cancelled_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"indexed_version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plans_seats_check" CHECK ("plans"."seats_taken" >= 0 and "plans"."seats_taken" <= "plans"."seats_total"),
	CONSTRAINT "plans_age_check" CHECK ("plans"."age_min" >= 18 and "plans"."age_min" <= "plans"."age_max"),
	CONSTRAINT "plans_wanted_genders_check" CHECK (cardinality("plans"."wanted_genders") > 0)
);
--> statement-breakpoint
ALTER TABLE "venues" ADD COLUMN "address" text;--> statement-breakpoint
ALTER TABLE "venues" ADD COLUMN "activity_slugs" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "venues" ADD COLUMN "active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_host_id_users_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_activity_slug_activities_slug_fk" FOREIGN KEY ("activity_slug") REFERENCES "public"."activities"("slug") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "plans_location_gix" ON "plans" USING gist ("location");--> statement-breakpoint
CREATE INDEX "plans_open_starts_at_idx" ON "plans" USING btree ("starts_at") WHERE "plans"."status" = 'open';--> statement-breakpoint
CREATE INDEX "plans_host_starts_at_idx" ON "plans" USING btree ("host_id","starts_at");--> statement-breakpoint
CREATE INDEX "plans_activity_starts_at_idx" ON "plans" USING btree ("activity_slug","starts_at");--> statement-breakpoint
CREATE INDEX "plans_unindexed_idx" ON "plans" USING btree ("updated_at") WHERE "plans"."version" > "plans"."indexed_version";--> statement-breakpoint
CREATE INDEX "venues_activity_slugs_gin" ON "venues" USING gin ("activity_slugs");--> statement-breakpoint
-- Launch activity catalogue (reference data). Later changes go through new migrations or the admin portal.
INSERT INTO "activities" ("slug", "name", "category", "emoji", "default_seats", "sort_order") VALUES
	('badminton', 'Badminton', 'sport', '🏸', 3, 10),
	('table-tennis', 'Table tennis', 'sport', '🏓', 1, 20),
	('tennis', 'Tennis', 'sport', '🎾', 1, 30),
	('pickleball', 'Pickleball', 'sport', '🏓', 3, 40),
	('squash', 'Squash', 'sport', '🎾', 1, 50),
	('football', 'Football', 'sport', '⚽', 9, 60),
	('cricket', 'Box cricket', 'sport', '🏏', 7, 70),
	('running', 'Running', 'sport', '🏃', 3, 80),
	('cycling', 'Cycling', 'sport', '🚴', 3, 90),
	('climbing', 'Climbing', 'sport', '🧗', 1, 100),
	('swimming', 'Swimming', 'sport', '🏊', 1, 110),
	('yoga', 'Yoga', 'sport', '🧘', 2, 120),
	('movie', 'Movie', 'show', '🎬', 1, 200),
	('comedy', 'Stand-up comedy', 'show', '🎤', 1, 210),
	('concert', 'Concert', 'show', '🎵', 2, 220),
	('theatre', 'Theatre', 'show', '🎭', 1, 230),
	('watch-match', 'Watch a match', 'show', '🏟️', 3, 240),
	('pottery', 'Pottery', 'workshop', '🏺', 1, 300),
	('perfume-making', 'Perfume making', 'workshop', '🌸', 1, 310),
	('baking', 'Baking', 'workshop', '🧁', 1, 320),
	('dance-class', 'Dance class', 'workshop', '💃', 1, 330),
	('dinner', 'Dinner', 'food', '🍽️', 1, 400),
	('brunch', 'Brunch', 'food', '🥞', 1, 410),
	('coffee', 'Coffee', 'food', '☕', 1, 420),
	('food-walk', 'Food walk', 'food', '🌮', 3, 430),
	('trek', 'Trek', 'outdoors', '🥾', 3, 500),
	('walk', 'Park walk', 'outdoors', '🚶', 1, 510),
	('painting', 'Painting', 'art', '🎨', 1, 600),
	('art-gallery', 'Art gallery', 'art', '🖼️', 1, 610),
	('photo-walk', 'Photo walk', 'art', '📷', 3, 620),
	('stargazing', 'Stargazing', 'science', '🔭', 2, 700),
	('science-talk', 'Science talk', 'science', '🔬', 1, 710),
	('board-games', 'Board games', 'games', '🎲', 3, 800),
	('bowling', 'Bowling', 'games', '🎳', 3, 810),
	('escape-room', 'Escape room', 'games', '🔐', 3, 820),
	('go-karting', 'Go-karting', 'games', '🏎️', 3, 830),
	('quiz-night', 'Quiz night', 'games', '❓', 3, 840)
ON CONFLICT ("slug") DO UPDATE SET
	"name" = EXCLUDED."name",
	"category" = EXCLUDED."category",
	"emoji" = EXCLUDED."emoji",
	"default_seats" = EXCLUDED."default_seats",
	"sort_order" = EXCLUDED."sort_order";
