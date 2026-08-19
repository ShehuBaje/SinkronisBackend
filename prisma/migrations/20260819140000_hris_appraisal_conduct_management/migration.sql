ALTER TABLE `AppraisalTemplate`
  ADD COLUMN `isDefault` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `version` INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN `archivedAt` DATETIME(3) NULL;

CREATE INDEX `AppraisalTemplate_org_default_archived_idx`
  ON `AppraisalTemplate`(`organizationId`, `isDefault`, `archivedAt`);

ALTER TABLE `AppraisalCycle`
  ADD COLUMN `description` TEXT NULL,
  ADD COLUMN `templateSnapshot` JSON NULL,
  ADD COLUMN `launchedAt` DATETIME(3) NULL,
  ADD COLUMN `launchedById` VARCHAR(191) NULL;

ALTER TABLE `EmployeeAppraisal`
  ADD COLUMN `ratingValue` INTEGER NULL,
  ADD COLUMN `templateSnapshot` JSON NULL;

UPDATE `AppraisalCycle` c
JOIN `AppraisalTemplate` t ON t.`id` = c.`templateId`
SET c.`templateSnapshot` = t.`configuration`
WHERE c.`templateSnapshot` IS NULL;

UPDATE `EmployeeAppraisal` a
JOIN `AppraisalTemplate` t ON t.`id` = a.`templateId`
SET a.`templateSnapshot` = t.`configuration`
WHERE a.`templateSnapshot` IS NULL;

CREATE TABLE `AppraisalSignOff` (
  `id` VARCHAR(191) NOT NULL,
  `organizationId` VARCHAR(191) NOT NULL,
  `appraisalId` VARCHAR(191) NOT NULL,
  `signatoryUserId` VARCHAR(191) NOT NULL,
  `signOffType` VARCHAR(191) NOT NULL,
  `signatoryRole` VARCHAR(191) NOT NULL,
  `signedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `AppraisalSignOff_appraisal_type_key`(`appraisalId`, `signOffType`),
  INDEX `AppraisalSignOff_org_signed_idx`(`organizationId`, `signedAt`),
  INDEX `AppraisalSignOff_signatory_idx`(`signatoryUserId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `AppraisalSetting` (
  `id` VARCHAR(191) NOT NULL,
  `organizationId` VARCHAR(191) NOT NULL,
  `defaultReviewFrequency` VARCHAR(191) NOT NULL DEFAULT 'QUARTERLY',
  `updatedById` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `AppraisalSetting_organizationId_key`(`organizationId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `AppraisalSignOff`
  ADD CONSTRAINT `AppraisalSignOff_appraisalId_fkey` FOREIGN KEY (`appraisalId`) REFERENCES `EmployeeAppraisal`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `AppraisalSignOff_signatoryUserId_fkey` FOREIGN KEY (`signatoryUserId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `AppraisalSetting`
  ADD CONSTRAINT `AppraisalSetting_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `ConductLog`
  ADD COLUMN `type` VARCHAR(191) NOT NULL DEFAULT 'QUERY',
  ADD COLUMN `status` VARCHAR(191) NOT NULL DEFAULT 'IN_PROGRESS',
  ADD COLUMN `notes` TEXT NULL,
  ADD COLUMN `durationValue` INTEGER NULL,
  ADD COLUMN `durationUnit` VARCHAR(191) NULL,
  ADD COLUMN `startDate` DATETIME(3) NULL,
  ADD COLUMN `endDate` DATETIME(3) NULL,
  ADD COLUMN `previousEmployeeStatus` ENUM('ACTIVE', 'ON_LEAVE', 'SUSPENDED', 'TERMINATED') NULL,
  ADD COLUMN `createdById` VARCHAR(191) NULL,
  ADD COLUMN `resolvedById` VARCHAR(191) NULL,
  ADD COLUMN `resolvedAt` DATETIME(3) NULL;

CREATE INDEX `ConductLog_org_type_status_idx`
  ON `ConductLog`(`organizationId`, `type`, `status`);

CREATE INDEX `ConductLog_org_created_idx`
  ON `ConductLog`(`organizationId`, `createdAt`);

UPDATE `ConductLog`
SET `notes` = COALESCE(`details`, `summary`)
WHERE `notes` IS NULL;
