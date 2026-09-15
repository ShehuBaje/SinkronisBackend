ALTER TABLE `PayrollRun`
  ADD COLUMN `expectedEmployeeCount` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `processedEmployeeCount` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `failedEmployeeCount` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `calculationInput` JSON NULL,
  ADD COLUMN `failureReason` TEXT NULL,
  ADD COLUMN `processingHeartbeatAt` DATETIME(3) NULL;

CREATE TABLE `PayrollCalculationBatch` (
  `id` VARCHAR(191) NOT NULL,
  `organizationId` VARCHAR(191) NOT NULL,
  `payrollRunId` VARCHAR(191) NOT NULL,
  `batchIndex` INTEGER NOT NULL,
  `employeeIds` JSON NOT NULL,
  `status` VARCHAR(24) NOT NULL DEFAULT 'PENDING',
  `expectedCount` INTEGER NOT NULL,
  `processedCount` INTEGER NOT NULL DEFAULT 0,
  `failedCount` INTEGER NOT NULL DEFAULT 0,
  `totals` JSON NULL,
  `attempts` INTEGER NOT NULL DEFAULT 0,
  `errorMessage` TEXT NULL,
  `startedAt` DATETIME(3) NULL,
  `completedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `PayrollCalculationBatch_run_index_key`(`payrollRunId`, `batchIndex`),
  INDEX `PayrollCalculationBatch_org_status_updated_idx`(`organizationId`, `status`, `updatedAt`),
  INDEX `PayrollCalculationBatch_run_status_idx`(`payrollRunId`, `status`),
  PRIMARY KEY (`id`),
  CONSTRAINT `PayrollCalculationBatch_run_fkey` FOREIGN KEY (`payrollRunId`) REFERENCES `PayrollRun`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
