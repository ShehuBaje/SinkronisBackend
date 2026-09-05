ALTER TABLE `AgentInvitation`
  ADD COLUMN `deliveryStatus` ENUM('PENDING', 'SENT', 'FAILED') NOT NULL DEFAULT 'PENDING',
  ADD COLUMN `deliveryAttemptedAt` DATETIME(3) NULL,
  ADD COLUMN `deliveredAt` DATETIME(3) NULL,
  ADD COLUMN `deliveryProvider` VARCHAR(191) NULL,
  ADD COLUMN `providerMessageId` VARCHAR(191) NULL,
  ADD COLUMN `deliveryErrorCode` VARCHAR(191) NULL,
  ADD COLUMN `deliveryErrorMessage` VARCHAR(500) NULL;

CREATE INDEX `AgentInvitation_org_delivery_idx` ON `AgentInvitation`(`organizationId`, `deliveryStatus`, `createdAt`);
