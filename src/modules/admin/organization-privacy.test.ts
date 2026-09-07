import assert from "node:assert/strict";
import test from "node:test";
import { buildZipArchive } from "./organization-privacy.service";

test("organization export archive is a real ZIP containing JSON files", async () => {
  const archive = await buildZipArchive([{ name: "manifest.json", value: { formatVersion: 1, count: 0 } }]);
  assert.equal(archive.subarray(0, 2).toString("ascii"), "PK");
  assert.ok(archive.includes(Buffer.from("manifest.json")));
  assert.ok(archive.length > 50);
});
