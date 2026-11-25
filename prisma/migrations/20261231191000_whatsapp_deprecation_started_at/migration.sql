-- WP0.6 PR A follow-up — a data deixa de ser "primeiro aviso" e passa a
-- ser o arranque imutável da transição, gravado no primeiro boot da versão.

ALTER TABLE "shop_settings"
  RENAME COLUMN "whatsappLocalDeprecationWarnedAt" TO "whatsappLocalDeprecationStartedAt";

-- Qualquer valor herdado do campo WarnedAt pertence à semântica substituída
-- ("primeiro aviso"). O primeiro boot desta versão grava o arranque correto.
UPDATE "shop_settings" SET "whatsappLocalDeprecationStartedAt" = NULL;
