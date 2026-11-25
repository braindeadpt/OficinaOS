import { z } from "zod";
import { opaqueIdSchema } from "./id.schema";

export const passwordPolicy = z
  .string()
  .min(8, { error: "validations.password_min" })
  .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, {
    error: "validations.password_complexity",
  });

export const signInSchema = z.object({
  username: z.string().min(1, { error: "validations.required" }),
  password: z.string().min(1, { error: "validations.required" }),
});

// Campos do livro de ponto (Pro "ponto") — inertes sem o módulo; a UI
// esconde-os. phoneE164 é a identidade das mensagens; os horários são
// "HH:MM" civis da loja (atrasos/saída cedo no painel de horas).
const pontoScheduleField = z
  .union([
    z.literal(""),
    z.null(),
    z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  ])
  .optional();

const pontoUserFields = {
  phoneE164: z
    .union([
      z.literal(""),
      z.null(),
      z
        .string()
        .trim()
        .regex(/^\+?[1-9]\d{7,14}$/),
    ])
    .optional(),
  pontoEnabled: z.boolean().optional(),
  externalWork: z.boolean().optional(),
  pontoSmsAllowed: z.boolean().optional(),
  pontoScheduleStart: pontoScheduleField,
  pontoScheduleEnd: pontoScheduleField,
};

export const createUserSchema = z.object({
  username: z
    .string()
    .min(3, { error: "validations.username_min" })
    .max(50)
    .regex(/^[a-zA-Z0-9_]+$/, { error: "validations.username_pattern" }),
  email: z.string().email({ error: "validations.email" }),
  password: passwordPolicy,
  role: z.enum(["OWNER", "TECHNICIAN", "FRONT_DESK"]),
  ...pontoUserFields,
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
  ...pontoUserFields,
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

export const userIdParamSchema = opaqueIdSchema;

export const userListQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().optional(),
});

// First-run setup: creates the shop's first OWNER. `login` is either a
// username or an email — the server derives the other one.
const SETUP_USERNAME_PATTERN = /^[a-zA-Z0-9_]+$/;

export const setupSchema = z
  .object({
    shopName: z
      .string()
      .trim()
      .min(1, { error: "validations.required" })
      .max(120),
    name: z.string().trim().min(1, { error: "validations.required" }).max(100),
    login: z
      .string()
      .trim()
      .min(3, { error: "validations.username_min" })
      .max(254)
      .refine(
        (v) =>
          v.includes("@")
            ? z.email().safeParse(v).success
            : SETUP_USERNAME_PATTERN.test(v) && v.length <= 30,
        { error: "validations.setup_login_invalid" }
      ),
    password: passwordPolicy,
    confirmPassword: z.string().min(1, { error: "validations.required" }),
    // Instalador: instâncias alojadas de ponto nascem já em modo só ponto.
    // Omitido = repair_shop; clientes normais nem veem este campo na UI.
    shopMode: z.enum(["repair_shop", "ponto_only"]).optional(),
    token: z.string().max(256).optional(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    error: "validations.passwords_dont_match",
    path: ["confirmPassword"],
  });

export type SetupInput = z.infer<typeof setupSchema>;
export type SignInInput = z.infer<typeof signInSchema>;
export type CreateUserInput = z.infer<typeof createUserSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type ToggleUserStatusInput = z.infer<typeof toggleUserStatusSchema>;
export type UserListQueryInput = z.infer<typeof userListQuerySchema>;
export type ActivityListQueryInput = z.infer<typeof activityListQuerySchema>;
