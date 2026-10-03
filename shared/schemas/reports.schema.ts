import { z } from "zod";

export const reportsQuerySchema = z
  .object({
    range: z.enum(["7d", "30d", "month", "year"]).optional(),
    from: z.string().datetime({ error: "validations.invalid_date" }).optional(),
    to: z.string().datetime({ error: "validations.invalid_date" }).optional(),
  })
  .refine(
    (data) => {
      if (data.from || data.to) {
        return !!data.from && !!data.to;
      }
      return !!data.range;
    },
    { message: "validations.range_or_dates_required" }
  )
  .refine(
    (data) => {
      if (data.from && data.to) {
        const diff =
          new Date(data.to).getTime() - new Date(data.from).getTime();
        return diff > 0 && diff <= 365 * 24 * 60 * 60 * 1000;
      }
      return true;
    },
    { message: "validations.custom_range_limit" }
  );

export type ReportsQueryInput = z.infer<typeof reportsQuerySchema>;

export const ordersReportQuerySchema = reportsQuerySchema.and(
  z.object({
    status: z
      .enum([
        "INTAKE",
        "WAITING_FOR_PARTS",
        "IN_REPAIR",
        "ON_HOLD",
        "DONE",
        "DELIVERED",
        "RETURNED",
        "CANCELLED",
      ])
      .optional(),
  })
);

export type OrdersReportQueryInput = z.infer<typeof ordersReportQuerySchema>;
