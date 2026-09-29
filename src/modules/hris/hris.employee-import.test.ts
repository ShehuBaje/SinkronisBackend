import test from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { HttpError } from "../../core/http-error";
import type { AuthUser } from "../../types";
import { employeeImportHeaders, employeeImportTemplate, importEmployeesCsv, type EmployeeImportValidationError } from "./hris.service";

const organizationId = "organization-a";
const actor: AuthUser = { id: "user-a", organizationId, email: "admin@example.test", roleId: "role-a", isPlatformAdmin: false, permissions: ["hris:employees:create"] };
const header = employeeImportHeaders.join(",");
const minimalRow = "EMP-001,Amina,Yusuf,,amina@example.test,,,PROBATION,,,";
type ExistingEmployee = { organizationId: string; employeeNo: string; email: string };

const mockDb = (input: { departments?: Array<{ id: string; name: string }>; existing?: ExistingEmployee[]; transactionError?: Error } = {}) => {
  const state = { transactionCalls: 0, committed: [] as any[], auditCalls: 0, employeeQueries: [] as any[] };
  const db = {
    department: { findMany: async () => input.departments ?? [] },
    employee: {
      findMany: async (args: any) => {
        state.employeeQueries.push(args); const records = (input.existing ?? []).filter((record) => record.organizationId === args.where.organizationId);
        const employeeIds = new Set<string>(); const emails = new Set<string>();
        for (const condition of args.where.OR ?? []) { for (const value of condition.employeeNo?.in ?? []) employeeIds.add(value.toLowerCase()); for (const value of condition.email?.in ?? []) emails.add(value.toLowerCase()); }
        return records.filter((record) => employeeIds.has(record.employeeNo.toLowerCase()) || emails.has(record.email.toLowerCase())).map(({ employeeNo, email }) => ({ employeeNo, email }));
      },
      create: ({ data }: any) => ({ data })
    },
    $transaction: async (operations: Array<{ data: any }>) => { state.transactionCalls += 1; if (input.transactionError) throw input.transactionError; state.committed.push(...operations.map((operation) => operation.data)); return operations; }
  };
  return { db: db as unknown as Parameters<typeof importEmployeesCsv>[3] extends { db?: infer T } ? T : never, state, audit: async () => { state.auditCalls += 1; } };
};

const run = async (csv: string, input?: Parameters<typeof mockDb>[0]) => {
  const mock = mockDb(input); const result = await importEmployeesCsv(organizationId, Buffer.from(csv), actor, { db: mock.db, audit: mock.audit as any }); return { ...mock, result };
};
const validationErrors = async (csv: string, input?: Parameters<typeof mockDb>[0]) => {
  const mock = mockDb(input);
  try { await importEmployeesCsv(organizationId, Buffer.from(csv), actor, { db: mock.db, audit: mock.audit as any }); assert.fail("Expected import validation failure"); }
  catch (error) { assert.ok(error instanceof HttpError); assert.equal(error.statusCode, 400); assert.equal(error.message, "Employee import validation failed"); const details = error.details as { errorCode: string; validationErrors: EmployeeImportValidationError[] }; assert.equal(details.errorCode, "EMPLOYEE_IMPORT_VALIDATION_FAILED"); return { errors: details.validationErrors, state: mock.state }; }
};

test("employee import template header is authoritative and imports a minimal row with default PROBATION", async () => {
  assert.equal(employeeImportTemplate(), `${header}\r\n`); const { result, state } = await run(`${employeeImportTemplate()}${minimalRow}\r\n`);
  assert.deepEqual(result, { imported: 1, failed: 0 }); assert.equal(state.committed.length, 1); assert.equal(state.committed[0].lifecycleStatus, "PROBATION"); assert.equal(state.committed[0].email, "amina@example.test"); assert.equal(state.auditCalls, 1);
});

test("employee import accepts valid optional fields, quotes, department and UTC date", async () => {
  const row = ' EMP-002 , Ada , Okafor , +2348012345678 , ADA@EXAMPLE.TEST , "Finance, Operations" , Analyst , CONFIRMED , HYBRID , 2026-09-28 , 250000.50 ';
  const { state } = await run(`${header}\n${row}`, { departments: [{ id: "department-a", name: "Finance, Operations" }] }); const employee = state.committed[0];
  assert.equal(employee.email, "ada@example.test"); assert.equal(employee.departmentId, "department-a"); assert.equal(employee.hireDate.toISOString(), "2026-09-28T00:00:00.000Z"); assert.equal(employee.baseSalary.toString(), "250000.5");
});

test("employee import rejects empty and header-only files before database access", async () => {
  for (const csv of ["", `${header}\r\n`]) { const mock = mockDb(); await assert.rejects(() => importEmployeesCsv(organizationId, Buffer.from(csv), actor, { db: mock.db, audit: mock.audit as any }), (error: any) => error instanceof HttpError && error.statusCode === 400 && error.message === "CSV must contain a header and at least one employee row"); assert.equal(mock.state.transactionCalls, 0); }
});

test("employee import reports every missing required header", async () => {
  const { errors } = await validationErrors("employeeId,firstName\nEMP-1,Amina"); assert.deepEqual(errors.map((error) => [error.row, error.field, error.code]), [[1, "lastName", "MISSING_HEADER"], [1, "email", "MISSING_HEADER"]]);
});

test("employee import reports empty required cells and physical CSV row numbers", async () => {
  const csv = `${header}\nEMP-1,Amina,Yusuf,,a@example.test,,,PROBATION,,,\n\n , , ,,, ,,,,,`;
  const { errors, state } = await validationErrors(csv); assert.deepEqual(errors.filter((error) => error.code === "REQUIRED").map((error) => [error.row, error.field]), [[4, "employeeId"], [4, "firstName"], [4, "lastName"], [4, "email"]]); assert.equal(state.transactionCalls, 0);
});

test("employee import validates email and lifecycle status", async () => {
  const { errors } = await validationErrors(`${header}\nEMP-1,Amina,Yusuf,,not-an-email,,,ACTIVE,,,`); assert.equal(errors.some((error) => error.field === "email" && error.code === "INVALID_EMAIL"), true); assert.equal(errors.some((error) => error.field === "lifecycleStatus" && error.code === "INVALID_ENUM"), true);
});

test("employee import accepts canonical and unambiguous Excel dates at UTC midnight", async () => {
  const csv = `${header}\nEMP-1,Amina,Yusuf,,a@example.test,,,PROBATION,,2026-09-23,\nEMP-2,Ada,Okafor,,b@example.test,,,PROBATION,,23/09/2026,\nEMP-3,Chidi,Eze,,c@example.test,,,PROBATION,,09/23/2026,`;
  const { state } = await run(csv);
  assert.deepEqual(state.committed.map((employee) => employee.hireDate.toISOString()), ["2026-09-23T00:00:00.000Z", "2026-09-23T00:00:00.000Z", "2026-09-23T00:00:00.000Z"]);
});

test("employee import rejects ambiguous Excel dates without guessing and remains atomic", async () => {
  const csv = `${header}\nEMP-1,Amina,Yusuf,,a@example.test,,,PROBATION,,05/06/2026,\nEMP-2,Ada,Okafor,,b@example.test,,,PROBATION,,01/02/2026,`;
  const { errors, state } = await validationErrors(csv); const dateErrors = errors.filter((error) => error.code === "AMBIGUOUS_DATE");
  assert.deepEqual(dateErrors.map((error) => error.row), [2, 3]); assert.match(dateErrors[0].message, /ambiguous.*YYYY-MM-DD/i); assert.equal(state.transactionCalls, 0); assert.equal(state.committed.length, 0);
});

test("employee import rejects impossible slash and ISO dates with physical row numbers", async () => {
  const csv = `${header}\nEMP-1,Amina,Yusuf,,a@example.test,,,PROBATION,,31/02/2026,\n\nEMP-2,Ada,Okafor,,b@example.test,,,PROBATION,,02/31/2026,\nEMP-3,Chidi,Eze,,c@example.test,,,PROBATION,,2026-02-30,`;
  const { errors } = await validationErrors(csv); assert.deepEqual(errors.filter((error) => error.code === "INVALID_DATE").map((error) => error.row), [2, 4, 5]);
});

test("employee import validates Decimal(14,2)-compatible non-negative monthly earnings", async () => {
  const csv = `${header}\nEMP-1,Amina,Yusuf,,a@example.test,,,PROBATION,,,-1\nEMP-2,Ada,Okafor,,b@example.test,,,PROBATION,,,1.234\nEMP-3,Chidi,Eze,,c@example.test,,,PROBATION,,,1000000000000.00`;
  const { errors } = await validationErrors(csv); assert.deepEqual(errors.filter((error) => error.code === "INVALID_DECIMAL").map((error) => error.row), [2, 3, 4]);
});

test("employee import reports unknown departments and accepts a tenant department case-insensitively", async () => {
  const bad = await validationErrors(`${header}\nEMP-1,Amina,Yusuf,,a@example.test,Finance X,,PROBATION,,,`, { departments: [{ id: "department-a", name: "Finance" }] }); assert.deepEqual(bad.errors.find((error) => error.code === "UNKNOWN_DEPARTMENT"), { row: 2, field: "department", code: "UNKNOWN_DEPARTMENT", message: "Department 'Finance X' does not exist" });
  const good = await run(`${header}\nEMP-2,Ada,Okafor,,b@example.test,finance,,PROBATION,,,`, { departments: [{ id: "department-a", name: "Finance" }] }); assert.equal(good.state.committed[0].departmentId, "department-a");
});

test("employee import detects employee ID and normalized email duplicates inside the file before Prisma", async () => {
  const csv = `${header}\nEMP-1,Amina,Yusuf,,a@example.test,,,PROBATION,,,\n emp-1 ,Ada,Okafor,,A@EXAMPLE.TEST,,,PROBATION,,,`;
  const { errors, state } = await validationErrors(csv); assert.deepEqual(errors.filter((error) => error.code === "DUPLICATE_IN_FILE").map((error) => [error.row, error.field]), [[3, "employeeId"], [3, "email"]]); assert.equal(state.transactionCalls, 0);
});

test("employee import prechecks same-tenant conflicts without leaking another tenant", async () => {
  const existing = [{ organizationId, employeeNo: "EMP-1", email: "a@example.test" }, { organizationId: "organization-b", employeeNo: "EMP-2", email: "b@example.test" }];
  const bad = await validationErrors(`${header}\nEMP-1,Amina,Yusuf,,a@example.test,,,PROBATION,,,`, { existing }); assert.deepEqual(bad.errors.filter((error) => error.code === "ALREADY_EXISTS").map((error) => error.field), ["employeeId", "email"]);
  const good = await run(`${header}\nEMP-2,Ada,Okafor,,b@example.test,,,PROBATION,,,`, { existing }); assert.equal(good.state.committed.length, 1); assert.equal(good.state.employeeQueries.every((query) => query.where.organizationId === organizationId), true);
});

test("employee import returns multiple row errors in one response and creates zero employees", async () => {
  const csv = `${header}\n,Amina,Yusuf,,bad,,,ACTIVE,,2026-02-30,-1\nEMP-2,,Okafor,,valid@example.test,Missing,,PROBATION,,,`;
  const { errors, state } = await validationErrors(csv); assert.ok(errors.length >= 6); assert.equal(new Set(errors.map((error) => error.row)).size, 2); assert.equal(state.transactionCalls, 0); assert.equal(state.committed.length, 0); assert.equal(state.auditCalls, 0);
});

test("employee import transaction failure remains atomic and does not expose database internals", async () => {
  const mock = mockDb({ transactionError: new Error("SQL constraint secret") });
  await assert.rejects(() => importEmployeesCsv(organizationId, Buffer.from(`${header}\n${minimalRow}`), actor, { db: mock.db, audit: mock.audit as any }), (error: any) => error instanceof HttpError && error.statusCode === 409 && error.message === "Employee import could not be completed atomically; no employees were created" && !JSON.stringify(error).includes("SQL constraint secret"));
  assert.equal(mock.state.committed.length, 0); assert.equal(mock.state.auditCalls, 0);
});

test("employee import handles a race-time uniqueness conflict safely", async () => {
  const race = new Prisma.PrismaClientKnownRequestError("unique constraint", { code: "P2002", clientVersion: "5.22.0", meta: { target: ["organizationId", "email"] } }); const mock = mockDb({ transactionError: race });
  await assert.rejects(() => importEmployeesCsv(organizationId, Buffer.from(`${header}\n${minimalRow}`), actor, { db: mock.db, audit: mock.audit as any }), (error: any) => error instanceof HttpError && error.statusCode === 409 && (error.details as any).errorCode === "EMPLOYEE_IMPORT_CONFLICT" && !JSON.stringify(error).includes("unique constraint"));
  assert.equal(mock.state.committed.length, 0); assert.equal(mock.state.auditCalls, 0);
});
