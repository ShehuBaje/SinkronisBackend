ALTER TABLE `AuditLog`
  ADD COLUMN `previousHash` CHAR(64) NULL,
  ADD COLUMN `hash` CHAR(64) NULL;

CREATE INDEX `AuditLog_organizationId_hash_idx` ON `AuditLog`(`organizationId`, `hash`);
