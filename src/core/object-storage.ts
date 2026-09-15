import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { Transform, type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { copy, del, get, head, list, put } from "@vercel/blob";
import { env } from "../config/env";
import { notFound } from "./http-error";

type UploadInput = {
  key: string;
  body: Buffer | Readable;
  contentType: string;
  publicBaseUrl?: string;
  visibility?: "public" | "private";
};

const MAX_REMOTE_OBJECT_BYTES = 25 * 1024 * 1024;
const isAllowedBlobHost = (hostname: string) => hostname === "blob.vercel-storage.com" || hostname.endsWith(".blob.vercel-storage.com");

const normalizeKey = (key: string) => key.replace(/\\/g, "/").replace(/^\/+/, "");
const localRoot = path.resolve(process.cwd(), env.UPLOAD_DIR);

const resolveLocalPath = (key: string) => {
  const target = path.resolve(localRoot, normalizeKey(key));
  if (target !== localRoot && !target.startsWith(`${localRoot}${path.sep}`)) {
    throw new Error("Invalid storage key");
  }
  return target;
};

export const createObjectKey = (prefix: string, originalName: string) => {
  const extension = path.extname(originalName).toLowerCase();
  return `${normalizeKey(prefix)}/${Date.now()}-${crypto.randomUUID()}${extension}`;
};

export const uploadObject = async ({ key, body, contentType, publicBaseUrl: _publicBaseUrl, visibility }: UploadInput) => {
  const normalizedKey = normalizeKey(key);
  const resolvedVisibility = visibility ?? (normalizedKey.startsWith("media/") || normalizedKey.startsWith("employee-profile/") || normalizedKey.startsWith("general-settings/branding/") ? "public" : "private");
  if (env.STORAGE_PROVIDER === "vercel-blob") {
    let streamedSize = 0;
    const uploadBody = Buffer.isBuffer(body) ? body : body.pipe(new Transform({ transform(chunk: Buffer, _encoding, callback) { streamedSize += chunk.length; callback(null, chunk); } }));
    const blob = await put(normalizedKey, uploadBody, {
      access: resolvedVisibility,
      contentType,
      addRandomSuffix: false,
      token: env.BLOB_READ_WRITE_TOKEN
    });
    return { key: blob.url, url: blob.url, size: Buffer.isBuffer(body) ? body.length : streamedSize };
  }

  const absolutePath = resolveLocalPath(normalizedKey);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  if (Buffer.isBuffer(body)) await fs.writeFile(absolutePath, body);
  else await pipeline(body, (await import("node:fs")).createWriteStream(absolutePath, { flags: "wx" }));
  const size = Buffer.isBuffer(body) ? body.length : (await fs.stat(absolutePath)).size;
  const publicPath = resolvedVisibility === "public" ? `${env.UPLOAD_PUBLIC_BASE_PATH}/${normalizedKey}` : null;
  const canonicalBaseUrl = env.PUBLIC_BASE_URL?.replace(/\/$/, "");
  return {
    key: normalizedKey,
    url: publicPath ? (canonicalBaseUrl ? `${canonicalBaseUrl}${publicPath}` : publicPath) : normalizedKey,
    size
  };
};

export const deleteObject = async (reference: string | null | undefined) => {
  if (!reference) return;
  if (reference.startsWith("https://") || reference.startsWith("http://")) {
    const url = new URL(reference);
    if (isAllowedBlobHost(url.hostname) && env.BLOB_READ_WRITE_TOKEN) {
      await del(reference, { token: env.BLOB_READ_WRITE_TOKEN });
    } else {
      const base = env.PUBLIC_BASE_URL ? new URL(env.PUBLIC_BASE_URL) : null;
      const marker = `${env.UPLOAD_PUBLIC_BASE_PATH.replace(/\/$/, "")}/`;
      if (base && url.origin === base.origin && url.pathname.startsWith(marker)) await fs.rm(resolveLocalPath(url.pathname.slice(marker.length)), { force: true });
    }
    return;
  }
  await fs.rm(resolveLocalPath(reference), { force: true });
};

export const migrateObjectToPrivate = async (sourceReference: string, destinationKey: string) => {
  const normalizedDestination = normalizeKey(destinationKey);
  if ((sourceReference.startsWith("http://") || sourceReference.startsWith("https://")) && env.STORAGE_PROVIDER !== "vercel-blob") {
    const content = await readObject(sourceReference);
    return uploadObject({ key: normalizedDestination, body: content, contentType: "application/octet-stream", visibility: "private" });
  }
  if (env.STORAGE_PROVIDER === "vercel-blob") {
    const migrated = await copy(sourceReference, normalizedDestination, { access: "private", addRandomSuffix: false, token: env.BLOB_READ_WRITE_TOKEN });
    return { key: migrated.url, url: migrated.url };
  }

  const sourceUrl = sourceReference.startsWith("http://") || sourceReference.startsWith("https://") ? new URL(sourceReference) : null;
  const base = env.PUBLIC_BASE_URL ? new URL(env.PUBLIC_BASE_URL) : null;
  const marker = `${env.UPLOAD_PUBLIC_BASE_PATH.replace(/\/$/, "")}/`;
  const sourceKey = sourceUrl && base && sourceUrl.origin === base.origin && sourceUrl.pathname.startsWith(marker) ? sourceUrl.pathname.slice(marker.length) : sourceReference;
  const sourcePath = resolveLocalPath(sourceKey);
  const destinationPath = resolveLocalPath(normalizedDestination);
  await fs.mkdir(path.dirname(destinationPath), { recursive: true });
  await fs.copyFile(sourcePath, destinationPath);
  return { key: normalizedDestination, url: normalizedDestination };
};

export const assertLegacyMigrationCapabilities = (references: string[]) => {
  const remoteBlobSources = references.some(reference => { try { return isAllowedBlobHost(new URL(reference).hostname); } catch { return false; } });
  if (!remoteBlobSources) return;
  if (env.PRIVATE_FILE_MIGRATION_MODE === "CROSS_STORE" && (!env.SOURCE_BLOB_READ_WRITE_TOKEN || !env.DESTINATION_BLOB_READ_WRITE_TOKEN)) throw new Error("Cross-store private-file migration requires configured source and destination credentials");
  if (env.PRIVATE_FILE_MIGRATION_MODE === "SAME_STORE" && (!env.BLOB_READ_WRITE_TOKEN || env.STORAGE_PROVIDER !== "vercel-blob")) throw new Error("Same-store private-file migration requires the Vercel Blob runtime provider and credential");
  if (!env.PRIVATE_FILE_MIGRATION_MODE) throw new Error("PRIVATE_FILE_MIGRATION_MODE must explicitly select CROSS_STORE or SAME_STORE");
};

type MigrationCredentialConfig = {
  mode?: "CROSS_STORE" | "SAME_STORE";
  runtimeToken?: string;
  sourceToken?: string;
  destinationToken?: string;
};

export const resolveMigrationCredentials = ({ mode, runtimeToken, sourceToken, destinationToken }: MigrationCredentialConfig) => {
  if (mode === "CROSS_STORE") {
    if (!sourceToken?.trim() || !destinationToken?.trim()) {
      throw new Error("Cross-store private-file migration requires configured source and destination credentials");
    }
    return { source: sourceToken, destination: destinationToken };
  }
  if (mode === "SAME_STORE") {
    if (!runtimeToken?.trim()) throw new Error("Same-store private-file migration requires the configured runtime storage credential");
    return { source: runtimeToken, destination: runtimeToken };
  }
  throw new Error("PRIVATE_FILE_MIGRATION_MODE must explicitly select CROSS_STORE or SAME_STORE");
};

const migrationTokens = () => resolveMigrationCredentials({
  mode: env.PRIVATE_FILE_MIGRATION_MODE,
  runtimeToken: env.BLOB_READ_WRITE_TOKEN,
  sourceToken: env.SOURCE_BLOB_READ_WRITE_TOKEN,
  destinationToken: env.DESTINATION_BLOB_READ_WRITE_TOKEN,
});
export const validateMigrationSource = async (reference: string) => { const { source } = migrationTokens(); try { await head(reference, { token: source }); } catch { throw new Error("Source object is unavailable or is not authorized for the configured source store"); } };
export const validateMigrationDestination = async () => { try { await list({ limit: 1, token: migrationTokens().destination }); } catch { throw new Error("Destination credential is invalid or cannot access a private-capable Blob store"); } };
export const readMigrationSource = async (reference: string) => { const { source } = migrationTokens(); const result = await get(reference, { access: "public", token: source, abortSignal: AbortSignal.timeout(15_000) }).catch(() => null); if (!result?.stream) throw new Error("Source object could not be read using the configured source store"); const reader = result.stream.getReader(); const chunks: Buffer[]=[]; let received=0; while(true){const {done,value}=await reader.read();if(done)break;received+=value.byteLength;if(received>MAX_REMOTE_OBJECT_BYTES){await reader.cancel();throw new Error("Source object exceeds the migration size limit");}chunks.push(Buffer.from(value));} return Buffer.concat(chunks,received); };
export const writeMigrationDestination = async (key: string, body: Buffer) => { const { destination } = migrationTokens(); const stored = await put(normalizeKey(key), body, { access: "private", addRandomSuffix: false, token: destination }); try { await head(stored.url, { token: destination }); const anonymous = await fetch(stored.url, { redirect: "manual", signal: AbortSignal.timeout(10_000) }); if (anonymous.status === 200) throw new Error("Destination object is anonymously readable"); } catch (error) { await del(stored.url, { token: destination }).catch(() => undefined); throw error instanceof Error ? error : new Error("Destination private-access verification failed"); } return { key: stored.url, url: stored.url }; };
export const deleteMigrationDestination = async (reference: string) => { await del(reference, { token: migrationTokens().destination }); };
export const deleteMigrationSource = async (reference: string) => { await del(reference, { token: migrationTokens().source }); const response = await fetch(reference, { redirect: "manual", signal: AbortSignal.timeout(10_000) }); if (response.status === 200) throw new Error("Source object remains publicly accessible after deletion"); };

export const readObject = async (reference: string) => {
  if (reference.startsWith("https://") || reference.startsWith("http://")) {
    const url = new URL(reference);
    if (url.protocol !== "https:" || !isAllowedBlobHost(url.hostname)) throw notFound("Stored file is no longer available");
    if (env.STORAGE_PROVIDER === "vercel-blob") {
      const result = await get(reference, { access: "private", token: env.BLOB_READ_WRITE_TOKEN, abortSignal: AbortSignal.timeout(15_000) }).catch(() => null);
      if (result?.stream) {
        const reader = result.stream.getReader(); const chunks: Buffer[] = []; let received = 0;
        while (true) { const { done, value } = await reader.read(); if (done) break; received += value.byteLength; if (received > MAX_REMOTE_OBJECT_BYTES) { await reader.cancel(); throw notFound("Stored file exceeds the download limit"); } chunks.push(Buffer.from(value)); }
        return Buffer.concat(chunks, received);
      }
    }
    // Legacy public blobs remain readable during the private-object backfill.
    const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw notFound("Stored file is no longer available");
    const declaredLength = Number(response.headers.get("content-length") ?? 0);
    if (declaredLength > MAX_REMOTE_OBJECT_BYTES) throw notFound("Stored file exceeds the download limit");
    if (!response.body) throw notFound("Stored file is no longer available");
    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let received = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > MAX_REMOTE_OBJECT_BYTES) {
        await reader.cancel();
        throw notFound("Stored file exceeds the download limit");
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, received);
  }
  try {
    return await fs.readFile(resolveLocalPath(reference));
  } catch {
    throw notFound("Stored file is no longer available");
  }
};
