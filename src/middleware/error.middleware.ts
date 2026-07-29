import type { ErrorRequestHandler } from "express";
import { Prisma } from "@prisma/client";
import { HttpError } from "../core/http-error";

export const errorMiddleware: ErrorRequestHandler = (error, _req, res, _next) => {
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
      return res.status(409).json({ success: false, message: "Unique constraint violation", data: null, errorCode: "CONFLICT", details: error.meta });
    }
    if (error.code === "P2025") {
      return res.status(404).json({ success: false, message: "Resource not found", data: null, errorCode: "NOT_FOUND" });
    }
  }

  console.error(error);
  return res.status(500).json({ success: false, message: "Internal server error", data: null, errorCode: "INTERNAL_ERROR" });
};
