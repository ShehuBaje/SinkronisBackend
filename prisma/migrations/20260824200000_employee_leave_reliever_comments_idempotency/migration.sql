ALTER TABLE `LeaveRequest`
  ADD COLUMN `relieverEmployeeId` VARCHAR(191) NULL,
  ADD COLUMN `managerComment` TEXT NULL,
  ADD COLUMN `activeRequestKey` VARCHAR(191) NULL;

CREATE UNIQUE INDEX `LeaveRequest_activeRequestKey_key`
  ON `LeaveRequest`(`activeRequestKey`);

CREATE INDEX `LeaveRequest_org_reliever_idx`
  ON `LeaveRequest`(`organizationId`, `relieverEmployeeId`);

ALTER TABLE `LeaveRequest`
  ADD CONSTRAINT `LeaveRequest_relieverEmployeeId_fkey`
  FOREIGN KEY (`relieverEmployeeId`) REFERENCES `Employee`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;
