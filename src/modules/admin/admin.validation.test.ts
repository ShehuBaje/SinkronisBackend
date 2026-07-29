import test from "node:test";
import assert from "node:assert/strict";
import {
  brandingSettingsSchema,
  localeSettingsSchema,
  myPlanAddCardSchema,
  myPlanChangeSchema,
  myPlanPaymentMethodSchema,
  organizationDeletionRequestSchema
} from "./admin.validation";

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
