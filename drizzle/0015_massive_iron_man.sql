CREATE TABLE "push_subscriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"player_id" integer NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"user_agent" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "push_subscriptions_endpoint_unique" UNIQUE("endpoint")
);
--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "push_subscriptions_player_idx" ON "push_subscriptions" USING btree ("player_id");