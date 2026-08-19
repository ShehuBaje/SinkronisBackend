-- HRIS leave balances and staged employee appraisal workflow.
ALTER TABLE `LeaveRequest`
  ADD COLUMN `requestedDays` DECIMAL(8,2) NULL,
  ADD COLUMN `submittedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  ADD COLUMN `rejectionReason` TEXT NULL;
UPDATE `LeaveRequest` SET `submittedAt` = `createdAt`;

ALTER TABLE `Employee` ADD COLUMN `managerId` VARCHAR(191) NULL;
ALTER TABLE `Employee` ADD CONSTRAINT `Employee_managerId_fkey` FOREIGN KEY (`managerId`) REFERENCES `Employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `AppraisalCycle`
  ADD COLUMN `quarter` VARCHAR(191) NULL,
  ADD COLUMN `year` INTEGER NULL,
  ADD COLUMN `deadline` DATETIME(3) NULL,
  ADD COLUMN `templateId` VARCHAR(191) NULL;

CREATE TABLE `LeaveType` (
  `id` VARCHAR(191) NOT NULL, `organizationId` VARCHAR(191) NOT NULL, `code` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NOT NULL, `annualAllowance` DECIMAL(8,2) NOT NULL DEFAULT 0,
  `active` BOOLEAN NOT NULL DEFAULT true, `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL, UNIQUE INDEX `LeaveType_org_code_key`(`organizationId`,`code`),
  INDEX `LeaveType_org_active_idx`(`organizationId`,`active`), PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `LeaveBalance` (
  `id` VARCHAR(191) NOT NULL, `organizationId` VARCHAR(191) NOT NULL, `employeeId` VARCHAR(191) NOT NULL,
  `leaveTypeCode` VARCHAR(191) NOT NULL, `year` INTEGER NOT NULL, `entitlement` DECIMAL(8,2) NOT NULL,
  `used` DECIMAL(8,2) NOT NULL DEFAULT 0, `pending` DECIMAL(8,2) NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `LeaveBalance_org_employee_type_year_key`(`organizationId`,`employeeId`,`leaveTypeCode`,`year`),
  INDEX `LeaveBalance_org_year_idx`(`organizationId`,`year`), PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `AppraisalTemplate` (
  `id` VARCHAR(191) NOT NULL, `organizationId` VARCHAR(191) NOT NULL, `name` VARCHAR(191) NOT NULL,
  `description` TEXT NULL, `configuration` JSON NOT NULL, `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL, UNIQUE INDEX `AppraisalTemplate_org_name_key`(`organizationId`,`name`),
  INDEX `AppraisalTemplate_org_idx`(`organizationId`), PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `EmployeeAppraisal` (
  `id` VARCHAR(191) NOT NULL, `organizationId` VARCHAR(191) NOT NULL, `employeeId` VARCHAR(191) NOT NULL,
  `managerId` VARCHAR(191) NULL, `cycleId` VARCHAR(191) NOT NULL, `templateId` VARCHAR(191) NOT NULL,
  `stage` ENUM('GOAL_SETTING','SELF_ASSESSMENT','MANAGER_REVIEW','HR_APPROVAL','ACKNOWLEDGMENT','COMPLETED') NOT NULL DEFAULT 'GOAL_SETTING',
  `status` ENUM('IN_PROGRESS','COMPLETED') NOT NULL DEFAULT 'IN_PROGRESS', `finalScore` DECIMAL(6,2) NULL,
  `rating` VARCHAR(191) NULL, `acknowledgedResponse` TEXT NULL, `acknowledgedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `EmployeeAppraisal_org_employee_cycle_key`(`organizationId`,`employeeId`,`cycleId`),
  INDEX `EmployeeAppraisal_org_cycle_stage_idx`(`organizationId`,`cycleId`,`stage`),
  INDEX `EmployeeAppraisal_org_status_idx`(`organizationId`,`status`), INDEX `EmployeeAppraisal_manager_stage_idx`(`managerId`,`stage`), PRIMARY KEY (`id`),
  CONSTRAINT `EmployeeAppraisal_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `EmployeeAppraisal_managerId_fkey` FOREIGN KEY (`managerId`) REFERENCES `Employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `EmployeeAppraisal_cycleId_fkey` FOREIGN KEY (`cycleId`) REFERENCES `AppraisalCycle`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `EmployeeAppraisal_templateId_fkey` FOREIGN KEY (`templateId`) REFERENCES `AppraisalTemplate`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `AppraisalGoal` (
  `id` VARCHAR(191) NOT NULL, `organizationId` VARCHAR(191) NOT NULL, `appraisalId` VARCHAR(191) NOT NULL,
  `title` VARCHAR(191) NOT NULL, `description` TEXT NOT NULL, `successCriteria` TEXT NOT NULL, `targetDate` DATETIME(3) NOT NULL,
  `status` ENUM('NOT_STARTED','IN_PROGRESS','COMPLETED','LOCKED') NOT NULL DEFAULT 'NOT_STARTED',
  `employeeRating` INTEGER NULL, `employeeComment` TEXT NULL, `managerRating` INTEGER NULL, `managerComment` TEXT NULL,
  `createdById` VARCHAR(191) NOT NULL, `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updatedAt` DATETIME(3) NOT NULL,
  INDEX `AppraisalGoal_org_appraisal_idx`(`organizationId`,`appraisalId`), PRIMARY KEY (`id`),
  CONSTRAINT `AppraisalGoal_appraisalId_fkey` FOREIGN KEY (`appraisalId`) REFERENCES `EmployeeAppraisal`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `AppraisalSelfAssessment` (
  `id` VARCHAR(191) NOT NULL, `organizationId` VARCHAR(191) NOT NULL, `appraisalId` VARCHAR(191) NOT NULL,
  `status` ENUM('IN_PROGRESS','SUBMITTED') NOT NULL DEFAULT 'IN_PROGRESS', `sections` JSON NOT NULL, `reflections` JSON NOT NULL,
  `submittedAt` DATETIME(3) NULL, `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `AppraisalSelfAssessment_appraisalId_key`(`appraisalId`), INDEX `AppraisalSelfAssessment_org_status_idx`(`organizationId`,`status`), PRIMARY KEY (`id`),
  CONSTRAINT `AppraisalSelfAssessment_appraisalId_fkey` FOREIGN KEY (`appraisalId`) REFERENCES `EmployeeAppraisal`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `AppraisalManagerReview` (
  `id` VARCHAR(191) NOT NULL, `organizationId` VARCHAR(191) NOT NULL, `appraisalId` VARCHAR(191) NOT NULL, `managerId` VARCHAR(191) NOT NULL,
  `status` ENUM('IN_PROGRESS','SUBMITTED') NOT NULL DEFAULT 'IN_PROGRESS', `goalRatings` JSON NOT NULL, `responses` JSON NOT NULL,
  `overallFeedback` TEXT NULL, `recommendation` VARCHAR(191) NULL, `submittedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `AppraisalManagerReview_appraisalId_key`(`appraisalId`), INDEX `AppraisalManagerReview_org_status_idx`(`organizationId`,`status`), PRIMARY KEY (`id`),
  CONSTRAINT `AppraisalManagerReview_appraisalId_fkey` FOREIGN KEY (`appraisalId`) REFERENCES `EmployeeAppraisal`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `AppraisalHRApproval` (
  `id` VARCHAR(191) NOT NULL, `organizationId` VARCHAR(191) NOT NULL, `appraisalId` VARCHAR(191) NOT NULL,
  `decision` ENUM('APPROVED','RETURNED_FOR_REVIEW') NOT NULL, `internalNotes` TEXT NULL, `approvedById` VARCHAR(191) NOT NULL,
  `approvedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), UNIQUE INDEX `AppraisalHRApproval_appraisalId_key`(`appraisalId`),
  INDEX `AppraisalHRApproval_org_decision_idx`(`organizationId`,`decision`), PRIMARY KEY (`id`),
  CONSTRAINT `AppraisalHRApproval_appraisalId_fkey` FOREIGN KEY (`appraisalId`) REFERENCES `EmployeeAppraisal`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX `Employee_org_manager_idx` ON `Employee`(`organizationId`,`managerId`);
CREATE INDEX `AppraisalCycle_org_year_quarter_idx` ON `AppraisalCycle`(`organizationId`,`year`,`quarter`);
CREATE INDEX `AppraisalCycle_templateId_idx` ON `AppraisalCycle`(`templateId`);
ALTER TABLE `AppraisalCycle` ADD CONSTRAINT `AppraisalCycle_templateId_fkey` FOREIGN KEY (`templateId`) REFERENCES `AppraisalTemplate`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- Existing requests have no historically reliable working-day count; leave requestedDays NULL for later review.
-- Existing cycles require quarter/year/template mapping before they can power the staged workflow.
