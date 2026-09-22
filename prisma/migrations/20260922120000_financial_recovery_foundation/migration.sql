-- Additive, nullable leases preserve compatibility with the currently deployed application.
ALTER TABLE `FinancialSettlement`
    ADD COLUMN `providerInitiationAttemptedAt` DATETIME(3) NULL,
    ADD COLUMN `reconciliationClaimToken` VARCHAR(64) NULL,
    ADD COLUMN `reconciliationClaimedAt` DATETIME(3) NULL,
    ADD COLUMN `reconciliationLeaseExpiresAt` DATETIME(3) NULL,
    ADD COLUMN `reconciliationAttempts` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `lastReconciliationError` TEXT NULL;

-- Existing claimed provider settlements are treated conservatively as having
-- possibly reached Paystack. Recovery must verify their original reference and
-- must never infer that a historical 404 makes a fresh initiation safe.
UPDATE `FinancialSettlement`
SET `providerInitiationAttemptedAt` = `initiationClaimedAt`
WHERE `initiationClaimedAt` IS NOT NULL;

CREATE INDEX `FinancialSettlement_reconciliation_idx`
ON `FinancialSettlement`(`provider`, `status`, `providerProcessingAt`, `reconciliationLeaseExpiresAt`);

ALTER TABLE `ProviderWebhookEvent`
    ADD COLUMN `deferredAttempts` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `processingClaimToken` VARCHAR(64) NULL,
    ADD COLUMN `processingClaimedAt` DATETIME(3) NULL,
    ADD COLUMN `processingLeaseExpiresAt` DATETIME(3) NULL,
    ADD COLUMN `nextAttemptAt` DATETIME(3) NULL,
    ADD COLUMN `deadLetteredAt` DATETIME(3) NULL;

CREATE INDEX `ProviderWebhookEvent_recovery_idx`
ON `ProviderWebhookEvent`(`provider`, `status`, `nextAttemptAt`, `processingLeaseExpiresAt`);

CREATE TABLE `FinancialReconciliationRun` (
    `id` VARCHAR(191) NOT NULL,
    `trigger` VARCHAR(32) NOT NULL,
    `status` VARCHAR(24) NOT NULL DEFAULT 'RUNNING',
    `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `heartbeatAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `completedAt` DATETIME(3) NULL,
    `settlementsScanned` INTEGER NOT NULL DEFAULT 0,
    `settlementsClaimed` INTEGER NOT NULL DEFAULT 0,
    `settlementsReconciled` INTEGER NOT NULL DEFAULT 0,
    `settlementsUnresolved` INTEGER NOT NULL DEFAULT 0,
    `webhookEventsScanned` INTEGER NOT NULL DEFAULT 0,
    `webhookEventsClaimed` INTEGER NOT NULL DEFAULT 0,
    `webhookEventsProcessed` INTEGER NOT NULL DEFAULT 0,
    `webhookEventsDeadLettered` INTEGER NOT NULL DEFAULT 0,
    `errors` INTEGER NOT NULL DEFAULT 0,
    `applicationVersion` VARCHAR(191) NULL,
    `failureReason` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `FinancialReconciliationRun_status_started_idx`(`status`, `startedAt`),
    INDEX `FinancialReconciliationRun_completed_idx`(`completedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
