-- CreateTable
CREATE TABLE `UserTwoFactor` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `authenticatorSecretEnc` VARCHAR(191) NULL,
  `authenticatorEnabled` BOOLEAN NOT NULL DEFAULT false,
  `phoneNumber` VARCHAR(191) NULL,
  `preferredMethod` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `UserTwoFactor_userId_key`(`userId`),
  INDEX `UserTwoFactor_authenticatorEnabled_updatedAt_idx`(`authenticatorEnabled`, `updatedAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `UserTwoFactor`
  ADD CONSTRAINT `UserTwoFactor_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
