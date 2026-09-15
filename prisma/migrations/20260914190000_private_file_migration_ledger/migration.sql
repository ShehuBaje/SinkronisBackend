CREATE TABLE `PrivateFileMigration` (
  `id` VARCHAR(191) NOT NULL,
  `organizationId` VARCHAR(191) NOT NULL,
  `resourceType` VARCHAR(64) NOT NULL,
  `resourceId` VARCHAR(191) NOT NULL,
  `sourceReference` TEXT NOT NULL,
  `destinationReference` TEXT NULL,
  `status` VARCHAR(24) NOT NULL DEFAULT 'PENDING',
  `attempts` INTEGER NOT NULL DEFAULT 0,
  `errorMessage` TEXT NULL,
  `startedAt` DATETIME(3) NULL,
  `completedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `PrivateFileMigration_resource_key`(`resourceType`, `resourceId`),
  INDEX `PrivateFileMigration_org_status_created_idx`(`organizationId`, `status`, `createdAt`),
  INDEX `PrivateFileMigration_status_updated_idx`(`status`, `updatedAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
