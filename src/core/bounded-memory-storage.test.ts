import assert from "node:assert/strict";
import test from "node:test";
import { PassThrough } from "node:stream";
import { boundedMemoryStorage } from "./bounded-memory-storage";

const upload = (storage: ReturnType<typeof boundedMemoryStorage>, req: any, bytes: number) => new Promise<{ error?: any; file?: any }>(resolve => {
  const stream = new PassThrough();
  storage._handleFile(req, { stream } as any, (error, file) => resolve({ error, file }));
  stream.end(Buffer.alloc(bytes));
});

test("bounded multipart storage enforces per-file bytes without Content-Length", async () => {
  const result = await upload(boundedMemoryStorage({ perFileBytes: 10, totalBytes: 20 }), {}, 11);
  assert.equal(result.error?.statusCode, 413);
});

test("bounded multipart storage enforces aggregate bytes across files", async () => {
  const storage = boundedMemoryStorage({ perFileBytes: 10, totalBytes: 12 }); const req = {};
  assert.equal((await upload(storage, req, 8)).file?.size, 8);
  assert.equal((await upload(storage, req, 5)).error?.statusCode, 413);
});

test("bounded multipart storage returns a buffer below both limits", async () => {
  const result = await upload(boundedMemoryStorage({ perFileBytes: 10, totalBytes: 20 }), {}, 9);
  assert.equal(result.file?.buffer.length, 9);
});
