CREATE TABLE `NotificationChannel` (
  `id` VARCHAR(191) NOT NULL, `key` VARCHAR(191) NOT NULL, `name` VARCHAR(191) NOT NULL,
  `description` VARCHAR(191) NULL, `isActive` BOOLEAN NOT NULL DEFAULT true, `sortOrder` INTEGER NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `NotificationChannel_key_key`(`key`), INDEX `NotificationChannel_isActive_sortOrder_idx`(`isActive`, `sortOrder`), PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `NotificationCategory` (
  `id` VARCHAR(191) NOT NULL, `moduleKey` VARCHAR(191) NOT NULL, `moduleName` VARCHAR(191) NOT NULL,
  `key` VARCHAR(191) NOT NULL, `name` VARCHAR(191) NOT NULL, `description` TEXT NOT NULL,
  `isActive` BOOLEAN NOT NULL DEFAULT true, `sortOrder` INTEGER NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `NotificationCategory_moduleKey_key_key`(`moduleKey`, `key`),
  INDEX `NotificationCategory_moduleKey_isActive_sortOrder_idx`(`moduleKey`, `isActive`, `sortOrder`), PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `TenantNotificationPreference` (
  `id` VARCHAR(191) NOT NULL, `organizationId` VARCHAR(191) NOT NULL, `channelId` VARCHAR(191) NOT NULL,
  `categoryId` VARCHAR(191) NOT NULL, `enabled` BOOLEAN NOT NULL DEFAULT true,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `TenantPref_org_channel_category_uq`(`organizationId`, `channelId`, `categoryId`),
  INDEX `TenantPref_org_channel_idx`(`organizationId`, `channelId`), PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `PlatformAnnouncement` (
  `id` VARCHAR(191) NOT NULL, `title` VARCHAR(191) NOT NULL, `summary` TEXT NOT NULL, `description` LONGTEXT NOT NULL,
  `type` VARCHAR(191) NOT NULL, `contentFormat` VARCHAR(191) NOT NULL DEFAULT 'MARKDOWN', `learnMoreUrl` VARCHAR(191) NULL,
  `contentReference` VARCHAR(191) NULL, `publishedAt` DATETIME(3) NULL, `expiresAt` DATETIME(3) NULL,
  `isPublished` BOOLEAN NOT NULL DEFAULT false, `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updatedAt` DATETIME(3) NOT NULL,
  INDEX `PlatformAnnouncement_isPublished_publishedAt_idx`(`isPublished`, `publishedAt`),
  INDEX `PlatformAnnouncement_type_publishedAt_idx`(`type`, `publishedAt`), PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `AnnouncementReadStatus` (
  `id` VARCHAR(191) NOT NULL, `organizationId` VARCHAR(191) NOT NULL, `userId` VARCHAR(191) NOT NULL,
  `announcementId` VARCHAR(191) NOT NULL, `readAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `AnnouncementReadStatus_userId_announcementId_key`(`userId`, `announcementId`),
  INDEX `AnnouncementReadStatus_organizationId_userId_readAt_idx`(`organizationId`, `userId`, `readAt`), PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `TenantNotificationPreference` ADD CONSTRAINT `TenantNotificationPreference_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `TenantNotificationPreference` ADD CONSTRAINT `TenantNotificationPreference_channelId_fkey` FOREIGN KEY (`channelId`) REFERENCES `NotificationChannel`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `TenantNotificationPreference` ADD CONSTRAINT `TenantNotificationPreference_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `NotificationCategory`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `AnnouncementReadStatus` ADD CONSTRAINT `AnnouncementReadStatus_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `AnnouncementReadStatus` ADD CONSTRAINT `AnnouncementReadStatus_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `AnnouncementReadStatus` ADD CONSTRAINT `AnnouncementReadStatus_announcementId_fkey` FOREIGN KEY (`announcementId`) REFERENCES `PlatformAnnouncement`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO `NotificationChannel` (`id`,`key`,`name`,`description`,`sortOrder`,`updatedAt`) VALUES
('channel-in-app','IN_APP','In-App Notifications','Notifications shown inside Sinkronis.',1,CURRENT_TIMESTAMP(3)),
('channel-email','EMAIL','Email Notifications','Notifications sent to organization administrators by email.',2,CURRENT_TIMESTAMP(3));

INSERT INTO `NotificationCategory` (`id`,`moduleKey`,`moduleName`,`key`,`name`,`description`,`sortOrder`,`updatedAt`) VALUES
('hris-approvals','hris','HRIS','approvals-requests','Approvals & Requests','Leave requests, payment approvals, and expense submissions.',1,CURRENT_TIMESTAMP(3)),
('hris-record-updates','hris','HRIS','record-updates','Record Updates','Employee profile updates, employee record changes, and invoice status changes.',2,CURRENT_TIMESTAMP(3)),
('hris-system-alerts','hris','HRIS','system-alerts','System Alerts','Failed login attempts, overdue invoices, attendance anomalies, and system-generated warnings.',3,CURRENT_TIMESTAMP(3)),
('hris-reminders','hris','HRIS','reminders','Reminders','Invoice due dates, low leave balance, and subscription renewal notices.',4,CURRENT_TIMESTAMP(3)),
('payroll-approvals','payroll','Payroll','approvals-requests','Approvals & Requests','Pay-run approvals, salary changes, deductions, and disbursement requests.',1,CURRENT_TIMESTAMP(3)),
('payroll-record-updates','payroll','Payroll','record-updates','Record Updates','Salary structure, payslip, loan, and employee payroll record changes.',2,CURRENT_TIMESTAMP(3)),
('payroll-system-alerts','payroll','Payroll','system-alerts','System Alerts','Failed pay runs, statutory calculation issues, and disbursement warnings.',3,CURRENT_TIMESTAMP(3)),
('payroll-reminders','payroll','Payroll','reminders','Reminders','Upcoming pay runs, statutory deadlines, and pending payroll approvals.',4,CURRENT_TIMESTAMP(3)),
('accounting-approvals','accounting','Accounting','approvals-requests','Approvals & Requests','Payment requests, expense submissions, invoices, and financial approvals.',1,CURRENT_TIMESTAMP(3)),
('accounting-record-updates','accounting','Accounting','record-updates','Record Updates','Invoice, client, expense, tax, wallet, and agent record changes.',2,CURRENT_TIMESTAMP(3)),
('accounting-system-alerts','accounting','Accounting','system-alerts','System Alerts','Overdue invoices, failed payments, reconciliation issues, and compliance warnings.',3,CURRENT_TIMESTAMP(3)),
('accounting-reminders','accounting','Accounting','reminders','Reminders','Invoice due dates, tax deadlines, payment dates, and subscription renewals.',4,CURRENT_TIMESTAMP(3));
