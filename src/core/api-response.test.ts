import test from "node:test";
import assert from "node:assert/strict";
import { sendSuccess } from "./api-response";

test("success responses use one canonical envelope with optional metadata and pagination", () => {
  let body: unknown; let status = 0;
  const response = { status(code: number) { status = code; return this; }, json(value: unknown) { body = value; return this; } };
  sendSuccess(response as any, "ok", { id: "one" }, { status: 201, metadata: { year: 2026 }, pagination: { page: 1, limit: 25, total: 1, totalPages: 1 } });
  assert.equal(status, 201);
  assert.deepEqual(body, { success: true, message: "ok", data: { id: "one" }, metadata: { year: 2026 }, pagination: { page: 1, limit: 25, total: 1, totalPages: 1 } });
});
