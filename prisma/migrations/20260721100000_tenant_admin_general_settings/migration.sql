CREATE TABLE `OrganizationGeneralSettings` (
  `id` VARCHAR(191) NOT NULL,
  `organizationId` VARCHAR(191) NOT NULL,
  `timeZone` VARCHAR(191) NOT NULL DEFAULT 'Africa/Lagos',
  `language` VARCHAR(191) NOT NULL DEFAULT 'en',
  `dateFormat` VARCHAR(191) NOT NULL DEFAULT 'DD/MM/YYYY',
  `currency` VARCHAR(191) NOT NULL DEFAULT 'NGN',
  `accentColor` VARCHAR(191) NOT NULL DEFAULT '#2563EB',
  `linkText` VARCHAR(191) NULL,
  `logoUrl` VARCHAR(191) NULL,
  `logoFileName` VARCHAR(191) NULL,
  `logoMimeType` VARCHAR(191) NULL,
  `logoSize` INTEGER NULL,
  `logoWidth` INTEGER NULL,
  `logoHeight` INTEGER NULL,
  `logoUploadedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `OrgGeneralSettings_org_key`(`organizationId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `OrganizationDataExport` (
  `id` VARCHAR(191) NOT NULL,
  `organizationId` VARCHAR(191) NOT NULL,
  `requestedByUserId` VARCHAR(191) NOT NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'PROCESSING',
  `fileName` VARCHAR(191) NULL,
  `fileReference` VARCHAR(191) NULL,
  `fileSize` INTEGER NULL,
  `requestedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `completedAt` DATETIME(3) NULL,
  `failedAt` DATETIME(3) NULL,
  `errorMessage` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  INDEX `OrgDataExport_org_requested_idx`(`organizationId`, `requestedAt`),
  INDEX `OrgDataExport_status_requested_idx`(`status`, `requestedAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `OrganizationDeletionRequest` (
  `id` VARCHAR(191) NOT NULL,
  `organizationId` VARCHAR(191) NOT NULL,
  `requestedByUserId` VARCHAR(191) NOT NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING_PLATFORM_APPROVAL',
  `reason` TEXT NULL,
  `requestedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `reviewedAt` DATETIME(3) NULL,
  `reviewedByUserId` VARCHAR(191) NULL,
  `completedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  INDEX `OrgDeletionRequest_org_status_idx`(`organizationId`, `status`),
  INDEX `OrgDeletionRequest_status_requested_idx`(`status`, `requestedAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `OrganizationGeneralSettings` ADD CONSTRAINT `OrgGeneralSettings_org_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `OrganizationDataExport` ADD CONSTRAINT `OrgDataExport_org_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `OrganizationDeletionRequest` ADD CONSTRAINT `OrgDeletionRequest_org_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
