CREATE TABLE `UserNotification` (
    `id` VARCHAR(191) NOT NULL,
    `organizationId` VARCHAR(191) NOT NULL,
    `recipientUserId` VARCHAR(191) NOT NULL,
    `categoryId` VARCHAR(191) NOT NULL,
    `eventKey` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `message` TEXT NOT NULL,
    `metadata` JSON NULL,
    `inAppStatus` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
    `emailStatus` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
    `emailError` TEXT NULL,
    `readAt` DATETIME(3) NULL,
    `deliveredAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `UserNotification_org_recipient_event_key`(`organizationId`, `recipientUserId`, `eventKey`),
    INDEX `UserNotification_recipient_inbox_idx`(`organizationId`, `recipientUserId`, `readAt`, `createdAt`),
    INDEX `UserNotification_email_delivery_idx`(`organizationId`, `emailStatus`, `createdAt`),
    INDEX `UserNotification_categoryId_idx`(`categoryId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `UserNotification`
    ADD CONSTRAINT `UserNotification_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT `UserNotification_recipientUserId_fkey` FOREIGN KEY (`recipientUserId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT `UserNotification_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `NotificationCategory`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
