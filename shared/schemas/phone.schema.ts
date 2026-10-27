import { isValidPhone, PHONE_MAX_LENGTH } from "@shared/utils/phone";
import { z } from "zod";

/**
 * Customer phone shared by jobs, customers and public pre-check. Required,
 * capped and format-checked here so every entry point rejects text like
 * "abc" identically.
 */
export const phoneSchema = z
  .string()
  .trim()
  .min(1, { error: "validations.enter_phone" })
  .max(PHONE_MAX_LENGTH)
  .refine(isValidPhone, { error: "validations.invalid_phone" });
