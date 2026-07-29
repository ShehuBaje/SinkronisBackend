import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { del, put } from "@vercel/blob";
import { env } from "../config/env";
import { notFound } from "./http-error";

type UploadInput = {
  key: string;
  body: Buffer;
  contentType: string;
  publicBaseUrl?: string;
};

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

export const uploadObject = async ({ key, body, contentType, publicBaseUrl }: UploadInput) => {
  const normalizedKey = normalizeKey(key);
  if (env.STORAGE_PROVIDER === "vercel-blob") {
    const blob = await put(normalizedKey, body, {
      access: "public",
      contentType,
      addRandomSuffix: false,
      token: env.BLOB_READ_WRITE_TOKEN
    });
    return { key: blob.url, url: blob.url, size: body.length };
  }

  const absolutePath = resolveLocalPath(normalizedKey);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, body);
  const publicPath = `${env.UPLOAD_PUBLIC_BASE_PATH}/${normalizedKey}`;
  return {
    key: normalizedKey,
    url: publicBaseUrl ? `${publicBaseUrl}${publicPath}` : publicPath,
    size: body.length
  };
};

export const deleteObject = async (reference: string | null | undefined) => {
  if (!reference) return;
  if (reference.startsWith("https://") || reference.startsWith("http://")) {
    if (env.STORAGE_PROVIDER === "vercel-blob") {
      await del(reference, { token: env.BLOB_READ_WRITE_TOKEN });
    }
    return;
  }
  await fs.rm(resolveLocalPath(reference), { force: true });
};

export const readObject = async (reference: string) => {
  if (reference.startsWith("https://") || reference.startsWith("http://")) {
    const response = await fetch(reference);
    if (!response.ok) throw notFound("Stored file is no longer available");
    return Buffer.from(await response.arrayBuffer());
  }
  try {
    return await fs.readFile(resolveLocalPath(reference));
  } catch {
    throw notFound("Stored file is no longer available");
  }
};
