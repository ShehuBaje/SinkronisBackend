import test from "node:test";
import assert from "node:assert/strict";
import { revenueContributionPercentage, sumMoney, toMinorUnits } from "./pricing.service";

test("money calculations use integer minor units and preserve decimal precision", () => {
  assert.equal(toMinorUnits(80000.25), 8_000_025);
  assert.equal(sumMoney([80000.25, 10000.1, 0.2]), 90000.55);
});

test("revenue contribution is rounded to two decimals and handles zero revenue", () => {
  assert.equal(revenueContributionPercentage(1, 3), 33.33);
  assert.equal(revenueContributionPercentage(0, 0), 0);
});

test("All-in-One revenue remains a distinct component and is not allocated to included modules", () => {
  const components = [
    { key: "all-in-one", monthlyRevenue: 150000 },
    { key: "hris", monthlyRevenue: 80000 },
    { key: "payroll", monthlyRevenue: 10000 }
  ];
  const revenue = (key: string) => sumMoney(components.filter((component) => component.key === key).map((component) => component.monthlyRevenue));
  assert.equal(revenue("all-in-one"), 150000);
  assert.equal(revenue("hris"), 80000);
  assert.equal(sumMoney(components.map((component) => component.monthlyRevenue)), 240000);
});
