import assert from "node:assert/strict";
import test from "node:test";
import type { AddressInfo } from "node:net";
import app from "./app";
import { env } from "./config/env";

const withServer = async (run: (baseUrl: string) => Promise<void>) => {
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address() as AddressInfo;
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
};

const preflight = (baseUrl: string, path: string, origin: string) => fetch(`${baseUrl}${path}`, {
  method: "OPTIONS",
  headers: {
    Origin: origin,
    "Access-Control-Request-Method": "POST",
    "Access-Control-Request-Headers": "content-type,authorization"
  }
});

test("allowed login preflights terminate before authentication and expose credentialed CORS headers", async () => {
  const configuredOrigin = env.CORS_ORIGIN.split(",").map((value) => value.trim()).find(Boolean)!;
  await withServer(async (baseUrl) => {
    for (const origin of [configuredOrigin, "http://localhost:3000"]) {
      const response = await preflight(baseUrl, `${env.API_PREFIX}/auth/login`, origin);
      assert.equal(response.status, 204);
      assert.equal(response.headers.get("access-control-allow-origin"), origin);
      assert.equal(response.headers.get("access-control-allow-credentials"), "true");
      assert.match(response.headers.get("access-control-allow-methods") ?? "", /POST/);
      assert.match(response.headers.get("access-control-allow-headers") ?? "", /content-type/);
      assert.match(response.headers.get("access-control-allow-headers") ?? "", /authorization/);
    }
  });
});

test("global preflight works for protected APIs without authentication or tenant context", async () => {
  const configuredOrigin = env.CORS_ORIGIN.split(",").map((value) => value.trim()).find(Boolean)!;
  await withServer(async (baseUrl) => {
    const response = await preflight(baseUrl, `${env.API_PREFIX}/admin/notifications-alerts/overview`, configuredOrigin);
    assert.equal(response.status, 204);
    assert.equal(response.headers.get("access-control-allow-origin"), configuredOrigin);
  });
});

test("disallowed origins never receive CORS permission while login POST still reaches validation", async () => {
  await withServer(async (baseUrl) => {
    const denied = await preflight(baseUrl, `${env.API_PREFIX}/auth/login`, "https://example.invalid");
    assert.equal(denied.headers.get("access-control-allow-origin"), null);
    assert.equal(denied.headers.get("access-control-allow-credentials"), null);

    const post = await fetch(`${baseUrl}${env.API_PREFIX}/auth/login`, {
      method: "POST",
      headers: { Origin: "http://localhost:3000", "Content-Type": "application/json" },
      body: JSON.stringify({})
    });
    assert.equal(post.status, 400);
    assert.equal(post.headers.get("access-control-allow-origin"), "http://localhost:3000");
    const body = await post.json() as { errorCode?: string };
    assert.notEqual(body.errorCode, "INTERNAL_ERROR");
  });
});
