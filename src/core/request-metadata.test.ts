import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { createServer } from "node:http";
import { extractClientIp, formatLocation, IpInfoGeolocationProvider, isPublicIp, resolveRequestLocation, type IpGeolocationProvider } from "./request-metadata";

const expressResolvedIp = async (hops: number, forwardedFor: string) => {
  const app = express();
  if (hops) app.set("trust proxy", hops);
  app.get("/", (req, res) => res.json({ ip: req.ip }));
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing server address");
    return (await (await fetch(`http://127.0.0.1:${address.port}/`, { headers: { "x-forwarded-for": forwardedFor } })).json() as { ip: string }).ip;
  } finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
};

test("localhost and private IPv4/IPv6 never invoke geolocation", async () => {
  let calls = 0;
  const provider: IpGeolocationProvider = { name: "TEST", lookup: async () => { calls++; return null; } };
  for (const ip of ["127.0.0.1", "::1", "10.1.2.3", "192.168.1.4", "fc00::1", "fe80::1"]) {
    assert.equal((await resolveRequestLocation({ ip }, provider)).country, "Local / Private Network");
  }
  assert.equal(calls, 0);
});

test("direct public IP and IPv4-mapped IPv6 are normalized", () => {
  assert.equal(extractClientIp({ ip: "8.8.8.8" }), "8.8.8.8");
  assert.equal(extractClientIp({ ip: "::ffff:8.8.4.4" }), "8.8.4.4");
  assert.equal(isPublicIp("8.8.8.8"), true);
});

test("spoofed forwarding headers are ignored when trust proxy is disabled", async () => {
  assert.equal(await expressResolvedIp(0, "1.1.1.1"), "127.0.0.1");
  assert.equal(extractClientIp({ ip: "127.0.0.1", headers: { "x-forwarded-for": "1.1.1.1" } }), "127.0.0.1");
});

test("Express resolves one and multiple explicitly trusted proxy hops", async () => {
  assert.equal(await expressResolvedIp(1, "1.1.1.1, 8.8.8.8"), "8.8.8.8");
  assert.equal(await expressResolvedIp(2, "1.1.1.1, 8.8.8.8"), "1.1.1.1");
});

test("geolocation success is mapped and failures/no provider become Unknown", async () => {
  const success: IpGeolocationProvider = { name: "TEST", lookup: async () => ({ city: "Lagos", state: "Lagos", country: "Nigeria", timezone: "Africa/Lagos" }) };
  assert.equal(formatLocation(await resolveRequestLocation({ ip: "8.8.8.8" }, success)), "Lagos, Nigeria");
  const failure: IpGeolocationProvider = { name: "TEST", lookup: async () => { throw new Error("provider down"); } };
  assert.equal(formatLocation(await resolveRequestLocation({ ip: "8.8.8.8" }, failure)), "Unknown");
  assert.equal(formatLocation(await resolveRequestLocation({ ip: "8.8.8.8" }, null)), "Unknown");
});

test("IPinfo timeout/provider failure returns null without throwing", async () => {
  const timeoutFetch = (_input: URL | RequestInfo, init?: RequestInit) => new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))));
  const provider = new IpInfoGeolocationProvider("token", 10, timeoutFetch as typeof fetch);
  assert.equal(await provider.lookup("8.8.8.8"), null);
  const failed = new IpInfoGeolocationProvider("token", 10, async () => new Response("bad", { status: 503 }));
  assert.equal(await failed.lookup("8.8.8.8"), null);
});

test("development override works locally and is ignored in production", () => {
  const oldNode = process.env.NODE_ENV, oldOverride = process.env.DEV_CLIENT_IP_OVERRIDE;
  try {
    process.env.NODE_ENV = "development"; process.env.DEV_CLIENT_IP_OVERRIDE = "8.8.8.8";
    assert.equal(extractClientIp({ ip: "127.0.0.1" }), "8.8.8.8");
    process.env.NODE_ENV = "production";
    assert.equal(extractClientIp({ ip: "127.0.0.1" }), "127.0.0.1");
  } finally { process.env.NODE_ENV = oldNode; if (oldOverride === undefined) delete process.env.DEV_CLIENT_IP_OVERRIDE; else process.env.DEV_CLIENT_IP_OVERRIDE = oldOverride; }
});
