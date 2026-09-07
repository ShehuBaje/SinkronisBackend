import test from "node:test";
import assert from "node:assert/strict";
import {
  brandingSettingsSchema,
  auditLogQuerySchema,
  localeSettingsSchema,
  myPlanAddCardSchema,
  myPlanChangeSchema,
  myPlanPaymentMethodSchema,
  organizationDeletionRequestSchema
} from "./admin.validation";
import { ipAllowlistEntryCreateSchema, securityTwoFactorSchema } from "./admin.validation";
import { userManagementUpdateUserSchema, workScheduleUpsertSchema } from "../common.schemas";

test("plan DTO rejects obsolete plans and defaults confirmation safely", () => {
  assert.equal(myPlanChangeSchema.safeParse({ planKey: "starter" }).success, false);
  assert.deepEqual(myPlanChangeSchema.parse({ planKey: "all-in-one" }), { planKey: "all-in-one", confirm: false, automaticRenewal: true });
});

test("card DTO enforces Luhn and default selection requires an owned card id", () => {
  assert.equal(myPlanAddCardSchema.safeParse({ cardNumber: "4111111111111112", cardHolderName: "Test Owner", expiryDate: "12/30", cvv: "123" }).success, false);
  assert.equal(myPlanAddCardSchema.safeParse({ cardNumber: "4111111111111111", cardHolderName: "Test Owner", expiryDate: "12/30", cvv: "123" }).success, true);
  assert.deepEqual(myPlanPaymentMethodSchema.parse({ paymentCardId: "card_1" }), { paymentCardId: "card_1" });
});

test("locale settings accept supported regional values and reject unsupported values", () => {
  assert.equal(localeSettingsSchema.safeParse({ timeZone: "Africa/Lagos", language: "fr", dateFormat: "YYYY-MM-DD", currency: "EUR" }).success, true);
  assert.equal(localeSettingsSchema.safeParse({ timeZone: "Lagos/WAT", language: "de", dateFormat: "YYYY", currency: "BTC" }).success, false);
});

test("branding requires a valid update and sanitizes link text", () => {
  assert.equal(brandingSettingsSchema.safeParse({ accentColor: "blue" }).success, false);
  assert.equal(brandingSettingsSchema.safeParse({}).success, false);
  assert.deepEqual(brandingSettingsSchema.parse({ accentColor: "#0F766E", linkText: "<b>Acme</b>" }), { accentColor: "#0F766E", linkText: "Acme" });
});

test("organization deletion requires the exact phrase, password, and bounded reason", () => {
  assert.equal(organizationDeletionRequestSchema.safeParse({ confirmationPhrase: "DELETE", password: "password123" }).success, false);
  assert.equal(organizationDeletionRequestSchema.safeParse({ confirmationPhrase: "DELETE ORGANIZATION", password: "password123", reason: "Workspace closure" }).success, true);
});

test("audit log accepts inclusive UI date ranges and rejects conflicting or reversed filters", () => {
  assert.equal(auditLogQuerySchema.safeParse({ from: "2026-01-01", to: "2026-01-31" }).success, true);
  assert.equal(auditLogQuerySchema.safeParse({ from: "2026-02-01", to: "2026-01-31" }).success, false);
  assert.equal(auditLogQuerySchema.safeParse({ from: "2026-01-01", dateFilter: "month", date: "2026-01" }).success, false);
  assert.equal(auditLogQuerySchema.safeParse({ from: "not-a-date" }).success, false);
});

const schedule = { monday: true, tuesday: true, wednesday: true, thursday: true, friday: true, saturday: false, sunday: false, workStartTime: "09:00", workEndTime: "17:00", breakDurationMinutes: 60 };
test("work schedule enforces a usable attendance baseline", () => {
  assert.equal(workScheduleUpsertSchema.safeParse(schedule).success, true);
  assert.equal(workScheduleUpsertSchema.safeParse({ ...schedule, monday: false, tuesday: false, wednesday: false, thursday: false, friday: false }).success, false);
  assert.equal(workScheduleUpsertSchema.safeParse({ ...schedule, workEndTime: "08:59" }).success, false);
  assert.equal(workScheduleUpsertSchema.safeParse({ ...schedule, breakDurationMinutes: 480 }).success, false);
});

test("IP allowlist accepts real IP/CIDR values and rejects malformed entries", () => {
  for (const value of ["192.0.2.10", "192.0.2.0/24", "2001:db8::1", "2001:db8::/32"]) assert.equal(ipAllowlistEntryCreateSchema.safeParse({ value }).success, true);
  for (const value of ["999.1.1.1", "192.0.2.0/33", "2001:db8::/129", "not-an-ip"]) assert.equal(ipAllowlistEntryCreateSchema.safeParse({ value }).success, false);
});

test("managed user access accepts explicit bounded module assignments", () => {
  assert.equal(userManagementUpdateUserSchema.safeParse({ moduleAccess: ["HRIS", "PAYROLL"] }).success, true);
  assert.equal(userManagementUpdateUserSchema.safeParse({ moduleAccess: ["UNKNOWN"] }).success, false);
});

test("two-factor policy cannot advertise unusable or contradictory enforcement", () => {
  const base = { twoFactorEnabled: true, enforceTwoFactorForAllUsers: true, allowAuthenticatorApp: true, allowSmsOtp: false, allowEmailOtp: false };
  assert.equal(securityTwoFactorSchema.safeParse(base).success, true);
  assert.equal(securityTwoFactorSchema.safeParse({ ...base, twoFactorEnabled: false }).success, false);
  assert.equal(securityTwoFactorSchema.safeParse({ ...base, allowAuthenticatorApp: false }).success, false);
});
