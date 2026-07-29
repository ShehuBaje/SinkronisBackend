-- AlterTable
ALTER TABLE `Organization`
    ADD COLUMN `profileImageUrl` VARCHAR(191) NULL,
    ADD COLUMN `industry` VARCHAR(191) NULL,
    ADD COLUMN `cacNumber` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `PasswordResetOtp` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `codeHash` VARCHAR(191) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `verifiedAt` DATETIME(3) NULL,
    `consumedAt` DATETIME(3) NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `PasswordResetOtp_userId_createdAt_idx`(`userId`, `createdAt`),
    INDEX `PasswordResetOtp_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `PasswordResetOtp`
    ADD CONSTRAINT `PasswordResetOtp_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
