import assert from "node:assert/strict";
import test from "node:test";
import { companyNamesMatch, getCompanyRegistryProvider, normalizeRegistrationNumber } from "./company-registry.service";

test("normalizes supported CAC registration formats", () => assert.equal(normalizeRegistrationNumber("rc- 1234567"), "RC1234567"));
test("matches harmless registered company suffix variations conservatively", () => {
  assert.equal(companyNamesMatch("Example Technologies Ltd.", "EXAMPLE TECHNOLOGIES LIMITED"), true);
  assert.equal(companyNamesMatch("Example Technologies Limited", "Different Technologies Limited"), false);
});
test("does not pretend an official registry provider is configured", () => {
  const old = process.env.COMPANY_REGISTRY_PROVIDER;
  try { process.env.COMPANY_REGISTRY_PROVIDER = "NONE"; assert.equal(getCompanyRegistryProvider().provider, null); }
  finally { if (old === undefined) delete process.env.COMPANY_REGISTRY_PROVIDER; else process.env.COMPANY_REGISTRY_PROVIDER = old; }
});

test("reports missing CAC configuration instead of constructing a broken provider", () => {
  const oldProvider = process.env.COMPANY_REGISTRY_PROVIDER, oldBase = process.env.CAC_API_BASE_URL, oldKey = process.env.CAC_API_KEY;
  try {
    process.env.COMPANY_REGISTRY_PROVIDER = "CAC"; delete process.env.CAC_API_BASE_URL; delete process.env.CAC_API_KEY;
    assert.deepEqual(getCompanyRegistryProvider(), { provider: null, selected: "CAC", reason: "MISSING_CONFIGURATION", missing: ["CAC_API_BASE_URL", "CAC_API_KEY"] });
  } finally {
    if (oldProvider === undefined) delete process.env.COMPANY_REGISTRY_PROVIDER; else process.env.COMPANY_REGISTRY_PROVIDER = oldProvider;
    if (oldBase === undefined) delete process.env.CAC_API_BASE_URL; else process.env.CAC_API_BASE_URL = oldBase;
    if (oldKey === undefined) delete process.env.CAC_API_KEY; else process.env.CAC_API_KEY = oldKey;
  }
});
