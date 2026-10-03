-- Optional monthly revenue goal — the owner dashboard shows progress
-- against it. Null = no goal set, nothing is displayed.
ALTER TABLE "shop_settings" ADD COLUMN "monthlyRevenueGoal" DECIMAL(10,2);
