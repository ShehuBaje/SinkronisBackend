import { AsyncLocalStorage } from "node:async_hooks";
import type { RequestHandler } from "express";
import { extractClientIp } from "./request-metadata";

type RequestContext = {
  ipAddress: string | null;
  userAgent: string | null;
};

const requestContext = new AsyncLocalStorage<RequestContext>();

export const requestContextMiddleware: RequestHandler = (req, _res, next) => {
  const ipAddress = extractClientIp({ headers: req.headers, ip: req.ip });
  const userAgent = req.header("user-agent") || null;

  requestContext.run({ ipAddress, userAgent }, next);
};

export const getRequestContext = () => requestContext.getStore() ?? null;
