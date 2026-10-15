import assert from "node:assert/strict";
import test from "node:test";
import { env, envSchema } from "../config/env";
import { assertIndependentFinancialActor, durablePayrollCreatorId, financialActionEligibility } from "./financial-approval-policy";

test("financial approval enforcement configuration is explicit and fail-closed", () => {
  assert.equal(envSchema.safeParse({ ...process.env, DATABASE_URL: "mysql://test:test@localhost:3306/test", JWT_ACCESS_SECRET: "a".repeat(24), JWT_REFRESH_SECRET: "b".repeat(24), FINANCIAL_APPROVAL_ENFORCEMENT_MODE: "INVALID" }).success, false);
});

test("maker/checker eligibility matches mutation identity rules", () => {
  const original = env.FINANCIAL_APPROVAL_ENFORCEMENT_MODE;
  try {
    (env as any).FINANCIAL_APPROVAL_ENFORCEMENT_MODE = "MAKER_CHECKER";
    const blocked = financialActionEligibility({ creatorId: "maker", actorId: "maker", status: "PENDING_APPROVAL", canApprove: true, canExecute: true });
    assert.equal(blocked.canApprove, false);
    assert.equal(blocked.approvalBlockedReason, "INDEPENDENT_APPROVER_REQUIRED");
    assert.throws(() => assertIndependentFinancialActor("maker", "maker", "DECISION"), (error: any) => error?.details?.errorCode === "FINANCIAL_SELF_APPROVAL_NOT_ALLOWED");
    const allowed = financialActionEligibility({ creatorId: "maker", actorId: "checker", status: "APPROVED", canApprove: true, canExecute: true });
    assert.equal(allowed.canInitiatePayment, true);
    assert.equal(durablePayrollCreatorId({ createdById: null, calculationInput: { requestedById: "legacy-maker" } }), "legacy-maker");
  } finally { (env as any).FINANCIAL_APPROVAL_ENFORCEMENT_MODE = original; }
});
