import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { assertFinancialCurrency, normalizeFinancialCurrency, spendableBalance } from "./wallet-integrity";

test("financial currency normalization is stable and mismatches fail closed", () => {
  assert.equal(normalizeFinancialCurrency(" ngn "), "NGN");
  assert.equal(assertFinancialCurrency("ngn", "NGN"), "NGN");
  assert.throws(() => assertFinancialCurrency("USD", "NGN"), /currency does not match/i);
});

test("spendable balance uses decimal subtraction without a Number round-trip", () => {
  assert.equal(spendableBalance({ balance: new Prisma.Decimal("100.10"), reservedBalance: new Prisma.Decimal("80.09") }).toString(), "20.01");
  assert.equal(new Prisma.Decimal("0.1").add("0.2").toString(), "0.3");
});
