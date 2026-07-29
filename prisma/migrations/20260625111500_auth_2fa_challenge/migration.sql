-- CreateTable
CREATE TABLE `AuthChallenge` (
  `id` VARCHAR(191) NOT NULL,
  `organizationId` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `purpose` VARCHAR(191) NOT NULL,
  `method` VARCHAR(191) NOT NULL,
  `codeHash` VARCHAR(191) NOT NULL,
  `attempts` INTEGER NOT NULL DEFAULT 0,
  `maxAttempts` INTEGER NOT NULL DEFAULT 5,
  `expiresAt` DATETIME(3) NOT NULL,
  `consumedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `AuthChallenge_organizationId_userId_purpose_createdAt_idx`(`organizationId`, `userId`, `purpose`, `createdAt`),
  INDEX `AuthChallenge_organizationId_expiresAt_idx`(`organizationId`, `expiresAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `AuthChallenge`
  ADD CONSTRAINT `AuthChallenge_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AuthChallenge`
  ADD CONSTRAINT `AuthChallenge_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
