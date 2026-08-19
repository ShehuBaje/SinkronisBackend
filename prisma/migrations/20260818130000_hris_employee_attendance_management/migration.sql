-- HRIS employee profile/lifecycle and attendance management persistence.
-- Existing employees default to PROBATION because no prior lifecycle history exists;
-- product owners should review/backfill CONFIRMED/EXITED employees before relying on lifecycle reports.
ALTER TABLE `Employee`
  ADD COLUMN `lifecycleStatus` ENUM('PROBATION','CONFIRMED','EXITED') NOT NULL DEFAULT 'PROBATION',
  ADD COLUMN `lifecycleEffectiveAt` DATETIME(3) NULL,
  ADD COLUMN `gender` VARCHAR(191) NULL,
  ADD COLUMN `employmentType` VARCHAR(191) NULL,
  ADD COLUMN `dateOfBirth` DATETIME(3) NULL,
  ADD COLUMN `address` TEXT NULL,
  ADD COLUMN `city` VARCHAR(191) NULL,
  ADD COLUMN `nationality` VARCHAR(191) NULL,
  ADD COLUMN `state` VARCHAR(191) NULL,
  ADD COLUMN `workMode` VARCHAR(191) NULL,
  ADD COLUMN `maritalStatus` VARCHAR(191) NULL,
  ADD COLUMN `taxId` VARCHAR(191) NULL,
  ADD COLUMN `bankCode` VARCHAR(191) NULL,
  ADD COLUMN `profileImageUrl` VARCHAR(191) NULL,
  ADD COLUMN `nextOfKinName` VARCHAR(191) NULL,
  ADD COLUMN `nextOfKinPhone` VARCHAR(191) NULL,
  ADD COLUMN `nextOfKinAddress` TEXT NULL,
  ADD COLUMN `nextOfKinRelationship` VARCHAR(191) NULL,
  ADD COLUMN `guarantorFirstName` VARCHAR(191) NULL,
  ADD COLUMN `guarantorLastName` VARCHAR(191) NULL,
  ADD COLUMN `guarantorRelationship` VARCHAR(191) NULL,
  ADD COLUMN `guarantorPhone` VARCHAR(191) NULL,
  ADD COLUMN `guarantorAddress` TEXT NULL;

ALTER TABLE `Attendance`
  ADD COLUMN `manualStatus` VARCHAR(191) NULL,
  ADD COLUMN `taskCompleted` TEXT NULL,
  ADD COLUMN `overriddenAt` DATETIME(3) NULL,
  ADD COLUMN `overriddenById` VARCHAR(191) NULL;

ALTER TABLE `WorkSchedule`
  ADD COLUMN `gracePeriodMinutes` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `overtimeAfterMinutes` INTEGER NOT NULL DEFAULT 0;

CREATE TABLE `EmployeeDocument` (
  `id` VARCHAR(191) NOT NULL, `organizationId` VARCHAR(191) NOT NULL, `employeeId` VARCHAR(191) NOT NULL,
  `documentType` VARCHAR(191) NOT NULL, `fileReference` VARCHAR(191) NOT NULL, `originalName` VARCHAR(191) NOT NULL,
  `mimeType` VARCHAR(191) NOT NULL, `size` INTEGER NOT NULL, `uploadedById` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), PRIMARY KEY (`id`),
  CONSTRAINT `EmployeeDocument_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `EmployeeStatusHistory` (
  `id` VARCHAR(191) NOT NULL, `organizationId` VARCHAR(191) NOT NULL, `employeeId` VARCHAR(191) NOT NULL,
  `previousOperationalStatus` ENUM('ACTIVE','ON_LEAVE','SUSPENDED','TERMINATED') NULL,
  `newOperationalStatus` ENUM('ACTIVE','ON_LEAVE','SUSPENDED','TERMINATED') NULL,
  `previousLifecycleStatus` ENUM('PROBATION','CONFIRMED','EXITED') NULL,
  `newLifecycleStatus` ENUM('PROBATION','CONFIRMED','EXITED') NULL,
  `effectiveDate` DATETIME(3) NOT NULL, `changedById` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), PRIMARY KEY (`id`),
  CONSTRAINT `EmployeeStatusHistory_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `AttendanceDispute` (
  `id` VARCHAR(191) NOT NULL, `disputeNo` VARCHAR(191) NOT NULL, `organizationId` VARCHAR(191) NOT NULL,
  `attendanceId` VARCHAR(191) NOT NULL, `employeeId` VARCHAR(191) NOT NULL,
  `issueType` ENUM('MISSING_CLOCK_IN','MISSING_CLOCK_OUT','SYSTEM_ERROR','WRONG_STATUS','OTHER') NOT NULL,
  `description` TEXT NOT NULL, `claimedClockIn` DATETIME(3) NULL, `claimedClockOut` DATETIME(3) NULL,
  `status` ENUM('PENDING','APPROVED','REJECTED') NOT NULL DEFAULT 'PENDING', `resolutionNote` TEXT NULL,
  `resolvedById` VARCHAR(191) NULL, `resolvedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `AttendanceDispute_disputeNo_key`(`disputeNo`), PRIMARY KEY (`id`),
  CONSTRAINT `AttendanceDispute_attendanceId_fkey` FOREIGN KEY (`attendanceId`) REFERENCES `Attendance`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `AttendanceDispute_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX `Employee_org_lifecycle_hireDate_idx` ON `Employee`(`organizationId`, `lifecycleStatus`, `hireDate`);
CREATE INDEX `Employee_org_department_status_idx` ON `Employee`(`organizationId`, `departmentId`, `status`);
CREATE INDEX `EmployeeDocument_org_employee_idx` ON `EmployeeDocument`(`organizationId`, `employeeId`);
CREATE INDEX `EmployeeDocument_org_type_idx` ON `EmployeeDocument`(`organizationId`, `documentType`);
CREATE INDEX `EmployeeStatusHistory_org_employee_created_idx` ON `EmployeeStatusHistory`(`organizationId`, `employeeId`, `createdAt`);
CREATE INDEX `AttendanceDispute_org_status_created_idx` ON `AttendanceDispute`(`organizationId`, `status`, `createdAt`);
CREATE INDEX `AttendanceDispute_org_employee_idx` ON `AttendanceDispute`(`organizationId`, `employeeId`);
CREATE INDEX `AttendanceDispute_attendanceId_idx` ON `AttendanceDispute`(`attendanceId`);
