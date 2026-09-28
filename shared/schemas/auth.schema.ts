import { z } from "zod";

const passwordPolicy = z
  .string()
  .min(8, { error: "validations.password_min" })
  .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, {
    error: "validations.password_complexity",
  });

export const signInSchema = z.object({
  username: z.string().min(1, { error: "validations.required" }),
  password: z.string().min(1, { error: "validations.required" }),
});

export const createUserSchema = z.object({
  username: z
    .string()
    .min(3, { error: "validations.username_min" })
    .max(50)
    .regex(/^[a-zA-Z0-9_]+$/, { error: "validations.username_pattern" }),
  email: z.string().email({ error: "validations.email" }),
  password: passwordPolicy,
  role: z.enum(["OWNER", "TECHNICIAN", "FRONT_DESK"]),
});

export const changePasswordSchema = z.object({
  oldPassword: z.string().min(1, { error: "validations.required" }),
  newPassword: passwordPolicy,
  username: z
    .string()
    .min(3, { error: "validations.username_min" })
    .max(50)
    .regex(/^[a-zA-Z0-9_]+$/, { error: "validations.username_pattern" })
    .optional(),
});

export const updateProfileSchema = z.object({
  name: z
    .string()
    .min(1, { error: "validations.required" })
    .max(100)
    .optional(),
  email: z.string().email({ error: "validations.email" }).optional(),
  username: z
    .string()
    .min(3, { error: "validations.username_min" })
    .max(50)
    .regex(/^[a-zA-Z0-9_]+$/, { error: "validations.username_pattern" })
    .optional(),
});

export const resetPasswordSchema = z.object({
  password: passwordPolicy,
});

export const updateUserSchema = z.object({
  name: z
    .string()
    .min(1, { error: "validations.required" })
    .max(100)
    .optional(),
  email: z.string().email({ error: "validations.email" }).optional(),
  username: z
    .string()
    .min(3, { error: "validations.username_min" })
    .max(50)
    .regex(/^[a-zA-Z0-9_]+$/, { error: "validations.username_pattern" })
    .optional(),
  role: z.enum(["OWNER", "TECHNICIAN", "FRONT_DESK"]).optional(),
  isActive: z.boolean().optional(),
});

export const toggleUserStatusSchema = z.object({
  isActive: z.boolean(),
});

export const activityListQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(4),
});

export const userIdParamSchema = z.string().cuid();

export const userListQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().optional(),
});

export type SignInInput = z.infer<typeof signInSchema>;
export type CreateUserInput = z.infer<typeof createUserSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type ToggleUserStatusInput = z.infer<typeof toggleUserStatusSchema>;
export type UserListQueryInput = z.infer<typeof userListQuerySchema>;
export type ActivityListQueryInput = z.infer<typeof activityListQuerySchema>;
