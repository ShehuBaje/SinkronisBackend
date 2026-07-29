-- CreateTable
CREATE TABLE `PaymentCard` (
    `id` VARCHAR(191) NOT NULL,
    `organizationId` VARCHAR(191) NOT NULL,
    `cardHolderName` VARCHAR(191) NOT NULL,
    `brand` VARCHAR(191) NOT NULL,
    `last4` VARCHAR(191) NOT NULL,
    `expMonth` INTEGER NOT NULL,
    `expYear` INTEGER NOT NULL,
    `provider` VARCHAR(191) NULL,
    `providerCardToken` VARCHAR(191) NULL,
    `isDefault` BOOLEAN NOT NULL DEFAULT false,
    `createdByUserId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `PaymentCard_organizationId_isDefault_idx`(`organizationId`, `isDefault`),
    INDEX `PaymentCard_organizationId_createdAt_idx`(`organizationId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `BillingHistory` (
    `id` VARCHAR(191) NOT NULL,
    `organizationId` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(14, 2) NOT NULL,
    `currency` VARCHAR(191) NOT NULL DEFAULT 'NGN',
    `status` VARCHAR(191) NOT NULL,
    `billedAt` DATETIME(3) NOT NULL,
    `providerRef` VARCHAR(191) NULL,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `BillingHistory_organizationId_billedAt_idx`(`organizationId`, `billedAt`),
    INDEX `BillingHistory_organizationId_status_billedAt_idx`(`organizationId`, `status`, `billedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `PaymentCard` ADD CONSTRAINT `PaymentCard_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BillingHistory` ADD CONSTRAINT `BillingHistory_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
