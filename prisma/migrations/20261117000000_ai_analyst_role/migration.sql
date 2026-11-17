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
-- O role deriva da BD (analyst_ro_<db>_<hash8>): roles são globais ao
-- cluster, e um role com LOGIN partilhado por duas BDs ligar-se-ia a
-- ambas — CONNECT vem de PUBLIC por defeito. O sufixo md5 do nome exato
-- separa BDs cujo nome sanitizado colide (loja-a vs loja_a). Tem de
-- bater certo com analystRoleName em server/ai/analyst-provision.ts.

DO $analyst$
DECLARE
  role_name text := 'analyst_ro_' || left(regexp_replace(lower(current_database()), '[^a-z0-9_]', '_', 'g'), 43) || '_' || left(md5(current_database()), 8);
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
    BEGIN
      EXECUTE format('CREATE ROLE %I NOLOGIN', role_name);
      RAISE NOTICE '%: role criado — o provisioning no arranque dá-lhe LOGIN/password', role_name;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE '%: sem privilégio para criar o role (%) — schema e views ficam criados; a ferramenta SQL fica desligada até provisioning', role_name, SQLERRM;
    END;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
    BEGIN
      EXECUTE format('GRANT USAGE ON SCHEMA analyst TO %I', role_name);
      EXECUTE format('GRANT SELECT ON ALL TABLES IN SCHEMA analyst TO %I', role_name);
      -- Cobre views criadas por migrações futuras com o mesmo owner.
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA analyst GRANT SELECT ON TABLES TO %I', role_name);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE '%: grants falharam (%) — provisiona manualmente', role_name, SQLERRM;
    END;
  END IF;
END
$analyst$;
