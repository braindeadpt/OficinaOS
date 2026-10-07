-- Widen jobs.imei 16→32: the column now doubles as the serial-number field
-- for non-phone equipment (laptops, TVs, GPS, consoles) whose serials are
-- longer than a 16-digit MEID. No data rewrite needed.
ALTER TABLE "jobs" ALTER COLUMN "imei" TYPE varchar(32);
