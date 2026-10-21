import { AppError } from "@shared/errors/app-error.js";
import type { z } from "zod";
export function parseInput<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new AppError("VALIDATION_ERROR");
  }
  return result.data;
}
