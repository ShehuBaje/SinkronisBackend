ALTER TABLE `Attendance`
  ADD COLUMN `attendanceDate` CHAR(10) NULL;

CREATE UNIQUE INDEX `Attendance_org_employee_local_date_key`
  ON `Attendance`(`organizationId`, `employeeId`, `attendanceDate`);
