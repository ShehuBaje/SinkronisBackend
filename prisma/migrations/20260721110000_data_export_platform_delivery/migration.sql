ALTER TABLE `OrganizationDataExport`
  ADD COLUMN `deliveryEmail` VARCHAR(191) NULL,
  ADD COLUMN `deliveryDueAt` DATETIME(3) NULL,
  ADD COLUMN `deliveredAt` DATETIME(3) NULL,
  ALTER COLUMN `status` SET DEFAULT 'PENDING_PLATFORM_FULFILLMENT';

UPDATE `OrganizationDataExport` export_record
INNER JOIN `User` requester ON requester.`id` = export_record.`requestedByUserId`
SET export_record.`deliveryEmail` = requester.`email`,
    export_record.`deliveryDueAt` = DATE_ADD(export_record.`requestedAt`, INTERVAL 24 HOUR)
WHERE export_record.`deliveryEmail` IS NULL OR export_record.`deliveryDueAt` IS NULL;

ALTER TABLE `OrganizationDataExport`
  MODIFY `deliveryEmail` VARCHAR(191) NOT NULL,
  MODIFY `deliveryDueAt` DATETIME(3) NOT NULL;

CREATE INDEX `OrgDataExport_delivery_due_idx` ON `OrganizationDataExport`(`status`, `deliveryDueAt`);
