ALTER TABLE "devices" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "devices" CASCADE;--> statement-breakpoint
ALTER TABLE "checkout_requests" ADD CONSTRAINT "checkout_requests_occupancy_id_fkey" FOREIGN KEY ("occupancy_id") REFERENCES "public"."checkin_blocks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "club_events" ADD CONSTRAINT "club_events_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "public"."visits"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "club_events" ADD CONSTRAINT "club_events_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "club_events" ADD CONSTRAINT "club_events_register_id_fkey" FOREIGN KEY ("register_id") REFERENCES "public"."register_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "public"."inventory_resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lane_sessions" ADD CONSTRAINT "lane_sessions_assigned_resource_id_fkey" FOREIGN KEY ("assigned_resource_id") REFERENCES "public"."inventory_resources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_inventory_reservations_resource" ON "inventory_reservations" USING btree ("resource_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_lane_sessions_assigned_resource" ON "lane_sessions" USING btree ("assigned_resource_id" uuid_ops);