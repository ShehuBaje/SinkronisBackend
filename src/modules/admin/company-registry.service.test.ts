import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { CompanyRegistryUnavailableError, companyNamesMatch, createCacVasProvider, getCompanyRegistryProvider, normalizeRegistrationNumber } from "./company-registry.service";

const configuration = { baseUrl: "https://vasapp.cac.gov.ng", apiKey: "test-secret-never-logged", timeoutMs: 5000 };
const response = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

test("normalizes supported CAC registration formats", () => assert.equal(normalizeRegistrationNumber("rc- 1234567"), "RC1234567"));
test("matches harmless registered company suffix variations conservatively", () => {
  assert.equal(companyNamesMatch("Example Technologies Ltd.", "EXAMPLE TECHNOLOGIES LIMITED"), true);
  assert.equal(companyNamesMatch("Example Technologies Limited", "Different Technologies Limited"), false);
});

test("CAC adapter sends the confirmed contract exactly once and tolerates additional fields", async () => {
  let calls = 0;
  const provider = createCacVasProvider(configuration, async (url, init) => {
    calls += 1;
    assert.equal(url, "https://vasapp.cac.gov.ng/api/vas/validation/company/rc");
    assert.equal(init?.method, "POST");
    assert.equal((init?.headers as Record<string, string>).X_API_KEY, configuration.apiKey);
    assert.deepEqual(JSON.parse(String(init?.body)), { rc_number: "7068861" });
    return response(200, { statusCode: 200, status: "OK", message: "company data", data: { rc_number: "7068861", entity_name: "Example Technologies Limited", entity_type: "BUSINESS_NAME_FIRM", future_field: "ignored" } });
  });
  const result = await provider.verifyRegistration("RC7068861");
  assert.equal(calls, 1);
  assert.equal(result.verified, true);
  assert.equal(result.registeredName, "Example Technologies Limited");
  assert.equal(companyNamesMatch("Example Technologies Ltd", result.registeredName!), true);
  assert.equal(companyNamesMatch("Different Company Limited", result.registeredName!), false);
});

for (const [status, reason, retryable] of [
  [401, "CAC_AUTHENTICATION_FAILED", false],
  [403, "CAC_AUTHORIZATION_FAILED", false],
  [408, "CAC_TIMEOUT", true],
  [429, "CAC_RATE_LIMITED", true],
  [500, "CAC_PROVIDER_UNAVAILABLE", true],
  [502, "CAC_PROVIDER_UNAVAILABLE", true],
  [503, "CAC_PROVIDER_UNAVAILABLE", true],
] as const) {
  test(`CAC ${status} is a safe provider-unavailable failure`, async () => {
    const provider = createCacVasProvider(configuration, async () => response(status, status === 403 ? { statusCode: 403, status: "FORBIDDEN", message: "forbidden access", error: "permission denied", success: false, errors: null } : {}));
    await assert.rejects(() => provider.verifyRegistration("RC7068861"), (error: CompanyRegistryUnavailableError) => {
      assert.equal(error.reasonCode, reason);
      assert.equal(error.retryable, retryable);
      assert.equal(error.externalStatusCode, status);
      assert.equal(error.message.includes(configuration.apiKey), false);
      return true;
    });
  });
}

test("CAC 400 and 404 are definitive failed lookups, not mismatches", async () => {
  for (const status of [400, 404]) {
    const result = await createCacVasProvider(configuration, async () => response(status, {})).verifyRegistration("RC7068861");
    assert.equal(result.verified, false);
    assert.equal(result.registeredName, undefined);
  }
});

test("timeout/network failure and malformed 200 never verify a company", async () => {
  const unavailable = createCacVasProvider(configuration, async () => { throw new Error("timeout"); });
  await assert.rejects(() => unavailable.verifyRegistration("RC7068861"), (error: CompanyRegistryUnavailableError) => error.reasonCode === "CAC_NETWORK_OR_TIMEOUT");
  const malformed = createCacVasProvider(configuration, async () => response(200, { statusCode: 200, data: { rc_number: "RC7068861" } }));
  await assert.rejects(() => malformed.verifyRegistration("RC7068861"), (error: CompanyRegistryUnavailableError) => error.reasonCode === "CAC_MALFORMED_RESPONSE");
});

test("returned registration number must match the requested number", async () => {
  const provider = createCacVasProvider(configuration, async () => response(200, { statusCode: 200, data: { rc_number: "RC999", entity_name: "Example Technologies Limited" } }));
  await assert.rejects(() => provider.verifyRegistration("RC7068861"), (error: CompanyRegistryUnavailableError) => error.reasonCode === "CAC_REGISTRATION_NUMBER_MISMATCH");
});

test("provider selection remains disabled when not selected", () => {
  const old = process.env.COMPANY_REGISTRY_PROVIDER;
  try { process.env.COMPANY_REGISTRY_PROVIDER = "NONE"; assert.equal(getCompanyRegistryProvider().provider, null); }
  finally { if (old === undefined) delete process.env.COMPANY_REGISTRY_PROVIDER; else process.env.COMPANY_REGISTRY_PROVIDER = old; }
});

test("missing CAC configuration prevents any provider construction", () => {
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

test("CAC endpoint preserves authentication, tenant scoping, RBAC, and verification reset boundaries", () => {
  const appSource = fs.readFileSync("src/app.ts", "utf8");
  const routesSource = fs.readFileSync("src/modules/admin/admin.routes.ts", "utf8");
  const serviceSource = fs.readFileSync("src/modules/admin/admin.service.ts", "utf8");
  assert.match(appSource, /app\.use\(env\.API_PREFIX, authenticate/);
  assert.match(appSource, /admin`, restrictImpersonatedSensitiveActions, requireTenant, adminRouter/);
  assert.match(routesSource, /"\/organization\/cac-verification"[\s\S]*authorize\("admin:organization:update"\)[\s\S]*cacVerificationSchema/);
  assert.match(serviceSource, /findUniqueOrThrow\(\{ where: \{ id: req\.organizationId \}/);
  assert.match(serviceSource, /identityChanged[\s\S]*cacVerificationStatus: "UNVERIFIED"/);
  assert.doesNotMatch(fs.readFileSync("src/modules/admin/company-registry.service.ts", "utf8"), /console\.(?:log|error|warn)/);
});
