ALTER TABLE `Payslip`
  ADD COLUMN `pfaNameSnapshot` VARCHAR(191) NULL,
  ADD COLUMN `pensionPinSnapshot` VARCHAR(191) NULL,
  ADD COLUMN `avcContribution` DECIMAL(14,2) NOT NULL DEFAULT 0.00;

CREATE TABLE `PayrollAvcContribution` (
  `id` VARCHAR(191) NOT NULL,
  `organizationId` VARCHAR(191) NOT NULL,
  `employeeId` VARCHAR(191) NOT NULL,
  `monthlyAmount` DECIMAL(14,2) NOT NULL,
  `startDate` DATETIME(3) NOT NULL,
  `endDate` DATETIME(3) NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'ACTIVE',
  `pausedAt` DATETIME(3) NULL,
  `resumedAt` DATETIME(3) NULL,
  `createdById` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  INDEX `PayrollAvcContribution_org_status_start_idx`(`organizationId`, `status`, `startDate`),
  INDEX `PayrollAvcContribution_org_employee_status_idx`(`organizationId`, `employeeId`, `status`),
  CONSTRAINT `PayrollAvcContribution_org_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `PayrollAvcContribution_employee_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `PayrollPfaTransfer` (
  `id` VARCHAR(191) NOT NULL,
  `organizationId` VARCHAR(191) NOT NULL,
  `employeeId` VARCHAR(191) NOT NULL,
  `fromPfaName` VARCHAR(191) NOT NULL,
  `toPfaName` VARCHAR(191) NOT NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'INITIATED',
  `initiatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `completedAt` DATETIME(3) NULL,
  `createdById` VARCHAR(191) NULL,
  `updatedById` VARCHAR(191) NULL,
  `externalReference` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  INDEX `PayrollPfaTransfer_org_status_date_idx`(`organizationId`, `status`, `initiatedAt`),
  INDEX `PayrollPfaTransfer_org_employee_status_idx`(`organizationId`, `employeeId`, `status`),
  CONSTRAINT `PayrollPfaTransfer_org_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `PayrollPfaTransfer_employee_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `PayrollPensionRemittance` (
  `id` VARCHAR(191) NOT NULL,
  `organizationId` VARCHAR(191) NOT NULL,
  `payrollRunId` VARCHAR(191) NOT NULL,
  `period` CHAR(7) NOT NULL,
  `pfaName` VARCHAR(191) NOT NULL,
  `memberCount` INTEGER NOT NULL,
  `employeeContribution` DECIMAL(14,2) NOT NULL,
  `employerContribution` DECIMAL(14,2) NOT NULL,
  `avcContribution` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `totalAmount` DECIMAL(14,2) NOT NULL,
  `dueDate` DATETIME(3) NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
  `remittedAt` DATETIME(3) NULL,
  `paymentReference` VARCHAR(191) NULL,
  `receiptReference` VARCHAR(191) NULL,
  `markedById` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `PayrollPensionRemittance_org_run_pfa_key`(`organizationId`, `payrollRunId`, `pfaName`),
  UNIQUE INDEX `PayrollPensionRemittance_org_payment_ref_key`(`organizationId`, `paymentReference`),
  INDEX `PayrollPensionRemittance_org_period_status_idx`(`organizationId`, `period`, `status`),
  CONSTRAINT `PayrollPensionRemittance_org_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `PayrollPensionRemittance_run_fkey` FOREIGN KEY (`payrollRunId`) REFERENCES `PayrollRun`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
