import assert from "node:assert/strict";
import test from "node:test";
import type { Request } from "express";
import { prisma } from "../../core/prisma";
import { HttpError } from "../../core/http-error";
import { requireEffectiveModuleAccess } from "../../middleware/module-access.middleware";
import { authorize } from "../../middleware/rbac.middleware";
import type { AuthUser } from "../../types";
import { downloadAccountingExport, getAccountingExportStatus } from "./accounting.service";

const user = (id: string, organizationId: string, permissions: AuthUser["permissions"], impersonated = false): AuthUser => ({
  id,
  organizationId,
  email: `${id}@example.test`,
  roleId: `role-${id}`,
  isPlatformAdmin: false,
  permissions,
  ...(impersonated ? { impersonation: { sessionId: "impersonation", platformAdminUserId: "platform-admin", platformAdminSessionId: "platform-session" } } : {}),
});

const exportsView = "accounting:exports:view" as const;
const invoicesView = "accounting:invoices:view" as const;
const expensesView = "accounting:expenses:view" as const;
const future = () => new Date(Date.now() + 60_000);
const past = () => new Date(Date.now() - 60_000);

type ExportRecord = {
  id: string;
  organizationId: string;
  requestedByUserId: string;
  type: "INVOICES" | "EXPENSES";
  status: string;
  fileName: string | null;
  fileReference: string | null;
  fileSize: number | null;
  requestedAt: Date;
  processingAt: Date | null;
  completedAt: Date | null;
  failedAt: Date | null;
  expiresAt: Date | null;
  errorMessage: string | null;
};

const record = (overrides: Partial<ExportRecord> = {}): ExportRecord => ({
  id: "export-1",
  organizationId: "tenant-a",
  requestedByUserId: "user-a",
  type: "INVOICES",
  status: "COMPLETED",
  fileName: "accounting-invoices-export-1.csv",
  fileReference: "accounting-exports/tenant-a/export-1.csv",
  fileSize: 100,
  requestedAt: new Date("2026-09-28T10:00:00.000Z"),
  processingAt: new Date("2026-09-28T10:01:00.000Z"),
  completedAt: new Date("2026-09-28T10:02:00.000Z"),
  failedAt: null,
  expiresAt: future(),
  errorMessage: null,
  ...overrides,
});

const matches = (row: ExportRecord, where: any) => {
  if (where.id !== row.id || where.organizationId !== row.organizationId || where.requestedByUserId !== row.requestedByUserId) return false;
  if (where.status && where.status !== row.status) return false;
  if (where.expiresAt?.gt && (!row.expiresAt || row.expiresAt <= where.expiresAt.gt)) return false;
  return true;
};

const withExportRecord = async (row: ExportRecord, run: () => Promise<void>) => {
  const original = prisma.accountingExportJob.findFirst;
  (prisma.accountingExportJob as any).findFirst = async ({ where }: any) => matches(row, where) ? row : null;
  try {
    await run();
  } finally {
    (prisma.accountingExportJob as any).findFirst = original;
  }
};

const expectHttpError = async (action: () => Promise<unknown>, statusCode: number) => {
  await assert.rejects(action, (error: unknown) => error instanceof HttpError && error.statusCode === statusCode);
};

test("requester can retrieve own export status with the current source permission", async () => {
  await withExportRecord(record(), async () => {
    const status = await getAccountingExportStatus("tenant-a", "export-1", user("user-a", "tenant-a", [exportsView, invoicesView]));
    assert.equal(status.id, "export-1");
    assert.equal(status.available, true);
  });
  await withExportRecord(record({ type: "EXPENSES" }), async () => {
    const status = await getAccountingExportStatus("tenant-a", "export-1", user("user-a", "tenant-a", [exportsView, expensesView]));
    assert.equal(status.type, "EXPENSES");
  });
});

test("requester can download own completed unexpired export", async () => {
  await withExportRecord(record(), async () => {
    let reads = 0;
    const file = await downloadAccountingExport("tenant-a", "export-1", user("user-a", "tenant-a", [exportsView, invoicesView]), async (reference) => {
      reads += 1;
      assert.equal(reference, "accounting-exports/tenant-a/export-1.csv");
      return Buffer.from("csv");
    });
    assert.equal(file.fileName, "accounting-invoices-export-1.csv");
    assert.equal(reads, 1);
  });
});

test("same-tenant different requester cannot inspect or download and storage is not read", async () => {
  await withExportRecord(record(), async () => {
    const other = user("user-b", "tenant-a", [exportsView, invoicesView]);
    let reads = 0;
    await expectHttpError(() => getAccountingExportStatus("tenant-a", "export-1", other), 404);
    await expectHttpError(() => downloadAccountingExport("tenant-a", "export-1", other, async () => { reads += 1; return Buffer.from("unexpected"); }), 404);
    assert.equal(reads, 0);
  });
});

test("cross-tenant user cannot inspect or download an export", async () => {
  await withExportRecord(record(), async () => {
    const outsider = user("user-a", "tenant-b", [exportsView, invoicesView]);
    await expectHttpError(() => getAccountingExportStatus("tenant-b", "export-1", outsider), 404);
    await expectHttpError(() => downloadAccountingExport("tenant-b", "export-1", outsider, async () => Buffer.from("unexpected")), 404);
  });
});

test("current invoice permission is required for invoice status and download without storage reads", async () => {
  await withExportRecord(record(), async () => {
    const permissionsRemoved = user("user-a", "tenant-a", [exportsView]);
    let reads = 0;
    await expectHttpError(() => getAccountingExportStatus("tenant-a", "export-1", permissionsRemoved), 403);
    await expectHttpError(() => downloadAccountingExport("tenant-a", "export-1", permissionsRemoved, async () => { reads += 1; return Buffer.from("unexpected"); }), 403);
    assert.equal(reads, 0);
  });
});

test("current expense permission is required for expense status and download without storage reads", async () => {
  await withExportRecord(record({ type: "EXPENSES" }), async () => {
    const wrongSourcePermission = user("user-a", "tenant-a", [exportsView, invoicesView]);
    let reads = 0;
    await expectHttpError(() => getAccountingExportStatus("tenant-a", "export-1", wrongSourcePermission), 403);
    await expectHttpError(() => downloadAccountingExport("tenant-a", "export-1", wrongSourcePermission, async () => { reads += 1; return Buffer.from("unexpected"); }), 403);
    assert.equal(reads, 0);
  });
});

test("pending, failed, and expired exports cannot be downloaded", async () => {
  const requester = user("user-a", "tenant-a", [exportsView, invoicesView]);
  for (const unavailable of [record({ status: "PENDING", fileReference: null, fileName: null }), record({ status: "FAILED", failedAt: new Date(), fileReference: null, fileName: null }), record({ status: "EXPIRED", expiresAt: past(), fileReference: null })]) {
    await withExportRecord(unavailable, async () => {
      let reads = 0;
      await expectHttpError(() => downloadAccountingExport("tenant-a", "export-1", requester, async () => { reads += 1; return Buffer.from("unexpected"); }), 404);
      assert.equal(reads, 0);
    });
  }
});

test("route-level exports:view permission remains mandatory", () => {
  const middleware = authorize(exportsView);
  let received: unknown;
  middleware({ user: user("user-a", "tenant-a", [invoicesView]) } as Request, {} as any, (error?: unknown) => { received = error; });
  assert.ok(received instanceof HttpError);
  assert.equal((received as HttpError).statusCode, 403);
});

test("direct Platform Admin tenant module access remains denied", async () => {
  const middleware = requireEffectiveModuleAccess("accounting");
  let received: unknown;
  await middleware({ user: { ...user("platform-admin", "platform", [exportsView, invoicesView]), isPlatformAdmin: true } } as Request, {} as any, (error?: unknown) => { received = error; });
  assert.ok(received instanceof HttpError);
  assert.equal((received as HttpError).statusCode, 403);
});

test("impersonation does not bypass requester ownership", async () => {
  await withExportRecord(record(), async () => {
    const impersonatedOwner = user("tenant-owner", "tenant-a", [exportsView, invoicesView, expensesView], true);
    await expectHttpError(() => getAccountingExportStatus("tenant-a", "export-1", impersonatedOwner), 404);
    await expectHttpError(() => downloadAccountingExport("tenant-a", "export-1", impersonatedOwner, async () => Buffer.from("unexpected")), 404);
  });
});
