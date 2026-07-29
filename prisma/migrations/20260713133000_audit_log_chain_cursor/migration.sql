ALTER TABLE `AuditLog`
  ADD COLUMN `sequence` INTEGER NULL;

CREATE UNIQUE INDEX `AuditLog_organizationId_sequence_key` ON `AuditLog`(`organizationId`, `sequence`);

CREATE TABLE `AuditLogChain` (
  `organizationId` VARCHAR(191) NOT NULL,
  `lastHash` CHAR(64) NULL,
  `sequence` INTEGER NOT NULL DEFAULT 0,
  `updatedAt` DATETIME(3) NOT NULL,

  PRIMARY KEY (`organizationId`),
  CONSTRAINT `AuditLogChain_organizationId_fkey`
    FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
