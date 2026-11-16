-- AI analyst sandbox — schema `analyst` com views allowlistadas + role
-- `analyst_ro` de menor privilégio.
--
-- Desenho: o assistente corre as queries SQL como session_user=analyst_ro
-- (ligação própria, ANALYST_DATABASE_URL) com search_path=analyst. Só o que
-- tem view neste schema é alcançável; tabelas novas ficam invisíveis por
-- omissão. Colunas listadas uma a uma — nunca SELECT * — para que uma
-- coluna sensível adicionada no futuro fique fora até revisão.
--
-- Não-fatal por desenho: se o utilizador que migra não tiver CREATEROLE,
-- o role/grants são saltados com NOTICE — o schema e as views ficam criados
-- e a ferramenta SQL fica desligada até provision-analyst.ts (ou um DBA)
-- completar o provisioning. Um upgrade nunca morre por causa disto.

CREATE SCHEMA IF NOT EXISTS analyst;

-- ── Views (coluna a coluna; PII e credenciais fora) ──────────────

DROP VIEW IF EXISTS analyst.jobs;
CREATE VIEW analyst.jobs AS SELECT
  "id", "jobCode", "externalRef", "customerId", "deviceId", "color",
  "reportedProblem", "conditionNotes", "accessories", "intakeChecklist",
  "intakeDocumentHash", "signedAt", "signedVia", "qcChecklist", "isUrgent",
  "status", "estimatedCost", "depositAmount", "hasLoanerDevice",
  "loanerNote", "estimatedDate", "createdAt", "updatedAt", "invoiceNumber",
  "invoicedAt", "actualLaborHours", "holdReason", "paymentOnDeliveryMethod",
  "lastOverdueAlertAt", "isWarrantyReturn", "portalPublishedAt",
  "warrantyForJobId", "createdById", "updatedById", "technicianId"
FROM public.jobs;
-- Fora (credencial/PII/artefactos): accessCode, deviceUnlockCode,
-- intakeSignatureDataUrl, imei, signedIp, signedUserAgent,
-- intakeTermsSnapshot, invoiceDocId, invoiceDocType, invoicePermalink.

DROP VIEW IF EXISTS analyst.customers;
CREATE VIEW analyst.customers AS SELECT
  "id", "name", "whatsappConsent", "createdAt"
FROM public.customers;
-- Fora: phone, email, taxId, whatsappConsentAt, lastRemarketingAt,
-- updatedAt. Análise por id; contactar cliente faz-se nos ecrãs próprios.

DROP VIEW IF EXISTS analyst.users;
CREATE VIEW analyst.users AS SELECT
  "id", "name", "role", "createdAt"
FROM public.users;
-- Fora: username, displayUsername, email, emailVerified, image, password,
-- isActive, mustChangePassword, failedLoginAttempts, lockedUntil, banned,
-- banReason, banExpires, updatedAt.

DROP VIEW IF EXISTS analyst.devices;
CREATE VIEW analyst.devices AS SELECT
  "id", "brandId", "model", "category", "createdAt", "updatedAt"
FROM public.devices;
-- Modelo não tem IMEI/série (o imei vive em jobs e ficou fora lá).

DROP VIEW IF EXISTS analyst.job_repairs;
CREATE VIEW analyst.job_repairs AS SELECT
  "id", "jobId", "repairId", "repairName", "category", "price",
  "createdById", "createdAt"
FROM public.job_repairs;

DROP VIEW IF EXISTS analyst.job_parts;
CREATE VIEW analyst.job_parts AS SELECT
  "id", "jobId", "partId", "partName", "category", "unitPrice", "quantity",
  "supplier", "totalCost", "createdById", "createdAt"
FROM public.job_parts;

DROP VIEW IF EXISTS analyst.job_notes;
CREATE VIEW analyst.job_notes AS SELECT
  "id", "jobId", "content", "isCustomerVisible", "createdById", "createdAt"
FROM public.job_notes;
-- content é texto livre e pode conter contactos — exposto porque os
-- perfis com ai:access já o lêem no UI; a ferramenta não alarga privilégio.

DROP VIEW IF EXISTS analyst.job_photos;
CREATE VIEW analyst.job_photos AS SELECT
  "id", "jobId", "createdAt"
FROM public.job_photos;
-- Fora: path (URL de ficheiro), stage, returnClaimId — nunca conteúdo.

DROP VIEW IF EXISTS analyst.job_parts_waiting;
CREATE VIEW analyst.job_parts_waiting AS SELECT
  "id", "jobId", "partName", "supplier", "createdAt"
FROM public.job_parts_waiting;

DROP VIEW IF EXISTS analyst.repair_catalog;
CREATE VIEW analyst.repair_catalog AS SELECT
  "id", "name", "category", "defaultPrice", "isActive", "warrantyDays",
  "createdAt", "updatedAt"
FROM public.repair_catalog;

DROP VIEW IF EXISTS analyst.parts_catalog;
CREATE VIEW analyst.parts_catalog AS SELECT
  "id", "name", "category", "defaultPrice", "supplier", "stockQuantity",
  "reorderLevel", "isActive", "listedOnline", "lastLowStockAlertAt",
  "createdAt", "updatedAt"
FROM public.parts_catalog;
-- Fora: supplierId (FK para tabela fora do sandbox).

-- ── Role + grants (idempotente, nunca fatal) ─────────────────────

DO $analyst$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'analyst_ro') THEN
    BEGIN
      CREATE ROLE analyst_ro NOLOGIN;
      RAISE NOTICE 'analyst_ro: role criado — corre server/scripts/provision-analyst.ts para lhe dar LOGIN/password e gerar ANALYST_DATABASE_URL';
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'analyst_ro: sem privilégio para criar o role (%) — schema e views ficam criados; a ferramenta SQL fica desligada até provisioning', SQLERRM;
    END;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'analyst_ro') THEN
    BEGIN
      EXECUTE 'GRANT USAGE ON SCHEMA analyst TO analyst_ro';
      EXECUTE 'GRANT SELECT ON ALL TABLES IN SCHEMA analyst TO analyst_ro';
      -- Cobre views criadas por migrações futuras com o mesmo owner.
      EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA analyst GRANT SELECT ON TABLES TO analyst_ro';
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'analyst_ro: grants falharam (%) — provisiona manualmente', SQLERRM;
    END;
  END IF;
END
$analyst$;
