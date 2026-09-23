CREATE TABLE `FinancialIntegrityScanRun` (
  `id` VARCHAR(191) NOT NULL, `trigger` VARCHAR(32) NOT NULL, `scannerVersion` VARCHAR(32) NOT NULL,
  `status` VARCHAR(24) NOT NULL DEFAULT 'RUNNING', `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `completedAt` DATETIME(3) NULL, `objectsScanned` INTEGER NOT NULL DEFAULT 0, `findingsDetected` INTEGER NOT NULL DEFAULT 0,
  `newFindings` INTEGER NOT NULL DEFAULT 0, `existingFindings` INTEGER NOT NULL DEFAULT 0, `resolvedFindings` INTEGER NOT NULL DEFAULT 0,
  `errors` INTEGER NOT NULL DEFAULT 0, `failureReason` TEXT NULL, `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL, PRIMARY KEY (`id`), INDEX `FinancialIntegrityScanRun_status_started_idx` (`status`, `startedAt`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `FinancialIntegrityFinding` (
  `id` VARCHAR(191) NOT NULL, `organizationId` VARCHAR(191) NULL, `category` VARCHAR(80) NOT NULL, `severity` VARCHAR(16) NOT NULL,
  `status` VARCHAR(16) NOT NULL DEFAULT 'OPEN', `resourceType` VARCHAR(64) NOT NULL, `resourceId` VARCHAR(191) NOT NULL,
  `walletAccountId` VARCHAR(191) NULL, `settlementId` VARCHAR(191) NULL, `provider` VARCHAR(32) NULL,
  `providerReferenceFingerprint` VARCHAR(64) NULL, `currency` VARCHAR(3) NULL, `expectedAmount` DECIMAL(14,2) NULL,
  `actualAmount` DECIMAL(14,2) NULL, `differenceAmount` DECIMAL(14,2) NULL, `evidenceFingerprint` VARCHAR(64) NOT NULL,
  `deduplicationKey` VARCHAR(64) NOT NULL, `details` JSON NULL, `firstDetectedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `lastDetectedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `resolvedAt` DATETIME(3) NULL, `occurrenceCount` INTEGER NOT NULL DEFAULT 1,
  `firstScanRunId` VARCHAR(191) NOT NULL, `lastScanRunId` VARCHAR(191) NOT NULL, `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL, PRIMARY KEY (`id`), UNIQUE INDEX `FinancialIntegrityFinding_dedup_key` (`deduplicationKey`),
  INDEX `FinancialIntegrityFinding_status_severity_idx` (`status`, `severity`, `lastDetectedAt`),
  INDEX `FinancialIntegrityFinding_org_status_category_idx` (`organizationId`, `status`, `category`),
  INDEX `FinancialIntegrityFinding_wallet_status_idx` (`walletAccountId`, `status`), INDEX `FinancialIntegrityFinding_last_run_idx` (`lastScanRunId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
