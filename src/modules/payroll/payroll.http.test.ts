import assert from "node:assert/strict";
import test from "node:test";
import jwt from "jsonwebtoken";
import { app } from "../../app";
import { env } from "../../config/env";
import { prisma } from "../../core/prisma";
import { isOrganizationModuleEnabled } from "../billing/module-access.service";
import { payrollRouter } from "./payroll.routes";

const enabled = process.env.RUN_PAYROLL_HTTP_INTEGRATION === "true";

test("authenticated Payroll Settings HTTP flow", { skip: !enabled }, async () => {
  const candidates = await prisma.user.findMany({
    where: { isActive: true, isPlatformAdmin: false, organization: { status: "ACTIVE" }, role: { isSystem: true, name: "Owner" } },
    select: { id: true, organizationId: true }, take: 50
  });
  let actor: (typeof candidates)[number] | undefined;
  for (const candidate of candidates) if (await isOrganizationModuleEnabled(candidate.organizationId, "payroll")) { actor = candidate; break; }
  assert.ok(actor, "an active tenant Owner fixture is required");
  const token = jwt.sign({ organizationId: actor.organizationId }, env.JWT_ACCESS_SECRET, { subject: actor.id, expiresIn: "10m" });
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}${env.API_PREFIX}/payroll/settings`;
  const request = async (path = "", init: RequestInit = {}) => {
    const response = await fetch(`${base}${path}`, { ...init, headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...init.headers } });
    const body = await response.json();
    return { response, body };
  };
  const suffix = Date.now().toString(36);
  let allowanceId: string | undefined;
  let deductionId: string | undefined;
  try {
    for (const path of ["", "/pay-period", "/allowance-types", "/deduction-types", "/statutory-rates"]) {
      const result = await request(path);
      assert.equal(result.response.status, 200, `${path || "/"}: ${JSON.stringify(result.body)}`);
    }
    const invalidDay = await request("/pay-period", { method: "PUT", body: JSON.stringify({ payFrequency: "MONTHLY", defaultPayDay: 32 }) });
    assert.equal(invalidDay.response.status, 400);
    const current = await request("/pay-period");
    const currentData = current.body.data ?? current.body;
    const payPeriod = await request("/pay-period", { method: "PUT", body: JSON.stringify({ payFrequency: "MONTHLY", defaultPayDay: currentData.defaultPayDay }) });
    assert.equal(payPeriod.response.status, 200, JSON.stringify(payPeriod.body));
    const allowance = await request("/allowance-types", { method: "POST", body: JSON.stringify({ name: `HTTP Allowance ${suffix}`, taxTreatment: "TAX_EXEMPT" }) });
    assert.equal(allowance.response.status, 201, JSON.stringify(allowance.body));
    allowanceId = (allowance.body.data ?? allowance.body).id;
    const deduction = await request("/deduction-types", { method: "POST", body: JSON.stringify({ name: `HTTP Deduction ${suffix}` }) });
    assert.equal(deduction.response.status, 201, JSON.stringify(deduction.body));
    deductionId = (deduction.body.data ?? deduction.body).id;
    assert.equal((await request(`/allowance-types/${allowanceId}`, { method: "DELETE" })).response.status, 200);
    allowanceId = undefined;
    assert.equal((await request(`/deduction-types/${deductionId}`, { method: "DELETE" })).response.status, 200);
    deductionId = undefined;
  } finally {
    if (allowanceId) await request(`/allowance-types/${allowanceId}`, { method: "DELETE" });
    if (deductionId) await request(`/deduction-types/${deductionId}`, { method: "DELETE" });
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await prisma.$disconnect();
  }
});

test("every registered Payroll endpoint is authenticated, entitled, and free of 5xx responses", { skip: !enabled }, async () => {
  const candidates = await prisma.user.findMany({ where: { isActive: true, isPlatformAdmin: false, organization: { status: "ACTIVE" }, role: { isSystem: true, name: "Owner" } }, select: { id: true, organizationId: true }, take: 50 });
  let actor: (typeof candidates)[number] | undefined;
  for (const candidate of candidates) if (await isOrganizationModuleEnabled(candidate.organizationId, "payroll")) { actor = candidate; break; }
  assert.ok(actor, "an active Payroll-entitled tenant Owner fixture is required");
  const token = jwt.sign({ organizationId: actor.organizationId }, env.JWT_ACCESS_SECRET, { subject: actor.id, expiresIn: "10m" });
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address(); assert.ok(address && typeof address === "object");
  const root = `http://127.0.0.1:${address.port}${env.API_PREFIX}/payroll`;
  const missingId = "ck1234567890123456789012";
  const operations = (payrollRouter as any).stack.filter((layer: any) => layer.route).flatMap((layer: any) => Object.keys(layer.route.methods).map((method) => ({ method: method.toUpperCase(), path: String(layer.route.path).replace(/:[A-Za-z]+/g, missingId) })));
  const failures: string[] = [];
  try {
    for (let offset = 0; offset < operations.length; offset += 4) {
      await Promise.all(operations.slice(offset, offset + 4).map(async ({ method, path }: { method: string; path: string }) => {
        const response = await fetch(`${root}${path}`, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, ...(method === "GET" || method === "HEAD" ? {} : { body: "{}" }) });
        if (response.status >= 500 || response.status === 401 || response.status === 403) failures.push(`${method} ${path} -> ${response.status}: ${(await response.text()).slice(0, 300)}`);
      }));
    }
    assert.deepEqual(failures, []);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await prisma.$disconnect();
  }
});
