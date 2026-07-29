import test from "node:test";
import assert from "node:assert/strict";
import { platformAnnouncementTypes, tenantNotificationChannelKeys, tenantNotificationModuleKeys } from "./admin.interface";
import { announcementListQuerySchema, notificationCategoryParamsSchema, notificationToggleSchema } from "./admin.validation";
import { deriveNotificationModuleToggleState } from "./admin.service";

test("notification configuration exposes independent extensible channels and supported modules", () => {
  assert.deepEqual(tenantNotificationChannelKeys, ["IN_APP", "EMAIL"]);
  assert.deepEqual(tenantNotificationModuleKeys, ["hris", "payroll", "accounting"]);
  assert.deepEqual(platformAnnouncementTypes, ["FEATURE", "MAINTENANCE", "SECURITY", "UPDATE"]);
});

test("module master-toggle state distinguishes enabled, disabled and partial modules", () => {
  assert.deepEqual(deriveNotificationModuleToggleState([true, true]), { moduleStatus: "ENABLED", toggleAll: true });
  assert.deepEqual(deriveNotificationModuleToggleState([false, false]), { moduleStatus: "DISABLED", toggleAll: false });
  assert.deepEqual(deriveNotificationModuleToggleState([true, false]), { moduleStatus: "PARTIAL", toggleAll: false });
});

test("toggle and path DTOs reject invalid operations", () => {
  assert.equal(notificationToggleSchema.safeParse({ enabled: "yes" }).success, false);
  assert.equal(notificationToggleSchema.safeParse({ enabled: true, unexpected: true }).success, false);
  assert.equal(notificationCategoryParamsSchema.safeParse({ channelKey: "SMS", moduleKey: "hris", categoryId: "hris-reminders" }).success, false);
  assert.equal(notificationCategoryParamsSchema.safeParse({ channelKey: "EMAIL", moduleKey: "hris", categoryId: "hris-reminders" }).success, true);
});

test("announcement filters default to newest, all read states, and bounded pagination", () => {
  assert.deepEqual(announcementListQuerySchema.parse({}), { page: 1, limit: 20, readStatus: "ALL", sort: "NEWEST" });
  assert.equal(announcementListQuerySchema.safeParse({ type: "OTHER" }).success, false);
  assert.equal(announcementListQuerySchema.safeParse({ limit: 101 }).success, false);
});
