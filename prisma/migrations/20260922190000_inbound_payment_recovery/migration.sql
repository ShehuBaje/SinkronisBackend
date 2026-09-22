-- Additive inbound-payment recovery leases. Historical non-terminal attempts
-- are conservatively treated as possibly submitted to Paystack.
ALTER TABLE `SubscriptionPaymentAttempt`
    ADD COLUMN `providerInitiationAttemptedAt` DATETIME(3) NULL,
    ADD COLUMN `reconciliationClaimToken` VARCHAR(64) NULL,
    ADD COLUMN `reconciliationClaimedAt` DATETIME(3) NULL,
    ADD COLUMN `reconciliationLeaseExpiresAt` DATETIME(3) NULL,
    ADD COLUMN `reconciliationAttempts` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `nextReconciliationAt` DATETIME(3) NULL,
    ADD COLUMN `reconciliationDeadLetteredAt` DATETIME(3) NULL,
    ADD COLUMN `lastReconciliationError` TEXT NULL;

UPDATE `SubscriptionPaymentAttempt`
SET `providerInitiationAttemptedAt` = `updatedAt`
WHERE `status` IN ('INITIALIZING', 'INITIALIZED', 'UNKNOWN', 'VERIFIED');

CREATE INDEX `SubscriptionPaymentAttempt_recovery_idx`
ON `SubscriptionPaymentAttempt`(`provider`, `status`, `nextReconciliationAt`, `reconciliationLeaseExpiresAt`);

ALTER TABLE `WalletFundingAttempt`
    ADD COLUMN `idempotencyKey` VARCHAR(191) NULL,
    ADD COLUMN `providerInitiationAttemptedAt` DATETIME(3) NULL,
    ADD COLUMN `reconciliationClaimToken` VARCHAR(64) NULL,
    ADD COLUMN `reconciliationClaimedAt` DATETIME(3) NULL,
    ADD COLUMN `reconciliationLeaseExpiresAt` DATETIME(3) NULL,
    ADD COLUMN `reconciliationAttempts` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `nextReconciliationAt` DATETIME(3) NULL,
    ADD COLUMN `reconciliationDeadLetteredAt` DATETIME(3) NULL,
    ADD COLUMN `lastReconciliationError` TEXT NULL;

UPDATE `WalletFundingAttempt`
SET `providerInitiationAttemptedAt` = `updatedAt`
WHERE `status` IN ('PENDING', 'INITIALIZING', 'INITIALIZED', 'UNKNOWN', 'PROCESSING');

CREATE INDEX `WalletFundingAttempt_recovery_idx`
ON `WalletFundingAttempt`(`provider`, `status`, `nextReconciliationAt`, `reconciliationLeaseExpiresAt`);

CREATE UNIQUE INDEX `WalletFundingAttempt_org_idempotency_key`
ON `WalletFundingAttempt`(`organizationId`, `idempotencyKey`);

ALTER TABLE `FinancialReconciliationRun`
    ADD COLUMN `subscriptionAttemptsScanned` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `subscriptionAttemptsClaimed` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `subscriptionAttemptsReconciled` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `subscriptionAttemptsUnresolved` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `walletFundingAttemptsScanned` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `walletFundingAttemptsClaimed` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `walletFundingAttemptsReconciled` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `walletFundingAttemptsUnresolved` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `inboundWebhookEventsProcessed` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `inboundWebhookEventsDeadLettered` INTEGER NOT NULL DEFAULT 0;
