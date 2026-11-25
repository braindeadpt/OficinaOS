-- WP0.6 PR A follow-up — a data deixa de ser "primeiro aviso" e passa a
-- ser o arranque imutável da transição, gravado no primeiro boot da versão.

ALTER TABLE "shop_settings"
  RENAME COLUMN "whatsappLocalDeprecationWarnedAt" TO "whatsappLocalDeprecationStartedAt";
