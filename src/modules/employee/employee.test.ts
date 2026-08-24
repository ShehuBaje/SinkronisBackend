import assert from "node:assert/strict";
import test from "node:test";
import { actionItemPriority, dashboardAttendanceState, expectedWorkdaysThrough, inspectProfilePhoto, maskBankAccountNumber } from "./employee.service";
import { bankUpdateRequestSchema, employeeDashboardQuerySchema, updateEmployeePersonalDetailsSchema } from "./employee.validation";

test("dashboard attendance exposes empty, clocked-in, and clocked-out states", () => {
  const now = new Date("2026-08-24T12:00:00.000Z");
  assert.deepEqual(dashboardAttendanceState(null, now), { status: "NOT_CLOCKED_IN", clockInAt: null, clockOutAt: null, workedMinutes: 0, canClockIn: true, canClockOut: false });
  const clockInAt = new Date("2026-08-24T08:00:00.000Z");
  assert.equal(dashboardAttendanceState({ clockInAt, clockOutAt: null }, now).workedMinutes, 240);
  assert.deepEqual(dashboardAttendanceState({ clockInAt, clockOutAt: new Date("2026-08-24T10:30:00.000Z") }, now), { status: "CLOCKED_OUT", clockInAt, clockOutAt: new Date("2026-08-24T10:30:00.000Z"), workedMinutes: 150, canClockIn: false, canClockOut: false });
});

test("expected working days use the configured schedule and exclude approved leave", () => {
  const schedule = { monday: true, tuesday: true, wednesday: true, thursday: true, friday: true, saturday: false, sunday: false, workStartTime: "09:00", workEndTime: "17:00", breakDurationMinutes: 60 };
  assert.equal(expectedWorkdaysThrough("2026-08", "2026-08-07", schedule, new Set(["2026-08-05"])), 4);
});

test("action-required dashboard items sort ahead of informational items", () => {
  const now = new Date("2026-08-24T12:00:00.000Z");
  assert.ok(actionItemPriority({ status: "ACTION_REQUIRED", dueDate: null }, now) < actionItemPriority({ status: "INFORMATIONAL", dueDate: null }, now));
  assert.equal(actionItemPriority({ status: "ACTION_REQUIRED", dueDate: new Date("2026-08-23T00:00:00.000Z") }, now), 0);
});

test("dashboard validation rejects employee identity manipulation", () => {
  assert.equal(employeeDashboardQuerySchema.safeParse({}).success, true);
  assert.equal(employeeDashboardQuerySchema.safeParse({ employeeId: "another-employee" }).success, false);
});

test("personal detail validation whitelists self-service fields and rejects managed fields", () => {
  assert.equal(updateEmployeePersonalDetailsSchema.safeParse({ phoneNumber: "+2348012345678", personalEmail: "person@example.com" }).success, true);
  assert.equal(updateEmployeePersonalDetailsSchema.safeParse({ departmentId: "dept", baseSalary: 500000 }).success, false);
  assert.equal(updateEmployeePersonalDetailsSchema.safeParse({ personalEmail: "invalid" }).success, false);
});

test("bank update requests are strict and account masking never exposes the full account", () => {
  assert.equal(bankUpdateRequestSchema.safeParse({ bankCode: "058", bankName: "Supported Bank", accountNumber: "0123456789", accountName: "Employee Name", accountType: "SAVINGS" }).success, true);
  assert.deepEqual(maskBankAccountNumber("0123456789"), { last4: "6789", masked: "******6789" });
  assert.equal(JSON.stringify(maskBankAccountNumber("0123456789")).includes("0123456789"), false);
});

test("profile photo inspection checks file signatures instead of trusting MIME metadata", () => {
  const validPng = { mimetype: "image/png", buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]) } as Express.Multer.File;
  assert.doesNotThrow(() => inspectProfilePhoto(validPng));
  assert.throws(() => inspectProfilePhoto({ mimetype: "image/png", buffer: Buffer.from("not an image") } as Express.Multer.File));
});
