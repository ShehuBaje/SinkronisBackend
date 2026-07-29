ALTER TABLE `Organization`
  ADD COLUMN `suspendedAt` DATETIME(3) NULL,
  ADD COLUMN `suspensionReason` TEXT NULL,
  ADD COLUMN `suspendedByUserId` VARCHAR(191) NULL;

CREATE INDEX `Organization_status_createdAt_idx`
  ON `Organization`(`status`, `createdAt`);

CREATE INDEX `UserSession_organizationId_revokedAt_idx`
  ON `UserSession`(`organizationId`, `revokedAt`);
