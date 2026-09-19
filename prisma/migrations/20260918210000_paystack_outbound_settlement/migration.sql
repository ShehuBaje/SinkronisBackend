ALTER TABLE `PaymentRequest` ADD COLUMN IF NOT EXISTS `bankCode` VARCHAR(191) NULL;

CREATE TABLE IF NOT EXISTS `ProviderTransferRecipient` (
  `id` VARCHAR(191) NOT NULL,
  `organizationId` VARCHAR(191) NOT NULL,
  `provider` VARCHAR(32) NOT NULL,
  `beneficiaryType` VARCHAR(64) NOT NULL,
  `beneficiaryId` VARCHAR(191) NOT NULL,
  `currency` VARCHAR(3) NOT NULL,
  `bankCode` VARCHAR(20) NOT NULL,
  `accountFingerprint` VARCHAR(64) NOT NULL,
  `accountLast4` VARCHAR(4) NOT NULL,
  `resolvedAccountName` VARCHAR(200) NOT NULL,
  `providerRecipientCode` VARCHAR(191) NOT NULL,
  `providerRecipientId` VARCHAR(191) NULL,
  `active` BOOLEAN NOT NULL DEFAULT true,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `ProviderTransferRecipient_provider_code_key` (`provider`, `providerRecipientCode`),
  UNIQUE INDEX `ProviderTransferRecipient_identity_key` (`organizationId`, `provider`, `beneficiaryType`, `beneficiaryId`, `currency`, `bankCode`, `accountFingerprint`),
  INDEX `ProviderTransferRecipient_beneficiary_idx` (`organizationId`, `beneficiaryType`, `beneficiaryId`, `active`),
  CONSTRAINT `ProviderTransferRecipient_org_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ProviderWebhookEvent` (
  `id` VARCHAR(191) NOT NULL,
  `provider` VARCHAR(32) NOT NULL,
  `eventFingerprint` VARCHAR(64) NOT NULL,
  `eventType` VARCHAR(64) NOT NULL,
  `providerReference` VARCHAR(191) NULL,
  `payload` JSON NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'RECEIVED',
  `attempts` INTEGER NOT NULL DEFAULT 0,
  `failureReason` TEXT NULL,
  `receivedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `processedAt` DATETIME(3) NULL,
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `ProviderWebhookEvent_provider_fingerprint_key` (`provider`, `eventFingerprint`),
  INDEX `ProviderWebhookEvent_provider_status_idx` (`provider`, `status`, `receivedAt`),
  INDEX `ProviderWebhookEvent_provider_reference_idx` (`provider`, `providerReference`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `FinancialSettlement`
  ADD COLUMN IF NOT EXISTS `providerRecipientId` VARCHAR(191) NULL,
  ADD COLUMN IF NOT EXISTS `providerTransferCode` VARCHAR(191) NULL,
  ADD COLUMN IF NOT EXISTS `providerStatus` VARCHAR(32) NULL,
  ADD COLUMN IF NOT EXISTS `initiationClaimedAt` DATETIME(3) NULL,
  ADD COLUMN IF NOT EXISTS `lastVerifiedAt` DATETIME(3) NULL;

CREATE INDEX IF NOT EXISTS `FinancialSettlement_provider_recipient_idx` ON `FinancialSettlement` (`providerRecipientId`);

ALTER TABLE `FinancialSettlement`
  ADD CONSTRAINT `FinancialSettlement_provider_recipient_fkey` FOREIGN KEY (`providerRecipientId`) REFERENCES `ProviderTransferRecipient` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;
