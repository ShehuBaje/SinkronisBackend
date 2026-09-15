import type { Request } from "express";
import type { StorageEngine } from "multer";
import { payloadTooLarge } from "./http-error";

const requestBytes = Symbol("multipartRequestBytes");
type CountedRequest = Request & { [requestBytes]?: number };

export const boundedMemoryStorage = (options: { perFileBytes: number; totalBytes: number }): StorageEngine => ({
  _handleFile(req: CountedRequest, file, callback) {
    const chunks: Buffer[] = [];
    let fileBytes = 0;
    let settled = false;
    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      file.stream.resume();
      callback(payloadTooLarge(message));
    };
    file.stream.on("data", (chunk: Buffer) => {
      if (settled) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      fileBytes += buffer.length;
      req[requestBytes] = (req[requestBytes] ?? 0) + buffer.length;
      if (fileBytes > options.perFileBytes) return fail(`Each uploaded file must not exceed ${options.perFileBytes} bytes`);
      if ((req[requestBytes] ?? 0) > options.totalBytes) return fail(`Multipart upload must not exceed ${options.totalBytes} bytes in total`);
      chunks.push(buffer);
    });
    file.stream.once("error", (error) => { if (!settled) { settled = true; callback(error); } });
    file.stream.once("end", () => {
      if (settled) return;
      settled = true;
      callback(null, { buffer: Buffer.concat(chunks, fileBytes), size: fileBytes });
    });
  },
  _removeFile(_req, file, callback) {
    delete (file as unknown as { buffer?: Buffer }).buffer;
    callback(null);
  },
});
