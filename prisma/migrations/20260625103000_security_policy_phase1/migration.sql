-- AlterTable
ALTER TABLE `User`
  ADD COLUMN `failedLoginAttempts` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `lockedUntil` DATETIME(3) NULL,
  ADD COLUMN `passwordChangedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

-- CreateTable
CREATE TABLE `SecurityPolicy` (
  `id` VARCHAR(191) NOT NULL,
  `organizationId` VARCHAR(191) NOT NULL,
  `minPasswordLength` INTEGER NOT NULL DEFAULT 8,
  `passwordExpiryDays` INTEGER NOT NULL DEFAULT 90,
  `lockoutMaxAttempts` INTEGER NOT NULL DEFAULT 5,
  `requireUppercase` BOOLEAN NOT NULL DEFAULT true,
  `requireLowercase` BOOLEAN NOT NULL DEFAULT true,
  `requireNumber` BOOLEAN NOT NULL DEFAULT true,
  `requireSpecialCharacter` BOOLEAN NOT NULL DEFAULT true,
  `twoFactorEnabled` BOOLEAN NOT NULL DEFAULT false,
  `enforceTwoFactorForAllUsers` BOOLEAN NOT NULL DEFAULT false,
  `allowAuthenticatorApp` BOOLEAN NOT NULL DEFAULT true,
  `allowSmsOtp` BOOLEAN NOT NULL DEFAULT false,
  `allowEmailOtp` BOOLEAN NOT NULL DEFAULT true,
  `ipAllowlistEnabled` BOOLEAN NOT NULL DEFAULT false,
  `updatedByUserId` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `SecurityPolicy_organizationId_key`(`organizationId`),
  INDEX `SecurityPolicy_organizationId_updatedAt_idx`(`organizationId`, `updatedAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `UserSession` (
  `id` VARCHAR(191) NOT NULL,
  `organizationId` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `refreshTokenHash` VARCHAR(191) NOT NULL,
  `deviceName` VARCHAR(191) NULL,
  `userAgent` TEXT NULL,
  `ipAddress` VARCHAR(191) NULL,
  `locationState` VARCHAR(191) NULL,
  `locationCountry` VARCHAR(191) NULL,
  `isCurrent` BOOLEAN NOT NULL DEFAULT false,
  `revokedAt` DATETIME(3) NULL,
  `revokeReason` VARCHAR(191) NULL,
  `lastSeenAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `expiresAt` DATETIME(3) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `UserSession_organizationId_userId_revokedAt_idx`(`organizationId`, `userId`, `revokedAt`),
  INDEX `UserSession_organizationId_createdAt_idx`(`organizationId`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `IpAllowlistEntry` (
  `id` VARCHAR(191) NOT NULL,
  `organizationId` VARCHAR(191) NOT NULL,
  `value` VARCHAR(191) NOT NULL,
  `label` VARCHAR(191) NULL,
  `createdByUserId` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `IpAllowlistEntry_organizationId_value_key`(`organizationId`, `value`),
  INDEX `IpAllowlistEntry_organizationId_createdAt_idx`(`organizationId`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AuthEvent` (
  `id` VARCHAR(191) NOT NULL,
  `organizationId` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NULL,
  `emailAttempted` VARCHAR(191) NULL,
  `eventType` VARCHAR(191) NOT NULL,
  `status` VARCHAR(191) NOT NULL,
  `reasonCode` VARCHAR(191) NULL,
  `ipAddress` VARCHAR(191) NULL,
  `userAgent` TEXT NULL,
  `deviceName` VARCHAR(191) NULL,
  `locationState` VARCHAR(191) NULL,
  `locationCountry` VARCHAR(191) NULL,
  `occurredAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `AuthEvent_organizationId_occurredAt_idx`(`organizationId`, `occurredAt`),
  INDEX `AuthEvent_organizationId_status_occurredAt_idx`(`organizationId`, `status`, `occurredAt`),
  INDEX `AuthEvent_organizationId_userId_occurredAt_idx`(`organizationId`, `userId`, `occurredAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `SecurityPolicy`
  ADD CONSTRAINT `SecurityPolicy_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SecurityPolicy`
  ADD CONSTRAINT `SecurityPolicy_updatedByUserId_fkey` FOREIGN KEY (`updatedByUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserSession`
  ADD CONSTRAINT `UserSession_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserSession`
  ADD CONSTRAINT `UserSession_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `IpAllowlistEntry`
  ADD CONSTRAINT `IpAllowlistEntry_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `IpAllowlistEntry`
  ADD CONSTRAINT `IpAllowlistEntry_createdByUserId_fkey` FOREIGN KEY (`createdByUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AuthEvent`
  ADD CONSTRAINT `AuthEvent_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AuthEvent`
  ADD CONSTRAINT `AuthEvent_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
