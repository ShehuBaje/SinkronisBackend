ALTER TABLE `AuthEvent`
  ADD COLUMN `locationCity` VARCHAR(191) NULL,
  ADD COLUMN `locationTimezone` VARCHAR(191) NULL,
  ADD COLUMN `locationProvider` VARCHAR(191) NULL;

ALTER TABLE `UserSession`
  ADD COLUMN `locationCity` VARCHAR(191) NULL,
  ADD COLUMN `locationTimezone` VARCHAR(191) NULL,
  ADD COLUMN `locationProvider` VARCHAR(191) NULL;

ALTER TABLE `Organization`
  ADD COLUMN `cacVerificationStatus` VARCHAR(191) NOT NULL DEFAULT 'UNVERIFIED',
  ADD COLUMN `cacVerificationCheckedAt` DATETIME(3) NULL,
  ADD COLUMN `cacVerifiedAt` DATETIME(3) NULL,
  ADD COLUMN `cacVerifiedName` VARCHAR(191) NULL,
  ADD COLUMN `cacVerificationProvider` VARCHAR(191) NULL,
  ADD COLUMN `cacVerificationReference` VARCHAR(191) NULL,
  ADD COLUMN `cacRegistryStatus` VARCHAR(191) NULL;
