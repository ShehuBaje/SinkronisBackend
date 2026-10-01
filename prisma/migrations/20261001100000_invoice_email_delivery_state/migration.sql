ALTER TABLE `Invoice`
  ADD COLUMN `emailDeliveryStatus` ENUM('NOT_STARTED', 'SENDING', 'SENT', 'FAILED', 'UNKNOWN') NOT NULL DEFAULT 'NOT_STARTED',
  ADD COLUMN `emailDeliveryAttemptedAt` DATETIME(3) NULL,
  ADD COLUMN `emailDeliveredAt` DATETIME(3) NULL,
  ADD COLUMN `emailDeliveryProvider` VARCHAR(191) NULL,
  ADD COLUMN `emailProviderMessageId` VARCHAR(191) NULL,
  ADD COLUMN `emailDeliveryErrorCode` VARCHAR(191) NULL,
  ADD COLUMN `emailDeliveryErrorMessage` VARCHAR(500) NULL;

UPDATE `Invoice`
SET `emailDeliveryStatus` = 'SENT'
WHERE `status` IN ('SENT', 'PARTIALLY_PAID', 'PAID', 'OVERDUE');

UPDATE `Invoice` AS `invoice`
SET `invoice`.`emailDeliveryStatus` = 'SENT'
WHERE `invoice`.`status` = 'VOID'
  AND (`invoice`.`sentAt` IS NOT NULL OR EXISTS (
    SELECT 1 FROM `AccountingInvoiceStatusHistory` AS `history`
    WHERE `history`.`invoiceId` = `invoice`.`id`
      AND `history`.`organizationId` = `invoice`.`organizationId`
      AND `history`.`status` IN ('SENT', 'PARTIALLY_PAID', 'PAID', 'OVERDUE')
  ));

CREATE INDEX `Invoice_org_email_delivery_idx`
  ON `Invoice`(`organizationId`, `emailDeliveryStatus`, `updatedAt`);
