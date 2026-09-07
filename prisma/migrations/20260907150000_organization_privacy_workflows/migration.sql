ALTER TABLE `OrganizationDataExport`
  ADD COLUMN `processingStartedAt` DATETIME(3) NULL,
  ADD COLUMN `expiresAt` DATETIME(3) NULL;

CREATE INDEX `OrgDataExport_expiry_idx` ON `OrganizationDataExport`(`status`, `expiresAt`);

ALTER TABLE `OrganizationDeletionRequest`
  ADD COLUMN `reviewNotes` TEXT NULL,
  ADD COLUMN `scheduledFor` DATETIME(3) NULL,
  ADD COLUMN `processingStartedAt` DATETIME(3) NULL,
  ADD COLUMN `failureReason` TEXT NULL;

CREATE INDEX `OrgDeletionRequest_schedule_idx` ON `OrganizationDeletionRequest`(`status`, `scheduledFor`);
