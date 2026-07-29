import { AsyncLocalStorage } from "node:async_hooks";
import type { RequestHandler } from "express";

type RequestContext = {
  ipAddress: string | null;
  userAgent: string | null;
};

const requestContext = new AsyncLocalStorage<RequestContext>();

export const requestContextMiddleware: RequestHandler = (req, _res, next) => {
  const forwardedFor = req.header("x-forwarded-for");
  const ipAddress = forwardedFor?.split(",")[0]?.trim() || req.ip || null;
  const userAgent = req.header("user-agent") || null;

  requestContext.run({ ipAddress, userAgent }, next);
};

export const getRequestContext = () => requestContext.getStore() ?? null;
