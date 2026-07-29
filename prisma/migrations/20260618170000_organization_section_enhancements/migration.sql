-- AlterTable
ALTER TABLE `Organization`
  ADD COLUMN `registrationAddress` TEXT NULL,
  ADD COLUMN `website` VARCHAR(191) NULL,
  ADD COLUMN `fiscalYearStart` VARCHAR(191) NULL,
  ADD COLUMN `companySize` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `Department`
  ADD COLUMN `headEmployeeId` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `Branch` (
  `id` VARCHAR(191) NOT NULL,
  `organizationId` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `address` TEXT NOT NULL,
  `phone` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `Branch_organizationId_name_key`(`organizationId`, `name`),
  INDEX `Branch_organizationId_idx`(`organizationId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WorkSchedule` (
  `id` VARCHAR(191) NOT NULL,
  `organizationId` VARCHAR(191) NOT NULL,
  `monday` BOOLEAN NOT NULL DEFAULT true,
  `tuesday` BOOLEAN NOT NULL DEFAULT true,
  `wednesday` BOOLEAN NOT NULL DEFAULT true,
  `thursday` BOOLEAN NOT NULL DEFAULT true,
  `friday` BOOLEAN NOT NULL DEFAULT true,
  `saturday` BOOLEAN NOT NULL DEFAULT false,
  `sunday` BOOLEAN NOT NULL DEFAULT false,
  `workStartTime` VARCHAR(191) NOT NULL DEFAULT '09:00',
  `workEndTime` VARCHAR(191) NOT NULL DEFAULT '17:00',
  `breakDurationMinutes` INTEGER NOT NULL DEFAULT 60,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `WorkSchedule_organizationId_key`(`organizationId`),
  INDEX `WorkSchedule_organizationId_idx`(`organizationId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `Department_headEmployeeId_idx` ON `Department`(`headEmployeeId`);

-- AddForeignKey
ALTER TABLE `Department`
  ADD CONSTRAINT `Department_headEmployeeId_fkey` FOREIGN KEY (`headEmployeeId`) REFERENCES `Employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Branch`
  ADD CONSTRAINT `Branch_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WorkSchedule`
  ADD CONSTRAINT `WorkSchedule_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
