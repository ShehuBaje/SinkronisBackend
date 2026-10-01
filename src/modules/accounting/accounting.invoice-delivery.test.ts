import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { classifyEmailDeliveryFailure } from "../../core/email-security";

const serviceSource = readFileSync("src/modules/accounting/accounting.service.ts", "utf8");
const schemaSource = readFileSync("prisma/schema.prisma", "utf8");
const migrationSource = readFileSync("prisma/migrations/20261001100000_invoice_email_delivery_state/migration.sql", "utf8");

test("invoice delivery uses a tenant-scoped conditional claim before SMTP", () => {
  const claim = serviceSource.indexOf("const claim = await prisma.invoice.updateMany");
  const smtp = serviceSource.indexOf("delivery = await sendTransactionalNotificationEmail", claim);
  assert.ok(claim >= 0 && smtp > claim);
  assert.match(serviceSource.slice(claim, smtp), /organizationId/);
  assert.match(serviceSource.slice(claim, smtp), /status: "DRAFT"/);
  assert.match(serviceSource.slice(claim, smtp), /emailDeliveryStatus: \{ in: \["NOT_STARTED", "FAILED"\] \}/);
  assert.match(serviceSource.slice(claim, smtp), /emailDeliveryStatus: "SENDING"/);
  assert.match(serviceSource, /if \(claim\.count !== 1\)/);
});

test("SENT is idempotent while SENDING and UNKNOWN are non-resendable", () => {
  assert.match(serviceSource, /current\.status === "SENT" && current\.emailDeliveryStatus === "SENT"/);
  assert.match(serviceSource, /\["SENDING", "UNKNOWN"\]\.includes\(current\.emailDeliveryStatus\)/);
  assert.match(serviceSource, /INVOICE_DELIVERY_RECONCILIATION_REQUIRED/);
});

test("provider acceptance finalizes invoice, history, and audit in one transaction", () => {
  const sendInvoiceStart = serviceSource.indexOf("export const sendInvoice");
  const finalization = serviceSource.indexOf("await prisma.$transaction(async (tx) =>", serviceSource.indexOf("const now = new Date()", sendInvoiceStart));
  const end = serviceSource.indexOf("return getInvoiceById(organizationId, id);", finalization);
  const block = serviceSource.slice(finalization, end);
  assert.match(block, /emailDeliveryStatus: "SENT"/);
  assert.match(block, /status: "SENT", sentAt: now/);
  assert.match(block, /tx\.accountingInvoiceStatusHistory\.create/);
  assert.match(block, /ACCOUNTING_INVOICE_SENT/);
  assert.match(block, /, tx\)/);
  assert.match(block, /emailDeliveryStatus: "UNKNOWN"/);
  assert.match(block, /FINALIZATION_FAILED/);
});

test("delivery failures distinguish definite pre-acceptance failures from ambiguous outcomes", () => {
  assert.equal(classifyEmailDeliveryFailure(Object.assign(new Error("auth"), { code: "EAUTH" })), "FAILED");
  assert.equal(classifyEmailDeliveryFailure(Object.assign(new Error("recipient"), { code: "EENVELOPE" })), "FAILED");
  assert.equal(classifyEmailDeliveryFailure(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" })), "UNKNOWN");
  assert.equal(classifyEmailDeliveryFailure(new Error("unclassified network outcome")), "UNKNOWN");
});

test("schema and migration add only invoice delivery metadata and deterministic backfill", () => {
  for (const state of ["NOT_STARTED", "SENDING", "SENT", "FAILED", "UNKNOWN"]) assert.match(schemaSource, new RegExp(`\\b${state}\\b`));
  assert.match(migrationSource, /WHERE `status` IN \('SENT', 'PARTIALLY_PAID', 'PAID', 'OVERDUE'\)/);
  assert.match(migrationSource, /`invoice`\.`status` = 'VOID'/);
  assert.match(migrationSource, /`invoice`\.`sentAt` IS NOT NULL OR EXISTS/);
  assert.match(migrationSource, /AccountingInvoiceStatusHistory/);
  assert.doesNotMatch(migrationSource, /UPDATE `Invoice`\s+SET `status`/);
  assert.doesNotMatch(migrationSource, /subtotal|taxAmount|whtAmount|amountPayable|paidAt|paymentReference/);
});
