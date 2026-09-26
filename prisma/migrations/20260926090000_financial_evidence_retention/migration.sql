-- Preserve durable financial and audit evidence when a parent organization or
-- wallet is targeted for hard deletion. The supported organization-deletion
-- workflow archives tenants; it does not erase these records.
ALTER TABLE `AuditLog` DROP FOREIGN KEY `AuditLog_organizationId_fkey`;
ALTER TABLE `AuditLog` ADD CONSTRAINT `AuditLog_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `AuditLogChain` DROP FOREIGN KEY `AuditLogChain_organizationId_fkey`;
ALTER TABLE `AuditLogChain` ADD CONSTRAINT `AuditLogChain_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `BillingHistory` DROP FOREIGN KEY `BillingHistory_organizationId_fkey`;
ALTER TABLE `BillingHistory` ADD CONSTRAINT `BillingHistory_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `SubscriptionPaymentAttempt` DROP FOREIGN KEY `SubscriptionPaymentAttempt_organizationId_fkey`;
ALTER TABLE `SubscriptionPaymentAttempt` ADD CONSTRAINT `SubscriptionPaymentAttempt_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `WalletAccount` DROP FOREIGN KEY `WalletAccount_organizationId_fkey`;
ALTER TABLE `WalletAccount` ADD CONSTRAINT `WalletAccount_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `WalletFundingAttempt` DROP FOREIGN KEY `WalletFundingAttempt_org_fkey`;
ALTER TABLE `WalletFundingAttempt` ADD CONSTRAINT `WalletFundingAttempt_org_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `WalletFundingAttempt` DROP FOREIGN KEY `WalletFundingAttempt_wallet_fkey`;
ALTER TABLE `WalletFundingAttempt` ADD CONSTRAINT `WalletFundingAttempt_wallet_fkey` FOREIGN KEY (`walletAccountId`) REFERENCES `WalletAccount`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `FinancialSettlement` DROP FOREIGN KEY `FinancialSettlement_org_fkey`;
ALTER TABLE `FinancialSettlement` ADD CONSTRAINT `FinancialSettlement_org_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `ProviderTransferRecipient` DROP FOREIGN KEY `ProviderTransferRecipient_org_fkey`;
ALTER TABLE `ProviderTransferRecipient` ADD CONSTRAINT `ProviderTransferRecipient_org_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `WalletTransaction` DROP FOREIGN KEY `WalletTransaction_org_fkey`;
ALTER TABLE `WalletTransaction` ADD CONSTRAINT `WalletTransaction_org_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `WalletTransaction` DROP FOREIGN KEY `WalletTransaction_wallet_fkey`;
ALTER TABLE `WalletTransaction` ADD CONSTRAINT `WalletTransaction_wallet_fkey` FOREIGN KEY (`walletAccountId`) REFERENCES `WalletAccount`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `WalletDisbursement` DROP FOREIGN KEY `WalletDisbursement_walletAccountId_fkey`;
ALTER TABLE `WalletDisbursement` ADD CONSTRAINT `WalletDisbursement_walletAccountId_fkey` FOREIGN KEY (`walletAccountId`) REFERENCES `WalletAccount`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
