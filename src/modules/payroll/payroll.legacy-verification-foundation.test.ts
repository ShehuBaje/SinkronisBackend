import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { AUDIT_HASH_VERSION_V2, buildAuditHash, canonicalizeAuditMetadata, replayAuditHash } from "../admin/admin.audit";
import { freezeEligibleLoanRecoveries, projectLoanVerification } from "./payroll.service";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const money = (value: number) => new Prisma.Decimal(value);
const baseLoan = (overrides: Record<string, unknown> = {}) => ({
  id: "loan-a", status: "ACTIVE", origin: "LEGACY_UNCONFIRMED", confirmationStatus: "LEGACY_UNCONFIRMED",
  outstanding: money(100000), currency: null, recoveryStartDate: null, issuedAt: new Date("2026-01-01"),
  employee: { status: "ACTIVE", lifecycleStatus: "CONFIRMED", payrollEnrollment: { isActive: true }, payrollPayee: { type: "PERMANENT", status: "ACTIVE", deletedAt: null }, salaryStructures: [{ id: "salary" }] },
  legacyVerifications: [], _count: { legacyVerifications: 0 }, ...overrides
});

test("migration 81 is additive and never mutates historical financial rows", () => {
  const sql = read("prisma/migrations/20261009100000_legacy_loan_verification_foundation/migration.sql");
  assert.match(sql, /CREATE TABLE `LegacyLoanVerification`/);
  assert.match(sql, /ADD COLUMN `hashVersion`/);
  assert.doesNotMatch(sql, /UPDATE\s+`?LoanAdvance/i);
  assert.doesNotMatch(sql, /INSERT\s+INTO\s+`?(LoanAdvance|LoanRepayment|LoanRecoveryApplication|WalletTransaction|FinancialSettlement|PayrollRun|Payslip)/i);
  assert.doesNotMatch(sql, /RolePermission/);
});

test("restricted confirmation permission is registered but excluded from automatic grants", () => {
  const permissions = read("src/modules/auth/permissions.ts");
  const sync = read("src/db/sync-permissions.ts");
  const seed = read("prisma/seed.ts");
  const auth = read("src/modules/auth/auth.service.ts");
  assert.match(permissions, /payroll:loans:confirm-legacy/);
  assert.match(permissions, /restrictedPermissions/);
  assert.match(sync, /restrictedPermissionSet/);
  assert.match(seed, /notIn: \[\.\.\.restrictedPermissions\]/);
  assert.match(auth, /notIn: \[\.\.\.restrictedPermissions\]/);
});

test("legacy read projection is truthful, read-only and recovery fail-closed", () => {
  const loan = baseLoan();
  const before = JSON.stringify(loan);
  const projection = projectLoanVerification(loan, new Date("2026-10-09"));
  assert.deepEqual(projection, {
    verificationStatus: "UNVERIFIED", verificationAttemptCount: 0, evidencePresent: false,
    evidenceCompleteness: "MISSING_VERIFICATION", reconciliationRequired: false, recoveryEligible: false,
    recoveryIneligibilityReasons: ["LOAN_ORIGIN_UNCONFIRMED", "LOAN_CONFIRMATION_UNCONFIRMED", "RECOVERY_START_MISSING"]
  });
  assert.equal(JSON.stringify(loan), before);
  assert.equal(freezeEligibleLoanRecoveries([loan], new Date("2026-10-31")).length, 0);
});

test("CLOSED_EARLY and inactive employee remain recovery-ineligible independently", () => {
  const projection = projectLoanVerification(baseLoan({ status: "CLOSED_EARLY", origin: "EXTERNAL_MANUAL", confirmationStatus: "CONFIRMED", currency: "NGN", recoveryStartDate: new Date("2026-01-01"), employee: { status: "SUSPENDED", lifecycleStatus: "CONFIRMED", payrollEnrollment: { isActive: false }, payrollPayee: { type: "PERMANENT", status: "INACTIVE", deletedAt: null }, salaryStructures: [{ id: "salary" }] } }), new Date("2026-10-09"));
  assert.equal(projection.recoveryEligible, false);
  assert.deepEqual(projection.recoveryIneligibilityReasons, ["LOAN_STATUS_CLOSED_EARLY", "EMPLOYEE_PAYROLL_INELIGIBLE", "PAYROLL_ENROLLMENT_INACTIVE", "PERMANENT_PAYEE_INACTIVE"]);
});

test("V2 audit metadata canonicalizes Date and nested JSON for independent replay", () => {
  const metadata = { happenedAt: new Date("2026-10-09T10:00:00.000Z"), nested: { z: null, list: [2, { when: new Date("2026-10-09T11:00:00.000Z") }] }, omitted: undefined } as never;
  const canonical = canonicalizeAuditMetadata(metadata);
  assert.deepEqual(canonical, { happenedAt: "2026-10-09T10:00:00.000Z", nested: { z: null, list: [2, { when: "2026-10-09T11:00:00.000Z" }] } });
  const row = { organizationId: "org", actorUserId: "user", action: "TEST", resource: "RESOURCE", resourceId: "id", summary: "summary", metadata: canonical, sequence: 2, previousHash: "a".repeat(64), createdAt: new Date("2026-10-09T12:00:00.000Z"), hashVersion: AUDIT_HASH_VERSION_V2 };
  assert.equal(replayAuditHash(row), buildAuditHash(row));
});

test("Swagger exposes additive read fields and no verification CRUD route", () => {
  const swagger = read("src/config/swagger.ts");
  for (const field of ["verificationStatus", "verificationAttemptCount", "evidencePresent", "evidenceCompleteness", "reconciliationRequired", "recoveryEligible", "recoveryIneligibilityReasons"]) assert.match(swagger, new RegExp(field));
  assert.doesNotMatch(swagger, /legacy-verifications[`"']/);
  assert.match(swagger, /no public confirmation or verification mutation route exists/i);
});
