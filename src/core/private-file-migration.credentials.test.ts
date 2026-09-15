import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { resolveMigrationCredentials } from "./object-storage";
import { isLegacyPublicBlobReference } from "./private-file-migration";

test("cross-store migration keeps source and destination credentials separate", () => {
  const credentials = resolveMigrationCredentials({
    mode: "CROSS_STORE",
    sourceToken: "source-secret",
    destinationToken: "destination-secret",
  });
  assert.equal(credentials.source, "source-secret");
  assert.equal(credentials.destination, "destination-secret");
  assert.notEqual(credentials.source, credentials.destination);
});

test("cross-store migration rejects either missing credential without leaking the configured secret", () => {
  assert.throws(
    () => resolveMigrationCredentials({ mode: "CROSS_STORE", destinationToken: "destination-secret" }),
    (error: Error) => !error.message.includes("destination-secret"),
  );
  assert.throws(
    () => resolveMigrationCredentials({ mode: "CROSS_STORE", sourceToken: "source-secret" }),
    (error: Error) => !error.message.includes("source-secret"),
  );
});

test("same-store migration is available only when explicitly selected", () => {
  assert.throws(() => resolveMigrationCredentials({ runtimeToken: "runtime-secret" }), /explicitly select/);
  assert.deepEqual(
    resolveMigrationCredentials({ mode: "SAME_STORE", runtimeToken: "runtime-secret" }),
    { source: "runtime-secret", destination: "runtime-secret" },
  );
});

test("migration implementation preserves token responsibility and cleanup recovery boundaries", () => {
  const storageSource = fs.readFileSync(path.resolve("src/core/object-storage.ts"), "utf8");
  const migrationSource = fs.readFileSync(path.resolve("src/core/private-file-migration.ts"), "utf8");

  assert.match(storageSource, /del\(reference, \{ token: migrationTokens\(\)\.source \}\)/);
  assert.match(storageSource, /del\(reference, \{ token: migrationTokens\(\)\.destination \}\)/);
  assert.match(storageSource, /put\(normalizeKey\(key\), body, \{ access: "private"/);
  assert.match(migrationSource, /status: "CLEANUP_REQUIRED"/);
  assert.match(migrationSource, /status: "CLEANUP_REQUIRED"[\s\S]*deleteMigrationSource\(migration\.sourceReference\)/);
  assert.match(migrationSource, /if \(!migration\.destinationReference\)/);
});

test("candidate selection does not rediscover migrated private Blob references", () => {
  assert.equal(isLegacyPublicBlobReference("https://source.public.blob.vercel-storage.com/hris/document.pdf"), true);
  assert.equal(isLegacyPublicBlobReference("https://destination.private.blob.vercel-storage.com/private/document.pdf"), false);
  assert.equal(isLegacyPublicBlobReference("https://example.com/document.pdf"), false);
});
