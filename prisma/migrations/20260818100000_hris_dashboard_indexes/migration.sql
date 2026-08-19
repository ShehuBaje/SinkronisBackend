CREATE INDEX `Attendance_organizationId_clockInAt_idx`
  ON `Attendance`(`organizationId`, `clockInAt`);

CREATE INDEX `Employee_organizationId_status_hireDate_idx`
  ON `Employee`(`organizationId`, `status`, `hireDate`);

CREATE INDEX `LeaveRequest_org_status_dates_idx`
  ON `LeaveRequest`(`organizationId`, `status`, `startDate`, `endDate`);
