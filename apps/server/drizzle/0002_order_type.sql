ALTER TABLE "orders" ADD COLUMN "order_type" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "order_types_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "default_order_type" text DEFAULT 'to_go' NOT NULL;