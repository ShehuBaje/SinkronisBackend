import test from "node:test";
import assert from "node:assert/strict";
import { billingPlans, getBillingPlanDefinition } from "./billing.catalog";
import { deriveSubscriptionStatus, isRenewalReminderDue, passesLuhn } from "./billing.rules";

test("catalog exposes only the four modular plans at authoritative prices", () => {
  assert.deepEqual(billingPlans.map(({ key, monthlyCost }) => [key, monthlyCost]), [["hris", 80000], ["payroll", 10000], ["accounting", 80000], ["all-in-one", 150000]]);
  assert.deepEqual(billingPlans.map(({ key, pricingModel }) => [key, pricingModel]), [["hris", "FIXED"], ["payroll", "FIXED"], ["accounting", "FIXED"], ["all-in-one", "FIXED_BUNDLE"]]);
});

test("each selected plan has one recurring price and plan-derived entitlements", () => {
  assert.deepEqual(getBillingPlanDefinition("hris")?.includedModules, ["hris"]);
  assert.deepEqual(getBillingPlanDefinition("payroll")?.includedModules, ["payroll"]);
  assert.deepEqual(getBillingPlanDefinition("accounting")?.includedModules, ["accounting"]);
  const bundle = getBillingPlanDefinition("all-in-one")!;
  assert.equal(bundle.monthlyCost, 150000);
  assert.deepEqual(bundle.includedModules, ["hris", "payroll", "accounting"]);
});

test("subscription lifecycle applies verified activation, expiration and period-end cancellation", () => {
  const now = new Date("2026-07-20T00:00:00Z"); const renewalDate = new Date("2026-07-20T00:00:00Z");
  assert.equal(deriveSubscriptionStatus({ status: "PENDING", now, renewalDate: new Date("2026-08-01"), cancelAtPeriodEnd: false, paymentVerifiedAt: now }), "ACTIVE");
  assert.equal(deriveSubscriptionStatus({ status: "ACTIVE", now, renewalDate, cancelAtPeriodEnd: false }), "EXPIRED");
  assert.equal(deriveSubscriptionStatus({ status: "ACTIVE", now, renewalDate, cancelAtPeriodEnd: true }), "CANCELLED");
});

test("renewal reminders are due on exactly day fifteen and card numbers use Luhn", () => {
  assert.equal(isRenewalReminderDue(new Date("2026-08-04T00:00:00Z"), new Date("2026-07-20T12:00:00Z")), true);
  assert.equal(isRenewalReminderDue(new Date("2026-08-04T00:00:00Z"), new Date("2026-07-21T00:00:00Z")), false);
  assert.equal(passesLuhn("4111111111111111"), true); assert.equal(passesLuhn("4111111111111112"), false);
});
