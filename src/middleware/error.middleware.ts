import type { ErrorRequestHandler } from "express";
import { Prisma } from "@prisma/client";
import { HttpError } from "../core/http-error";
import multer from "multer";

export const errorMiddleware: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof SyntaxError && "body" in error) {
    return res.status(400).json({ success: false, message: "Request body contains malformed JSON", data: null, errorCode: "INVALID_JSON" });
  }
  if (error instanceof multer.MulterError) {
    const tooLarge = error.code === "LIMIT_FILE_SIZE" || error.code === "LIMIT_FILE_COUNT" || error.code === "LIMIT_PART_COUNT";
    return res.status(tooLarge ? 413 : 400).json({ success: false, message: tooLarge ? "Upload exceeds the permitted size or file count" : "Invalid multipart upload payload", data: null, errorCode: tooLarge ? "UPLOAD_TOO_LARGE" : "INVALID_MULTIPART" });
  }
  if (error instanceof HttpError) {
    const details = error.details as Record<string, unknown> | undefined;
    return res.status(error.statusCode).json({
      success: false,
      message: error.message,
      data: null,
      errorCode: typeof details?.errorCode === "string" ? details.errorCode : `HTTP_${error.statusCode}`,
      validationErrors: details?.validationErrors ?? (error.statusCode === 400 ? error.details ?? null : null),
      details: error.details
    });
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") {
      return res.status(409).json({ success: false, message: "A record with those values already exists", data: null, errorCode: "CONFLICT" });
    }
    if (error.code === "P2025") {
      return res.status(404).json({ success: false, message: "Resource not found", data: null, errorCode: "NOT_FOUND" });
    }
    if (error.code === "P2003") {
      return res.status(409).json({ success: false, message: "The operation conflicts with related records", data: null, errorCode: "RELATED_RECORD_CONFLICT" });
    }
    if (["P2000", "P2005", "P2006", "P2007"].includes(error.code)) {
      return res.status(400).json({ success: false, message: "The supplied value is invalid", data: null, errorCode: "INVALID_DATABASE_VALUE" });
    }
    if (["P2034", "P2028"].includes(error.code)) {
      return res.status(409).json({ success: false, message: "The operation conflicted with another update; please retry", data: null, errorCode: "CONCURRENT_UPDATE" });
    }
  }

  console.error(error);
  return res.status(500).json({ success: false, message: "Internal server error", data: null, errorCode: "INTERNAL_ERROR" });
};
