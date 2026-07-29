CREATE TABLE `BillingNotification` (
  `id` VARCHAR(191) NOT NULL,
  `organizationId` VARCHAR(191) NOT NULL,
  `type` VARCHAR(191) NOT NULL,
  `renewalDate` DATETIME(3) NOT NULL,
  `scheduledFor` DATETIME(3) NOT NULL,
  `channels` JSON NOT NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
  `attempts` INTEGER NOT NULL DEFAULT 0,
  `lastAttemptAt` DATETIME(3) NULL,
  `sentAt` DATETIME(3) NULL,
  `failedAt` DATETIME(3) NULL,
  `errorMessage` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `BillingNotification_organizationId_type_renewalDate_key`(`organizationId`, `type`, `renewalDate`),
  INDEX `BillingNotification_status_scheduledFor_idx`(`status`, `scheduledFor`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `SubscriptionPlanChange` (
  `id` VARCHAR(191) NOT NULL,
  `organizationId` VARCHAR(191) NOT NULL,
  `fromPlanKey` VARCHAR(191) NOT NULL,
  `toPlanKey` VARCHAR(191) NOT NULL,
  `billingCycle` VARCHAR(191) NOT NULL,
  `currentMonthlyCost` DECIMAL(14,2) NOT NULL,
  `selectedMonthlyCost` DECIMAL(14,2) NOT NULL,
  `billingImpact` DECIMAL(14,2) NOT NULL,
  `proratedCharge` DECIMAL(14,2) NOT NULL DEFAULT 0,
  `currency` VARCHAR(191) NOT NULL DEFAULT 'NGN',
  `effectiveAt` DATETIME(3) NOT NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
  `paymentReference` VARCHAR(191) NULL,
  `automaticRenewal` BOOLEAN NOT NULL DEFAULT true,
  `confirmedByUserId` VARCHAR(191) NULL,
  `confirmedAt` DATETIME(3) NULL,
  `appliedAt` DATETIME(3) NULL,
  `cancelledAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  INDEX `SubscriptionPlanChange_organizationId_status_effectiveAt_idx`(`organizationId`, `status`, `effectiveAt`),
  INDEX `SubscriptionPlanChange_status_effectiveAt_idx`(`status`, `effectiveAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `BillingNotification` ADD CONSTRAINT `BillingNotification_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `SubscriptionPlanChange` ADD CONSTRAINT `SubscriptionPlanChange_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
