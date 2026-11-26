import { z } from "zod";

// Schemas do painel "Livro de Ponto" — consumidos por
// server/routes/ponto.ts. from/to são datas civis da loja (YYYY-MM-DD),
// não instantes: o dia é o do fuso das definições da loja.

const isoDate = z.iso.date();
const isoDateTime = z.iso.datetime({ offset: true });

const ENTRY_TYPES = ["ENTRADA", "PAUSA", "VOLTEI", "SAIDA"] as const;
// O filtro é pelo status EFETIVO — o mesmo conjunto que listEntries
// devolve (validação mais recente pode ter recusado a picagem).
const STATUSES = ["APROVADO", "POR_VALIDAR", "RECUSADO"] as const;
const DECISIONS = ["APROVADO", "RECUSADO"] as const;

export const pontoEntriesQuerySchema = z.object({
  from: isoDate.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
  status: z.enum(STATUSES).optional(),
  to: isoDate.optional(),
  userId: z.string().optional(),
});

export const pontoHoursQuerySchema = z.object({
  from: isoDate,
  to: isoDate,
  userId: z.string().optional(),
});

export const pontoActExportQuerySchema = z.object({
  from: isoDate,
  to: isoDate,
  userId: z.string().optional(),
});

export const pontoMissingExitsQuerySchema = z.object({
  from: isoDate,
  to: isoDate,
});

export const pontoValidateSchema = z.object({
  decision: z.enum(DECISIONS),
  note: z.string().trim().max(500).optional(),
});

export const pontoManualEntrySchema = z
  .object({
    at: isoDateTime,
    correctsId: z.string().min(1).optional(),
    reason: z.string().trim().max(500).optional(),
    type: z.enum(ENTRY_TYPES),
    userId: z.string().min(1),
  })
  .refine((v) => new Date(v.at).getTime() <= Date.now(), {
    error: "validations.ponto_at_future",
    path: ["at"],
  });

export const pontoEntryIdParamSchema = z.object({
  id: z.string().min(1),
});

export type PontoEntriesQueryInput = z.infer<typeof pontoEntriesQuerySchema>;
export type PontoHoursQueryInput = z.infer<typeof pontoHoursQuerySchema>;
export type PontoActExportQueryInput = z.infer<
  typeof pontoActExportQuerySchema
>;
export type PontoMissingExitsQueryInput = z.infer<
  typeof pontoMissingExitsQuerySchema
>;
export type PontoValidateInput = z.infer<typeof pontoValidateSchema>;
export type PontoManualEntryInput = z.infer<typeof pontoManualEntrySchema>;
export type PontoEntryIdParamInput = z.infer<typeof pontoEntryIdParamSchema>;
