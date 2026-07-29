CREATE INDEX `SystemConfig_key_idx` ON `SystemConfig`(`key`);
CREATE INDEX `BillingHistory_status_billedAt_idx` ON `BillingHistory`(`status`, `billedAt`);
