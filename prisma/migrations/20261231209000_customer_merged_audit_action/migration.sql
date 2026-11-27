-- Aditivo: novo valor de enum para a auditoria de junção de clientes
-- duplicados (issue #77). Não altera dados existentes.
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CUSTOMER_MERGED';
