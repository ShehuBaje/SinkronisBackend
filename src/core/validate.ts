import type { RequestHandler } from "express";
import { ZodError, type z } from "zod";
import { badRequest } from "./http-error";

type Schemas = {
  body?: z.ZodTypeAny;
  params?: z.ZodTypeAny;
  query?: z.ZodTypeAny;
};

export const validate =
  (schemas: Schemas): RequestHandler =>
  (req, _res, next) => {
    try {
      if (schemas.body) req.body = schemas.body.parse(req.body);
      if (schemas.params) req.params = schemas.params.parse(req.params);
      if (schemas.query) req.query = schemas.query.parse(req.query);
      next();
    } catch (error) {
      next(badRequest("Validation failed", error instanceof ZodError ? {
        errorCode: "VALIDATION_ERROR",
        validationErrors: error.issues.map((issue) => ({ field: issue.path.join("."), message: issue.message, code: issue.code }))
      } : error));
    }
  };
