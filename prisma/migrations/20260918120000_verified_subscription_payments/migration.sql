CREATE TABLE IF NOT EXISTS `SubscriptionPaymentAttempt` (
  `id` VARCHAR(191) NOT NULL,
  `organizationId` VARCHAR(191) NOT NULL,
  `operationType` VARCHAR(32) NOT NULL,
  `planKey` VARCHAR(64) NOT NULL,
  `fromPlanKey` VARCHAR(64) NULL,
  `billingCycle` VARCHAR(16) NOT NULL,
  `amount` DECIMAL(14, 2) NOT NULL,
  `currency` VARCHAR(8) NOT NULL DEFAULT 'NGN',
  `provider` VARCHAR(32) NOT NULL DEFAULT 'PAYSTACK',
  `reference` VARCHAR(191) NOT NULL,
  `idempotencyKey` VARCHAR(191) NOT NULL,
  `activeKey` VARCHAR(191) NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'CREATED',
  `authorizationUrl` TEXT NULL,
  `accessCode` VARCHAR(191) NULL,
  `providerReference` VARCHAR(191) NULL,
  `providerPayload` JSON NULL,
  `automaticRenewal` BOOLEAN NOT NULL DEFAULT true,
  `effectiveAt` DATETIME(3) NULL,
  `failureReason` TEXT NULL,
  `verifiedAt` DATETIME(3) NULL,
  `completedAt` DATETIME(3) NULL,
  `createdByUserId` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `SubscriptionPaymentAttempt_reference_key`(`reference`),
  UNIQUE INDEX `SubscriptionPaymentAttempt_activeKey_key`(`activeKey`),
  UNIQUE INDEX `SubscriptionPaymentAttempt_org_idempotency_key`(`organizationId`, `idempotencyKey`),
  INDEX `SubscriptionPaymentAttempt_org_status_created_idx`(`organizationId`, `status`, `createdAt`),
  PRIMARY KEY (`id`),
  CONSTRAINT `SubscriptionPaymentAttempt_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `BillingHistory`
  ADD COLUMN `subscriptionPaymentAttemptId` VARCHAR(191) NULL;
CREATE UNIQUE INDEX `BillingHistory_subscriptionPaymentAttemptId_key` ON `BillingHistory`(`subscriptionPaymentAttemptId`);
ALTER TABLE `BillingHistory`
  ADD CONSTRAINT `BillingHistory_subscriptionPaymentAttemptId_fkey` FOREIGN KEY (`subscriptionPaymentAttemptId`) REFERENCES `SubscriptionPaymentAttempt`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `SubscriptionPlanChange`
  ADD COLUMN `subscriptionPaymentAttemptId` VARCHAR(191) NULL;
ALTER TABLE `SubscriptionPlanChange`
  ADD COLUMN `paymentAuthorized` BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE `SubscriptionPlanChange`
  ADD COLUMN `pendingKey` VARCHAR(191) NULL;
CREATE UNIQUE INDEX `SubscriptionPlanChange_paymentAttemptId_key` ON `SubscriptionPlanChange`(`subscriptionPaymentAttemptId`);
CREATE UNIQUE INDEX `SubscriptionPlanChange_pendingKey_key` ON `SubscriptionPlanChange`(`pendingKey`);
ALTER TABLE `SubscriptionPlanChange`
  ADD CONSTRAINT `SubscriptionPlanChange_paymentAttemptId_fkey` FOREIGN KEY (`subscriptionPaymentAttemptId`) REFERENCES `SubscriptionPaymentAttempt`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- Existing scheduled changes predate provider-backed verification. They remain
-- preserved for audit/history but are deliberately not marked payment-authorized.
